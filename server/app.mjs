import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openCommunityDatabase, publicUser, jsonRecord, transaction } from './db.mjs';
import { openPostgresDatabase } from './postgres.mjs';
import { createSession, destroySession, getSession, hashPassword, normalizeLogin, requireUser, sessionCookie, validateCredentials, verifyPassword } from './auth.mjs';
import { validateProposal } from './validation.mjs';
import { communityPackage, publishProposal, rollbackRule } from './production.mjs';
import { MAX_VOTES_PER_HOUR, REPUTATION_SQL, recordReview, reputationForUser, reviewHistory, reviewHistoryMap, voteWeight } from './review.mjs';
import { notificationsForUser, notifyProposalAuthor, notifyUser } from './notifications.mjs';
import { telegramDisplayName, telegramLogin, verifyTelegramInitData } from './telegram.mjs';

const JSON_LIMIT = 250_000;
const attempts = new Map();
let attemptsLastPruned = 0;

function error(status, code, message, details) {
  throw Object.assign(new Error(message), { status, code, details });
}

function send(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  response.end(body);
}

async function body(request, limit = JSON_LIMIT) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) error(413, 'too_large', 'Слишком большой запрос');
  }
  try { return text ? JSON.parse(text) : {}; } catch { error(400, 'invalid_json', 'Некорректный JSON'); }
}

function rateLimit(request) {
  const key = request.socket.remoteAddress || 'local';
  const now = Date.now();
  if (now - attemptsLastPruned > 300000) {
    attemptsLastPruned = now;
    for (const [address, times] of attempts) {
      if (!times.some((time) => now - time < 900000)) attempts.delete(address);
    }
  }
  const recent = (attempts.get(key) || []).filter((time) => now - time < 900000);
  if (recent.length >= 60) error(429, 'rate_limit', 'Слишком много попыток входа. Повторите позже.');
  recent.push(now);
  attempts.set(key, recent);
}

function pagination(url) {
  const page = Number(url.searchParams.get('page') || 1);
  const limit = Number(url.searchParams.get('limit') || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) error(422, 'invalid_pagination', 'Некорректные параметры страницы');
  return { page, limit, offset: (page - 1) * limit };
}

function paginationResult({ page, limit }, total) {
  const count = Number(total);
  const pages = Math.ceil(count / limit);
  return { page, limit, total: count, pages, hasNext: page < pages, hasPrev: page > 1 && pages > 0 };
}

function authResponse(response, status, user, session) {
  return send(response, status, { user: publicUser(user), csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { 'Set-Cookie': session.cookie });
}

async function viewerVoteMap(db, rows, viewerId) {
  const result = new Map();
  if (!viewerId || !rows.length) return result;
  const placeholders = rows.map(() => '?').join(',');
  const votes = await db.prepare(`SELECT proposal_id, value FROM votes WHERE user_id = ? AND proposal_id IN (${placeholders})`).all(viewerId, ...rows.map((row) => row.id));
  for (const vote of votes) result.set(vote.proposal_id, vote.value);
  return result;
}

async function proposalView(db, row, viewerId, history = null, votes = null) {
  const proposal = jsonRecord(row, ['issue_types', 'original_rule_json', 'proposed_rule_json']);
  proposal.score = Number(proposal.score);
  proposal.author_reputation = Number(row.author_reputation ?? 0);
  proposal.review_history = history ? history.get(row.id) || [] : await reviewHistory(db, row.id);
  proposal.viewer_vote = viewerId ? votes ? votes.get(row.id) ?? 0 : (await db.prepare('SELECT value FROM votes WHERE proposal_id = ? AND user_id = ?').get(row.id, viewerId))?.value ?? 0 : null;
  return proposal;
}

export async function createCommunityServer({ dbPath, god, staticHandler, dbBackend = 'sqlite', connectionString, pgClient, telegramBotToken = '', telegramWebhookSecret = '', publicUrl = '' }) {
  const db = dbBackend === 'postgres' ? await openPostgresDatabase(connectionString, { client: pgClient }) : openCommunityDatabase(dbPath);
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const clients = new Set();
  const tempFiles = new Map();
  let bootstrap = null;
  if (Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count) === 0) {
    const canonical = validateCredentials({ ...god, requireConfirmation: false });
    await db.prepare('INSERT INTO users(login,login_canonical,nickname,password_hash,privileges,created_at) VALUES(?,?,?,?,?,?)')
      .run(god.login.trim(), canonical, god.login.trim(), hashPassword(god.password), 'GOD', new Date().toISOString());
    bootstrap = { login: god.login.trim(), password: god.password };
  }

  function updated(type) { events.emit('update', { type, at: new Date().toISOString() }); }

  function requestCookie(request, name) {
    for (const part of String(request.headers.cookie || '').split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1));
    }
    return '';
  }

  async function recordQuestionView(request, question, userId) {
    if (/bot|crawler|spider|preview/i.test(String(request.headers['user-agent'] || ''))) return null;
    let viewerToken = requestCookie(request, 'chemcalc_viewer');
    let setCookie = null;
    if (!viewerToken) {
      viewerToken = randomBytes(18).toString('base64url');
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      setCookie = `chemcalc_viewer=${encodeURIComponent(viewerToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
    }
    const viewerKey = userId
      ? `u:${userId}`
      : `a:${createHash('sha256').update(viewerToken).digest('hex')}`;
    const existing = await db.prepare('SELECT 1 AS found FROM question_views WHERE question_id = ? AND viewer_key = ?').get(question.id, viewerKey);
    if (!existing) {
      try {
        await transaction(db, async () => {
          await db.prepare('INSERT INTO question_views(question_id, viewer_key, viewed_at) VALUES(?,?,?)')
            .run(question.id, viewerKey, new Date().toISOString());
          await db.prepare('UPDATE questions SET views = views + 1 WHERE id = ?').run(question.id);
        });
        question.views = Number(question.views || 0) + 1;
      } catch (error) {
        if (!/UNIQUE|constraint|23505/i.test(String(error.code || error.message || ''))) throw error;
      }
    }
    return setCookie;
  }

  const UPLOAD_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'application/json': 'json'
  };

  async function uploadsFor(type, id) {
    const column = type === 'answer' ? 'answer_id' : 'question_id';
    return db.prepare(`SELECT id, filename, mime, size, created_at FROM uploads WHERE ${column} = ? ORDER BY created_at ASC`).all(id);
  }

  async function attachUploads(type, id, ownerId, uploadIds) {
    if (!Array.isArray(uploadIds) || !uploadIds.length) return;
    const ids = [...new Set(uploadIds.filter((value) => typeof value === 'string'))].slice(0, 5);
    if (!ids.length) return;
    const column = type === 'answer' ? 'answer_id' : 'question_id';
    for (const uploadId of ids) {
      const upload = await db.prepare('SELECT owner_id, question_id, answer_id FROM uploads WHERE id = ?').get(uploadId);
      if (!upload || Number(upload.owner_id) !== Number(ownerId) || upload.question_id || upload.answer_id) {
        error(422, 'invalid_attachment', 'Вложение не найдено или уже прикреплено');
      }
      await db.prepare(`UPDATE uploads SET ${column} = ? WHERE id = ?`).run(id, uploadId);
    }
  }

  async function consumeTelegramAuth(key) {
    const now = Date.now();
    const existing = await db.prepare('SELECT used_at FROM telegram_auth WHERE key = ?').get(key);
    if (existing) {
      const usedAt = Date.parse(existing.used_at);
      if (Number.isFinite(usedAt) && now - usedAt < 120000) return;
      error(401, 'telegram_replay', 'Повторный вход по данным Telegram');
    }
    try {
      await db.prepare('DELETE FROM telegram_auth WHERE used_at < ?').run(new Date(now - 86400000).toISOString());
      await db.prepare('INSERT INTO telegram_auth(key, used_at) VALUES(?, ?)').run(key, new Date(now).toISOString());
    } catch (cause) {
      if (['23505', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(cause.code) || /UNIQUE|constraint/i.test(cause.message || '')) {
        const used = await db.prepare('SELECT used_at FROM telegram_auth WHERE key = ?').get(key);
        if (used && now - Date.parse(used.used_at) < 120000) return;
        error(401, 'telegram_replay', 'Повторный вход по данным Telegram');
      }
      throw cause;
    }
  }

  async function uniqueTelegramLogin(telegramId) {
    const base = telegramLogin(telegramId);
    let candidate = base;
    let suffix = 1;
    while (await db.prepare('SELECT id FROM users WHERE login_canonical = ?').get(normalizeLogin(candidate))) {
      candidate = `${base}_${suffix++}`;
    }
    return candidate;
  }

  async function telegramAccountHasActivity(userId) {
    const checks = [
      ['proposals', 'author_id'],
      ['votes', 'user_id'],
      ['questions', 'author_id'],
      ['answers', 'author_id'],
      ['comments', 'author_id'],
      ['post_votes', 'user_id'],
      ['post_edits', 'editor_id'],
      ['question_flags', 'user_id'],
      ['notifications', 'user_id']
    ];
    for (const [table, column] of checks) {
      if (await db.prepare(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? LIMIT 1`).get(userId)) return true;
    }
    return false;
  }

  async function sendTelegramMessage(chatId, text, buttonUrl) {
    if (!telegramBotToken) return;
    const keyboard = buttonUrl
      ? { inline_keyboard: [[{ text: 'Открыть ChemCalc', web_app: { url: buttonUrl } }]] }
      : undefined;
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(keyboard ? { reply_markup: keyboard } : {})
      }),
      signal: AbortSignal.timeout(5000)
    }).catch((cause) => console.error('Telegram sendMessage failed', cause.message));
  }


  async function getProposal(id, viewerId, raw = false) {
    const row = await db.prepare(`SELECT proposals.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login,
      (SELECT COALESCE(SUM(votes.value), 0) FROM votes JOIN proposals AS authored ON authored.id = votes.proposal_id WHERE authored.author_id = proposals.author_id) AS author_reputation
      FROM proposals JOIN users ON users.id = proposals.author_id WHERE proposals.id = ?`).get(id);
    if (!row) error(404, 'not_found', 'Заявка не найдена');
    return raw ? row : proposalView(db, row, viewerId);
  }

  async function presentRows(rows, viewerId) {
    const [history, votes] = await Promise.all([reviewHistoryMap(db, rows), viewerVoteMap(db, rows, viewerId)]);
    return Promise.all(rows.map((row) => proposalView(db, row, viewerId, history, votes)));
  }

  function parseTags(raw) {
    const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
    const tags = [];
    for (const value of values) {
      const tag = String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, '').replace(/^-+|-+$/g, '').slice(0, 30);
      if (tag && !tags.includes(tag)) tags.push(tag);
      if (tags.length >= 5) break;
    }
    return tags;
  }

  function validateQuestionBody(input) {
    const title = String(input.title || '').trim();
    const body = String(input.body || '').trim();
    if (!title || title.length > 200) error(422, 'invalid_title', 'Заголовок вопроса должен содержать от 1 до 200 символов');
    if (!body || body.length > 8000) error(422, 'invalid_body', 'Текст вопроса должен содержать от 1 до 8000 символов');
    return { title, body, tags: parseTags(input.tags) };
  }

  function validatePostBody(input, field = 'body', max = 8000) {
    const body = String(input[field] || '').trim();
    if (!body || body.length > max) error(422, 'invalid_body', `Текст должен содержать от 1 до ${max} символов`);
    return body;
  }

  function validateCommentBody(input) {
    const body = validatePostBody(input, 'body', 1000);
    if (body.length < 5) error(422, 'comment_too_short', 'Комментарий должен содержать не менее 5 символов');
    return body;
  }

  const QUESTION_SELECT = `SELECT questions.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login, users.avatar AS author_avatar,
    (SELECT COUNT(*) FROM answers WHERE answers.question_id = questions.id) AS answers_count,
    (SELECT COUNT(*) FROM answers WHERE answers.question_id = questions.id AND answers.accepted = 1) AS has_accepted,
    ${REPUTATION_SQL} AS author_reputation
    FROM questions JOIN users ON users.id = questions.author_id`;
  const ANSWER_SELECT = `SELECT answers.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login, users.avatar AS author_avatar, ${REPUTATION_SQL} AS author_reputation
    FROM answers JOIN users ON users.id = answers.author_id`;

  async function questionView(db, row, viewerId) {
    const question = { ...row };
    try { question.tags = JSON.parse(question.tags); } catch { question.tags = []; }
    if (!Array.isArray(question.tags)) question.tags = [];
    question.score = Number(question.score);
    question.answers_count = Number(question.answers_count ?? 0);
    question.has_accepted = Number(question.has_accepted ?? 0) > 0;
    question.author_reputation = Number(question.author_reputation ?? 0);
    question.closed = Number(question.closed ?? 0) > 0;
    question.closed_reason = question.closed_reason || '';
    question.duplicate_of = question.duplicate_of || null;
    question.views = Number(question.views ?? 0);
    question.viewer_vote = viewerId ? (await db.prepare("SELECT value FROM post_votes WHERE target_type = 'question' AND target_id = ? AND user_id = ?").get(question.id, viewerId))?.value ?? 0 : null;
    return question;
  }

  async function answerView(db, row, viewerId) {
    const answer = { ...row };
    answer.score = Number(answer.score);
    answer.accepted = Number(answer.accepted) > 0;
    answer.author_reputation = Number(answer.author_reputation ?? 0);
    answer.viewer_vote = viewerId ? (await db.prepare("SELECT value FROM post_votes WHERE target_type = 'answer' AND target_id = ? AND user_id = ?").get(answer.id, viewerId))?.value ?? 0 : null;
    answer.attachments = await uploadsFor('answer', answer.id);
    return answer;
  }

  async function commentsFor(db, type, id, viewerId) {
    const rows = await db.prepare(`SELECT comments.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login FROM comments
      JOIN users ON users.id = comments.author_id WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC, id ASC`).all(type, id);
    return rows;
  }

  async function getQuestion(id, viewerId) {
    const row = await db.prepare(QUESTION_SELECT + ' WHERE questions.id = ?').get(id);
    if (!row) error(404, 'not_found', 'Вопрос не найден');
    const question = await questionView(db, row, viewerId);
    question.attachments = await uploadsFor('question', id);
    return question;
  }

  async function getAnswer(id, viewerId) {
    const row = await db.prepare(ANSWER_SELECT + ' WHERE answers.id = ?').get(id);
    if (!row) error(404, 'not_found', 'Ответ не найден');
    return answerView(db, row, viewerId);
  }

  async function postVote(db, targetType, targetId, user, input, ownAuthorId, ownCode) {
    if (ownAuthorId === user.id) error(403, 'own_vote', ownCode || 'Нельзя голосовать за собственное сообщение');
    const recent = await db.prepare('SELECT COUNT(*) AS count FROM post_votes WHERE user_id = ? AND updated_at >= ?').get(user.id, new Date(Date.now() - 3600000).toISOString());
    if (Number(recent.count) >= MAX_VOTES_PER_HOUR) error(429, 'vote_rate_limit', 'Слишком много голосов за час.');
    const value = input.value === -1 ? -1 : input.value === 1 ? 1 : error(422, 'invalid_vote', 'Голос должен быть +1 или −1');
    const timestamp = new Date().toISOString();
    await transaction(db, async () => {
      await db.prepare(`INSERT INTO post_votes(target_type,target_id,user_id,value,created_at,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(target_type,target_id,user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(targetType, targetId, user.id, value, timestamp, timestamp);
      if (targetType === 'question') {
        await db.prepare('UPDATE questions SET score = (SELECT COALESCE(SUM(value), 0) FROM post_votes WHERE target_type = ? AND target_id = ?) WHERE id = ?').run(targetType, targetId, targetId);
      } else {
        await db.prepare('UPDATE answers SET score = (SELECT COALESCE(SUM(value), 0) FROM post_votes WHERE target_type = ? AND target_id = ?) WHERE id = ?').run(targetType, targetId, targetId);
      }
    });
    updated(targetType);
  }

  const MODERATOR_ROLES = ['admin', 'admin+', 'GOD'];
  const isModerator = (user) => Boolean(user && MODERATOR_ROLES.includes(user.privileges));
  const displayName = (user) => user?.nickname || user?.login || '';

  async function postEditsFor(db, type, id) {
    return db.prepare(`SELECT post_edits.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS editor_login FROM post_edits
      JOIN users ON users.id = post_edits.editor_id WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC, id ASC`).all(type, id);
  }

  async function recordPostEdit(db, type, id, editor, before, after, reason) {
    await db.prepare(`INSERT INTO post_edits(id,target_type,target_id,editor_id,title_before,title_after,body_before,body_after,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), type, id, editor.id, before.title ?? null, after.title ?? null, String(before.body || ''), String(after.body || ''), String(reason || '').slice(0, 1000), new Date().toISOString());
  }

  async function deletePostRows(db, type, ids) {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(`DELETE FROM comments WHERE target_type = ? AND target_id IN (${placeholders})`).run(type, ...ids);
    await db.prepare(`DELETE FROM post_votes WHERE target_type = ? AND target_id IN (${placeholders})`).run(type, ...ids);
    await db.prepare(`DELETE FROM post_edits WHERE target_type = ? AND target_id IN (${placeholders})`).run(type, ...ids);
  }

  async function deleteAnswerRecord(db, id) {
    await transaction(db, async () => {
      await deletePostRows(db, 'answer', [id]);
      await db.prepare('DELETE FROM answers WHERE id = ?').run(id);
    });
  }

  async function deleteQuestionRecord(db, id) {
    const answers = await db.prepare('SELECT id FROM answers WHERE question_id = ?').all(id);
    await transaction(db, async () => {
      await deletePostRows(db, 'question', [id]);
      await deletePostRows(db, 'answer', answers.map((answer) => answer.id));
      await db.prepare('DELETE FROM answers WHERE question_id = ?').run(id);
      await db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    });
  }

  async function notifyModerators(db, actorId, kind, message) {
    const moderators = await db.prepare("SELECT id FROM users WHERE privileges IN ('admin', 'admin+', 'GOD')").all();
    for (const moderator of moderators) await notifyUser(db, moderator.id, actorId, kind, message);
  }

  const SUPPORT_ROLES = ['admin+', 'GOD'];
  const isSupportAgent = (user) => Boolean(user && SUPPORT_ROLES.includes(user.privileges));
  const supportRate = new Map();
  function supportRateLimit(userId, bucket, max, windowMs) {
    const key = `${userId}:${bucket}`;
    const now = Date.now();
    const recent = (supportRate.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) error(429, 'support_rate_limit', 'Слишком много действий в поддержке. Повторите позже.');
    recent.push(now);
    supportRate.set(key, recent);
    if (supportRate.size > 5000) supportRate.delete(supportRate.keys().next().value);
  }
  const SUPPORT_CATEGORIES = [
    { key: 'bug', label: 'Ошибка в программе', hint: 'Что вы делали, что ожидали и что получилось. Приложите скриншот.' },
    { key: 'calculation', label: 'Вопрос по расчёту/химии', hint: 'Уравнение или задача, ваш вариант решения и ожидаемый ответ.' },
    { key: 'account', label: 'Аккаунт, вход, Telegram', hint: 'Логин или никнейм, способ входа и текст ошибки.' },
    { key: 'export', label: 'PDF/DOCX и печать', hint: 'Формат, справочник, страница и что именно не так.' },
    { key: 'community', label: 'Сообщество и модерация', hint: 'Ссылка на вопрос или ответ и краткое описание ситуации.' },
    { key: 'billing', label: 'Оплата и подписка', hint: 'План, дата платежа и последние 4 цифры карты. Не присылайте полный номер.' },
    { key: 'idea', label: 'Предложение', hint: 'Что улучшить и зачем это нужно.' },
    { key: 'other', label: 'Другое', hint: 'Опишите ситуацию как можно точнее.' }
  ];
  const SUPPORT_IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const REVIEW_FEATURES = ['calculations', 'redox', 'stoichiometry', 'references', 'reports', 'community', 'telegram', 'design'];
  const REVIEW_CONTEXTS = ['calculator', 'stoichiometry', 'settings'];
  const reviewAttempts = new Map();
  function reviewRateLimit(key) {
    const now = Date.now();
    const recent = (reviewAttempts.get(key) || []).filter((time) => now - time < 60 * 60 * 1000);
    if (recent.length >= 12) error(429, 'review_rate_limit', 'Слишком много отзывов. Попробуйте позже.');
    recent.push(now);
    reviewAttempts.set(key, recent);
    if (reviewAttempts.size > 5000) reviewAttempts.delete(reviewAttempts.keys().next().value);
  }
  function reviewIdentity(request, response, user) {
    if (user) return { key: `u:${user.id}`, userId: user.id, setCookie: '' };
    let token = requestCookie(request, 'chemcalc_reviewer');
    let setCookie = '';
    if (!token) {
      token = randomBytes(18).toString('base64url');
      setCookie = `chemcalc_reviewer=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
    }
    return { key: `a:${createHash('sha256').update(token).digest('hex')}`, userId: null, setCookie };
  }
  function reviewView(row) {
    if (!row) return null;
    return {
      id: row.id,
      rating: Number(row.rating),
      usability: row.usability === null || row.usability === undefined ? null : Number(row.usability),
      features: (() => { try { return JSON.parse(row.features || '[]'); } catch { return []; } })(),
      suggestions: row.suggestions || '',
      context: row.context || 'settings',
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: row.user_id ? { id: row.user_id, login: row.login || '', nickname: row.nickname || row.login || '' } : null
    };
  }
  const SUPPORT_STATUSES = ['new', 'open', 'waiting_user', 'resolved', 'closed', 'deleted'];
  const SUPPORT_THREAD_SELECT = `SELECT support_threads.*,
    COALESCE(NULLIF(author.nickname, ''), author.login) AS author_nickname,
    author.login AS author_login, author.privileges AS author_privileges, author.avatar AS author_avatar,
    COALESCE(NULLIF(assignee.nickname, ''), assignee.login) AS assignee_nickname
    FROM support_threads
    JOIN users AS author ON author.id = support_threads.author_id
    LEFT JOIN users AS assignee ON assignee.id = support_threads.assigned_to`;

  function supportCategory(key) {
    return SUPPORT_CATEGORIES.find((item) => item.key === key) || null;
  }

  async function supportUnreadFor(db, threadId, userId) {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM support_messages
      WHERE thread_id = ? AND visibility = 'public' AND author_id <> ?
      AND created_at > COALESCE((SELECT last_read_at FROM support_reads WHERE thread_id = ? AND user_id = ?), '')`)
      .get(threadId, userId, threadId, userId);
    return Number(row?.count || 0);
  }

  async function supportRowsFor(db, { viewer, scope = 'mine', status = '', category = '', query = '', page }) {
    const conditions = [];
    const parameters = [];
    if (scope === 'inbox') {
      if (!isSupportAgent(viewer)) error(403, 'forbidden', 'Очередь поддержки доступна admin+ и GOD');
      conditions.push('support_threads.status <> ?');
      parameters.push('deleted');
    } else {
      conditions.push('support_threads.author_id = ?', 'support_threads.status <> ?');
      parameters.push(viewer.id, 'deleted');
    }
    if (SUPPORT_STATUSES.includes(status) && status !== 'deleted') {
      conditions[conditions.length - 1] = 'support_threads.status = ?';
      parameters[parameters.length - 1] = status;
    } else if (status === 'deleted' && scope === 'inbox') {
      conditions[conditions.length - 1] = 'support_threads.status = ?';
      parameters[parameters.length - 1] = 'deleted';
    }
    if (supportCategory(category)) {
      conditions.push('support_threads.category = ?');
      parameters.push(category);
    }
    const search = String(query || '').trim().slice(0, 120);
    if (search) {
      conditions.push('(support_threads.subject LIKE ? OR support_threads.number LIKE ? OR author.login LIKE ? OR author.nickname LIKE ?)');
      const like = `%${search}%`;
      parameters.push(like, like, like, like);
    }
    const where = conditions.length ? conditions.join(' AND ') : '1 = 1';
    const total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM support_threads JOIN users AS author ON author.id = support_threads.author_id WHERE ${where}`).get(...parameters)).count);
    const rows = await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE ${where} ORDER BY support_threads.last_message_at DESC LIMIT ? OFFSET ?`)
      .all(...parameters, page.limit, page.offset);
    return {
      rows,
      total
    };
  }

  async function supportThreadView(db, row, viewer, detail = false) {
    const thread = {
      id: row.id,
      number: row.number,
      category: row.category,
      category_label: supportCategory(row.category)?.label || row.category,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      assigned_to: row.assigned_to,
      assigned_nickname: row.assignee_nickname || '',
      author: {
        id: row.author_id,
        login: row.author_login,
        nickname: row.author_nickname,
        privileges: row.author_privileges,
        avatar: row.author_avatar || ''
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_message_at: row.last_message_at,
      closed_at: row.closed_at,
      resolution_note: row.resolution_note,
      deleted_at: row.deleted_at,
      delete_reason: row.delete_reason,
      helpful_at: row.user_helpful_at,
      unread: await supportUnreadFor(db, row.id, viewer.id)
    };
    if (!detail) return thread;
    const messages = await db.prepare(`SELECT support_messages.*,
      COALESCE(NULLIF(users.nickname, ''), users.login) AS author_nickname,
      users.login AS author_login, users.privileges AS author_privileges, users.avatar AS author_avatar
      FROM support_messages JOIN users ON users.id = support_messages.author_id
      WHERE support_messages.thread_id = ?
      ${isSupportAgent(viewer) ? '' : "AND support_messages.visibility = 'public'"}
      ORDER BY support_messages.created_at ASC, support_messages.id ASC`).all(row.id);
    const attachments = await db.prepare('SELECT id, message_id, thread_id, filename, mime, size, created_at FROM support_attachments WHERE thread_id = ? ORDER BY created_at ASC').all(row.id);
    const byMessage = new Map();
    for (const attachment of attachments) {
      if (!byMessage.has(attachment.message_id)) byMessage.set(attachment.message_id, []);
      byMessage.get(attachment.message_id).push(attachment);
    }
    thread.messages = messages.map((message) => ({
      id: message.id,
      body: message.body,
      visibility: message.visibility,
      created_at: message.created_at,
      author: {
        id: message.author_id,
        login: message.author_login,
        nickname: message.author_nickname,
        privileges: message.author_privileges,
        avatar: message.author_avatar || ''
      },
      attachments: byMessage.get(message.id) || []
    }));
    if (isSupportAgent(viewer)) {
      thread.events = await db.prepare(`SELECT support_events.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS actor_nickname
        FROM support_events LEFT JOIN users ON users.id = support_events.actor_id
        WHERE support_events.thread_id = ? ORDER BY support_events.created_at ASC`).all(row.id);
    }
    return thread;
  }

  async function getSupportThreadRow(db, id, viewer) {
    const row = await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id);
    if (!row) error(404, 'not_found', 'Обращение не найдено');
    if (Number(row.author_id) !== Number(viewer.id) && !isSupportAgent(viewer)) error(404, 'not_found', 'Обращение не найдено');
    if (row.status === 'deleted' && !isSupportAgent(viewer)) error(404, 'not_found', 'Обращение не найдено');
    return row;
  }

  async function markSupportRead(db, threadId, userId) {
    await db.prepare(`INSERT INTO support_reads(thread_id,user_id,last_read_at) VALUES(?,?,?)
      ON CONFLICT(thread_id,user_id) DO UPDATE SET last_read_at = excluded.last_read_at`)
      .run(threadId, userId, new Date().toISOString());
  }

  async function supportEvent(db, threadId, actorId, action, note = '') {
    await db.prepare('INSERT INTO support_events(id,thread_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), threadId, actorId, action, String(note || '').slice(0, 500), new Date().toISOString());
  }

  async function attachSupportPhotos(db, threadId, messageId, userId, ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    if (ids.length > 3) error(422, 'too_many_attachments', 'К сообщению можно приложить не более 3 фото');
    for (const id of [...new Set(ids.map((value) => String(value || '')).filter(Boolean))]) {
      const photo = await db.prepare('SELECT id, uploader_id, message_id FROM support_attachments WHERE id = ?').get(id);
      if (!photo || Number(photo.uploader_id) !== Number(userId) || photo.message_id) error(422, 'invalid_attachment', 'Некорректное вложение');
      await db.prepare('UPDATE support_attachments SET thread_id = ?, message_id = ? WHERE id = ?').run(threadId, messageId, id);
    }
  }

  async function notifySupportAgents(db, actorId, kind, message) {
    const agents = await db.prepare("SELECT id FROM users WHERE privileges IN ('admin+', 'GOD')").all();
    for (const agent of agents) await notifyUser(db, agent.id, actorId, kind, message);
  }

  function supportStatusAfterMessage(thread, user, internal) {
    if (internal) return thread.status;
    if (isSupportAgent(user)) return thread.status === 'resolved' ? 'resolved' : 'waiting_user';
    return 'open';
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'self'; object-src 'none'");
    if (process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https') {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/api/events' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        response.write('retry: 3000\n\n');
        clients.add(response);
        const timer = setInterval(() => {
          if (!response.writableEnded) response.write(': heartbeat\n\n');
        }, 15000);
        timer.unref();
        const update = (event) => {
          if (!response.writableEnded) response.write(`event: community-update\ndata: ${JSON.stringify(event)}\n\n`);
        };
        events.on('update', update);
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          events.off('update', update);
          clients.delete(response);
        };
        request.once('close', cleanup);
        response.once('close', cleanup);
        response.once('error', cleanup);
        return;
      }
      if (path === '/api/health' && request.method === 'GET') return send(response, 200, { ok: true, database: db.kind || 'sqlite', schemaVersion: 9 });
      if (path === '/api/files/temp' && request.method === 'POST') {
        rateLimit(request);
        const input = await body(request, 8_000_000);
        const allowed = {
          'application/pdf': 'pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
        };
        const extension = allowed[input.type];
        if (!extension) error(422, 'invalid_type', 'Поддерживаются только PDF и DOCX');
        const data = String(input.data || '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !data) error(422, 'invalid_file', 'Некорректный файл');
        const buffer = Buffer.from(data, 'base64');
        if (!buffer.length || buffer.length > 6_000_000) error(413, 'too_large', 'Файл слишком большой');
        const now = Date.now();
        for (const [key, file] of tempFiles) if (file.expiresAt <= now) tempFiles.delete(key);
        let totalSize = 0;
        for (const file of tempFiles.values()) totalSize += file.buffer.length;
        while (tempFiles.size && (tempFiles.size >= 20 || totalSize + buffer.length > 40_000_000)) {
          const [oldKey, oldFile] = tempFiles.entries().next().value;
          tempFiles.delete(oldKey);
          totalSize -= oldFile.buffer.length;
        }
        const token = randomUUID();
        const filename = String(input.filename || `report.${extension}`)
          .replace(/[^\p{L}\p{N}._ -]/gu, '_')
          .slice(0, 120) || `report.${extension}`;
        tempFiles.set(token, { buffer, filename, type: input.type, expiresAt: now + 10 * 60 * 1000 });
        const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const localHost = /^(127\.|localhost|\[::1\])/.test(String(request.headers.host || ''));
        const origin = String(publicUrl || '').replace(/\/+$/, '')
          || `${forwardedProto || (localHost ? 'http' : 'https')}://${request.headers.host}`;
        return send(response, 201, { url: `${origin}/api/files/temp/${token}`, expiresAt: new Date(now + 10 * 60 * 1000).toISOString() });
      }
      const tempFileMatch = path.match(/^\/api\/files\/temp\/([0-9a-f-]{36})$/);
      if (tempFileMatch && request.method === 'GET') {
        const file = tempFiles.get(tempFileMatch[1]);
        if (!file || file.expiresAt <= Date.now()) {
          tempFiles.delete(tempFileMatch[1]);
          error(404, 'not_found', 'Файл не найден или устарел');
        }
        const safeName = file.filename.replace(/["\\\r\n]/g, '_');
        response.writeHead(200, {
          'Content-Type': file.type,
          'Content-Length': file.buffer.length,
          'Content-Disposition': `attachment; filename="report.${file.filename.split('.').pop() || 'file'}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return response.end(file.buffer);
      }
      if (path === '/api/uploads' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request, 7_500_000);
        const mime = String(input.type || '');
        if (!UPLOAD_TYPES[mime]) error(422, 'invalid_upload_type', 'Этот формат файла не поддерживается');
        const data = String(input.data || '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !data) error(422, 'invalid_upload', 'Некорректный файл');
        const buffer = Buffer.from(data, 'base64');
        if (!buffer.length || buffer.length > 5_000_000) error(413, 'too_large', 'Файл больше 5 МБ');
        const filename = String(input.filename || `file.${UPLOAD_TYPES[mime]}`)
          .replace(/[^\p{L}\p{N}._ -]/gu, '_')
          .slice(0, 120) || `file.${UPLOAD_TYPES[mime]}`;
        const id = randomUUID();
        await db.prepare('INSERT INTO uploads(id, owner_id, filename, mime, size, data, created_at) VALUES(?,?,?,?,?,?,?)')
          .run(id, user.id, filename, mime, buffer.length, buffer, new Date().toISOString());
        await db.prepare('DELETE FROM uploads WHERE question_id IS NULL AND answer_id IS NULL AND created_at < ?')
          .run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
        return send(response, 201, { upload: { id, filename, mime, size: buffer.length } });
      }
      const uploadMatch = path.match(/^\/api\/uploads\/([0-9a-f-]{36})$/);
      if (uploadMatch && request.method === 'GET') {
        const upload = await db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadMatch[1]);
        if (!upload) error(404, 'not_found', 'Файл не найден');
        const inline = upload.mime.startsWith('image/');
        const safeName = String(upload.filename).replace(/["\\\r\n]/g, '_');
        response.writeHead(200, {
          'Content-Type': upload.mime,
          'Content-Length': upload.data.length,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="file.${UPLOAD_TYPES[upload.mime] || 'bin'}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff'
        });
        return response.end(upload.data);
      }
      if (path === '/api/rules' && request.method === 'GET') return send(response, 200, await communityPackage(db));
      if (path === '/api/auth/register' && request.method === 'POST') {
        rateLimit(request);
        const input = await body(request);
        const canonical = validateCredentials(input);
        if (await db.prepare('SELECT id FROM users WHERE login_canonical = ?').get(canonical)) error(409, 'login_taken', 'Этот логин уже занят');
        const timestamp = new Date().toISOString();
        const userId = (await db.prepare('INSERT INTO users(login,login_canonical,nickname,password_hash,privileges,created_at,last_login_at) VALUES(?,?,?,?,?,?,?)')
          .run(String(input.login).trim(), canonical, String(input.login).trim(), hashPassword(input.password), 'basic', timestamp, timestamp)).lastInsertRowid;
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        updated('user');
        return authResponse(response, 201, user, await createSession(db, userId));
      }
      if (path === '/api/auth/login' && request.method === 'POST') {
        rateLimit(request);
        const input = await body(request);
        const canonical = normalizeLogin(input.login);
        const user = await db.prepare('SELECT * FROM users WHERE login_canonical = ? AND deleted_at IS NULL').get(canonical);
        if (!user || !verifyPassword(input.password || '', user.password_hash)) error(401, 'invalid_credentials', 'Неверный логин или пароль');
        user.last_login_at = new Date().toISOString();
        user.reputation = await reputationForUser(db, user.id);
        await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(user.last_login_at, user.id);
        return authResponse(response, 200, user, await createSession(db, user.id));
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        updated('user');
        return send(response, 200, { ok: true }, { 'Set-Cookie': await destroySession(db, request) });
      }
      if (path === '/api/auth/account' && request.method === 'DELETE') {
        const current = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        const confirmation = String(input.confirm || '').trim().toUpperCase();
        if (!['УДАЛИТЬ', 'DELETE'].includes(confirmation)) error(422, 'confirmation_required', 'Введите УДАЛИТЬ для подтверждения');
        if (Number(current.password_set) !== 0 && !verifyPassword(input.password || '', current.password_hash)) {
          error(401, 'invalid_password', 'Неверный пароль');
        }
        const timestamp = new Date().toISOString();
        await transaction(db, async () => {
          await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(current.id);
          await db.prepare('DELETE FROM question_flags WHERE user_id = ?').run(current.id);
          await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.id);
          await db.prepare(`UPDATE users SET login = ?, login_canonical = ?, nickname = ?, avatar = '', privacy = 'private',
            telegram_id = NULL, telegram_username = NULL, telegram_photo_url = NULL, password_hash = ?, password_set = 0,
            deleted_at = ?, privileges = 'basic' WHERE id = ?`)
            .run(`deleted_${current.id}`, normalizeLogin(`deleted_${current.id}`), 'Удалённый пользователь', hashPassword(randomBytes(32).toString('hex')), timestamp, current.id);
        });
        updated('user');
        return send(response, 200, { ok: true }, { 'Set-Cookie': await destroySession(db, request) });
      }
      if (path === '/api/auth/telegram' && request.method === 'POST') {
        rateLimit(request);
        if (!telegramBotToken) error(503, 'telegram_disabled', 'Telegram-вход не настроен на сервере');
        const input = await body(request);
        const verified = verifyTelegramInitData(input.initData, telegramBotToken);
        if (!verified) error(401, 'invalid_telegram_data', 'Не удалось проверить данные Telegram');
        await consumeTelegramAuth(verified.queryId || verified.hash);
        const telegramId = Number(verified.user.id);
        const telegramUsername = /^[A-Za-z0-9_]{1,64}$/.test(String(verified.user.username || '')) ? String(verified.user.username) : '';
        const telegramPhoto = typeof verified.user.photo_url === 'string' && /^https:\/\//.test(verified.user.photo_url)
          ? verified.user.photo_url.slice(0, 2048)
          : '';
        const timestamp = new Date().toISOString();
        let user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
        if (!user) {
          const login = await uniqueTelegramLogin(telegramId);
          const nickname = telegramDisplayName(verified.user);
          const userId = (await db.prepare(`INSERT INTO users(login, login_canonical, nickname, telegram_id, telegram_username, telegram_photo_url, password_hash, password_set, privileges, created_at, last_login_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
            .run(login, normalizeLogin(login), nickname, telegramId, telegramUsername, telegramPhoto, hashPassword(randomBytes(32).toString('hex')), 0, 'basic', timestamp, timestamp)).lastInsertRowid;
          user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          updated('user');
        } else {
          await db.prepare('UPDATE users SET telegram_username = ?, telegram_photo_url = ?, last_login_at = ? WHERE id = ?')
            .run(telegramUsername, telegramPhoto, timestamp, user.id);
          user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        }
        user.reputation = await reputationForUser(db, user.id);
        return authResponse(response, 200, user, await createSession(db, user.id));
      }
      if (path === '/api/auth/telegram/link' && request.method === 'POST') {
        const current = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        if (!telegramBotToken) error(503, 'telegram_disabled', 'Telegram-вход не настроен на сервере');
        const input = await body(request);
        const verified = verifyTelegramInitData(input.initData, telegramBotToken);
        if (!verified) error(401, 'invalid_telegram_data', 'Не удалось проверить данные Telegram');
        await consumeTelegramAuth(verified.queryId || verified.hash);
        const telegramId = Number(verified.user.id);
        const existing = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
        if (existing && Number(existing.id) !== Number(current.id)) {
          const telegramOnly = String(existing.login || '').startsWith('tg_') && Number(existing.telegram_id) === telegramId;
          if (!telegramOnly || await telegramAccountHasActivity(existing.id)) {
            error(409, 'telegram_already_linked', 'Этот Telegram уже привязан к другому аккаунту');
          }
          await db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
        }
        const telegramUsername = /^[A-Za-z0-9_]{1,64}$/.test(String(verified.user.username || '')) ? String(verified.user.username) : '';
        const telegramPhoto = typeof verified.user.photo_url === 'string' && /^https:\/\//.test(verified.user.photo_url)
          ? verified.user.photo_url.slice(0, 2048)
          : '';
        try {
          await db.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, telegram_photo_url = ? WHERE id = ?')
            .run(telegramId, telegramUsername, telegramPhoto, current.id);
        } catch (cause) {
          if (['23505', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(cause.code) || /UNIQUE|constraint/i.test(cause.message || '')) {
            error(409, 'telegram_already_linked', 'Этот Telegram уже привязан к другому аккаунту');
          }
          throw cause;
        }
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(current.id);
        user.reputation = await reputationForUser(db, current.id);
        updated('user');
        return send(response, 200, { user: publicUser(user) });
      }
      if (path === '/api/auth/telegram/merge' && request.method === 'POST') {
        rateLimit(request);
        const current = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        if (!current.telegram_id || !String(current.login).startsWith('tg_')) {
          error(409, 'not_telegram_account', 'Объединение доступно только для аккаунта, созданного через Telegram');
        }
        const input = await body(request);
        const targetLogin = normalizeLogin(input.login);
        const target = await db.prepare('SELECT * FROM users WHERE login_canonical = ?').get(targetLogin);
        if (!target || !verifyPassword(input.password || '', target.password_hash)) {
          error(401, 'invalid_credentials', 'Неверный логин или пароль существующего аккаунта');
        }
        if (Number(target.id) === Number(current.id)) error(422, 'same_account', 'Это тот же аккаунт');
        if (target.deleted_at) error(401, 'invalid_credentials', 'Неверный логин или пароль существующего аккаунта');
        if (target.telegram_id && Number(target.telegram_id) !== Number(current.telegram_id)) {
          error(409, 'telegram_already_linked', 'К этому аккаунту уже привязан другой Telegram');
        }
        const now = new Date().toISOString();
        await transaction(db, async () => {
          await db.prepare('UPDATE proposals SET author_id = ? WHERE author_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE proposals SET reviewed_by = ? WHERE reviewed_by = ?').run(target.id, current.id);
          await db.prepare('UPDATE production_rules SET published_by = ? WHERE published_by = ?').run(target.id, current.id);
          await db.prepare('UPDATE questions SET author_id = ? WHERE author_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE answers SET author_id = ? WHERE author_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE comments SET author_id = ? WHERE author_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE post_edits SET editor_id = ? WHERE editor_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE review_events SET actor_id = ? WHERE actor_id = ?').run(target.id, current.id);
          await db.prepare('UPDATE rule_versions SET published_by = ? WHERE published_by = ?').run(target.id, current.id);
          for (const vote of await db.prepare('SELECT id, proposal_id FROM votes WHERE user_id = ?').all(current.id)) {
            if (await db.prepare('SELECT id FROM votes WHERE proposal_id = ? AND user_id = ?').get(vote.proposal_id, target.id)) {
              await db.prepare('DELETE FROM votes WHERE id = ?').run(vote.id);
            } else {
              await db.prepare('UPDATE votes SET user_id = ? WHERE id = ?').run(target.id, vote.id);
            }
          }
          for (const vote of await db.prepare('SELECT id, target_type, target_id FROM post_votes WHERE user_id = ?').all(current.id)) {
            if (await db.prepare('SELECT id FROM post_votes WHERE target_type = ? AND target_id = ? AND user_id = ?').get(vote.target_type, vote.target_id, target.id)) {
              await db.prepare('DELETE FROM post_votes WHERE id = ?').run(vote.id);
            } else {
              await db.prepare('UPDATE post_votes SET user_id = ? WHERE id = ?').run(target.id, vote.id);
            }
          }
          for (const flag of await db.prepare('SELECT id, question_id FROM question_flags WHERE user_id = ?').all(current.id)) {
            if (await db.prepare('SELECT id FROM question_flags WHERE question_id = ? AND user_id = ?').get(flag.question_id, target.id)) {
              await db.prepare('DELETE FROM question_flags WHERE id = ?').run(flag.id);
            } else {
              await db.prepare('UPDATE question_flags SET user_id = ? WHERE id = ?').run(target.id, flag.id);
            }
          }
          await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(current.id);
          await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.id);
          await db.prepare('DELETE FROM users WHERE id = ?').run(current.id);
          await db.prepare('UPDATE users SET telegram_id = ?, telegram_username = ?, telegram_photo_url = ?, last_login_at = ? WHERE id = ?')
            .run(current.telegram_id, current.telegram_username || '', current.telegram_photo_url || '', now, target.id);
        });
        updated('user');
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
        user.reputation = await reputationForUser(db, target.id);
        return authResponse(response, 200, user, await createSession(db, target.id));
      }
      if (path === '/api/telegram/webhook' && request.method === 'POST') {        if (!telegramBotToken) error(503, 'telegram_disabled', 'Telegram-бот не настроен на сервере');
        if (telegramWebhookSecret && request.headers['x-telegram-bot-api-secret-token'] !== telegramWebhookSecret) {
          error(403, 'invalid_webhook_secret', 'Неверный секрет вебхука');
        }
        const update = await body(request);
        const message = update.message;
        if (message?.chat?.id && typeof message.text === 'string' && /^\/(start|app)(@\w+)?(\s|$)/.test(message.text)) {
          const url = String(publicUrl || '').replace(/\/+$/, '') || 'https://chemcalc-a5y5.onrender.com';
          const webAppUrl = `${url}${url.includes('?') ? '&' : '?'}tg=1`;
          await sendTelegramMessage(message.chat.id, 'ChemCalc — химический калькулятор. Откройте приложение:', webAppUrl);
        }
        return send(response, 200, { ok: true });
      }
      if (path === '/api/auth/profile' && request.method === 'PATCH') {
        const current = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        const updates = [];
        const parameters = [];
        if (input.login !== undefined) error(422, 'login_immutable', 'Логин изменить нельзя: он используется для входа. Измените никнейм.');
        if (input.nickname !== undefined) {
          const nickname = String(input.nickname).trim();
          if (!/^[\p{L}\p{N} ._-]{2,40}$/u.test(nickname)) error(422, 'invalid_nickname', 'Никнейм должен содержать 2–40 букв, цифр, пробелов, точек, подчёркиваний или дефисов');
          updates.push('nickname = ?');
          parameters.push(nickname);
        }
        if (input.avatar !== undefined) {
          const avatar = input.avatar === null ? '' : String(input.avatar);
          if (avatar && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 120000)) error(422, 'invalid_avatar', 'Некорректный формат аватара');
          updates.push('avatar = ?');
          parameters.push(avatar);
        }
        if (input.privacy !== undefined) {
          if (!['public', 'private'].includes(input.privacy)) error(422, 'invalid_privacy', 'Некорректная настройка приватности');
          updates.push('privacy = ?');
          parameters.push(input.privacy);
        }
        if (!updates.length) error(422, 'no_changes', 'Нет изменений профиля');
        parameters.push(current.id);
        await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...parameters);
        const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(current.id);
        updatedUser.reputation = await reputationForUser(db, current.id);
        updated('user');
        return send(response, 200, { user: publicUser(updatedUser) });
      }
      if (path === '/api/auth/me' && request.method === 'GET') {
        const session = await getSession(db, request);
        const user = await requireUser(db, request);
        user.reputation = await reputationForUser(db, user.id);
        return send(response, 200, { user: publicUser(user), csrfToken: session.csrf_token, expiresAt: session.expires_at }, { 'Set-Cookie': sessionCookie(session.token) });
      }
      if (path === '/api/notifications' && request.method === 'GET') {
        const user = await requireUser(db, request);
        return send(response, 200, await notificationsForUser(db, user.id));
      }
      if (path === '/api/notifications/read-all' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        await db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(new Date().toISOString(), user.id);
        return send(response, 200, await notificationsForUser(db, user.id));
      }
      const notificationMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notificationMatch && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const result = await db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(new Date().toISOString(), notificationMatch[1], user.id);
        if (!result.changes) error(404, 'not_found', 'Уведомление не найдено');
        return send(response, 200, await notificationsForUser(db, user.id));
      }
      if (path === '/api/support/categories' && request.method === 'GET') {
        return send(response, 200, { categories: SUPPORT_CATEGORIES });
      }
      if (path === '/api/support/unread' && request.method === 'GET') {
        const user = await requireUser(db, request);
        const rows = isSupportAgent(user)
          ? await db.prepare("SELECT id FROM support_threads WHERE status <> 'deleted'").all()
          : await db.prepare("SELECT id FROM support_threads WHERE author_id = ? AND status <> 'deleted'").all(user.id);
        let unread = 0;
        for (const row of rows) unread += await supportUnreadFor(db, row.id, user.id);
        return send(response, 200, { unread });
      }
      if (path === '/api/support/attachments' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request, 8_000_000);
        supportRateLimit(user.id, 'photo', 30, 60 * 60 * 1000);
        const mime = String(input.type || '').toLowerCase();
        if (!SUPPORT_IMAGE_TYPES[mime]) error(422, 'invalid_attachment_type', 'Можно прикрепить только PNG, JPEG или WebP');
        const data = String(input.data || '');
        if (!data || data.length > 7_000_000) error(413, 'attachment_too_large', 'Фото слишком большое');
        let buffer;
        try { buffer = Buffer.from(data, 'base64'); } catch { error(422, 'invalid_attachment', 'Некорректное фото'); }
        if (!buffer?.length || buffer.length > 5_000_000) error(413, 'attachment_too_large', 'Фото должно быть меньше 5 МБ');
        const validMagic = mime === 'image/png'
          ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          : mime === 'image/jpeg'
            ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
            : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!validMagic) error(422, 'invalid_attachment', 'Файл не является изображением выбранного формата');
        const filename = String(input.filename || `photo.${SUPPORT_IMAGE_TYPES[mime]}`).replace(/["\\\r\n]/g, '_').slice(0, 160) || `photo.${SUPPORT_IMAGE_TYPES[mime]}`;
        const id = randomUUID();
        await db.prepare('INSERT INTO support_attachments(id,uploader_id,filename,mime,size,data,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(id, user.id, filename, mime, buffer.length, buffer, new Date().toISOString());
        await db.prepare("DELETE FROM support_attachments WHERE message_id IS NULL AND created_at < ?").run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
        return send(response, 201, { attachment: { id, filename, mime, size: buffer.length } });
      }
      const supportAttachmentMatch = path.match(/^\/api\/support\/attachments\/([^/]+)$/);
      if (supportAttachmentMatch && request.method === 'GET') {
        const user = await requireUser(db, request);
        const attachment = await db.prepare(`SELECT support_attachments.*, support_threads.author_id AS thread_author, support_threads.status AS thread_status
          FROM support_attachments LEFT JOIN support_threads ON support_threads.id = support_attachments.thread_id
          WHERE support_attachments.id = ?`).get(supportAttachmentMatch[1]);
        if (!attachment) error(404, 'not_found', 'Файл не найден');
        const allowed = Number(attachment.uploader_id) === Number(user.id)
          || (attachment.thread_id && (Number(attachment.thread_author) === Number(user.id) || isSupportAgent(user)));
        if (!allowed || (attachment.thread_status === 'deleted' && !isSupportAgent(user))) {
          error(404, 'not_found', 'Файл не найден');
        }
        const safeName = String(attachment.filename).replace(/["\\\r\n]/g, '_');
        response.writeHead(200, {
          'Content-Type': attachment.mime,
          'Content-Length': attachment.data.length,
          'Content-Disposition': `inline; filename="photo.${SUPPORT_IMAGE_TYPES[attachment.mime] || 'jpg'}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return response.end(attachment.data);
      }
      if (path === '/api/support/threads' && request.method === 'GET') {
        const user = await requireUser(db, request);
        const page = pagination(url);
        const scope = url.searchParams.get('scope') === 'inbox' ? 'inbox' : 'mine';
        const { rows, total } = await supportRowsFor(db, {
          viewer: user,
          scope,
          status: url.searchParams.get('status') || '',
          category: url.searchParams.get('category') || '',
          query: url.searchParams.get('q') || '',
          page
        });
        return send(response, 200, {
          threads: await Promise.all(rows.map((row) => supportThreadView(db, row, user))),
          pagination: paginationResult(page, total)
        });
      }
      if (path === '/api/support/threads' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        supportRateLimit(user.id, 'thread', 5, 60 * 60 * 1000);
        const category = String(input.category || '');
        if (!supportCategory(category)) error(422, 'invalid_category', 'Выберите тему обращения');
        const subject = String(input.subject || '').trim();
        if (subject.length < 4 || subject.length > 160) error(422, 'invalid_subject', 'Тема должна содержать 4–160 символов');
        const text = String(input.body || '').trim();
        if (text.length < 10 || text.length > 8000) error(422, 'invalid_body', 'Описание должно содержать 10–8000 символов');
        const id = randomUUID();
        const messageId = randomUUID();
        const timestamp = new Date().toISOString();
        const number = `SC-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
        await transaction(db, async () => {
          await db.prepare(`INSERT INTO support_threads(id,number,author_id,category,subject,status,priority,created_at,updated_at,last_message_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, number, user.id, category, subject, 'new', 'normal', timestamp, timestamp, timestamp);
          await db.prepare('INSERT INTO support_messages(id,thread_id,author_id,body,visibility,created_at) VALUES(?,?,?,?,?,?)')
            .run(messageId, id, user.id, text, 'public', timestamp);
          await attachSupportPhotos(db, id, messageId, user.id, input.attachments);
        });
        const row = await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id);
        await markSupportRead(db, id, user.id);
        await notifySupportAgents(db, user.id, 'support_new', `Новое обращение ${number}: ${subject}`);
        updated('support');
        return send(response, 201, { thread: await supportThreadView(db, row, user, true) });
      }
      const supportThreadMatch = path.match(/^\/api\/support\/threads\/([^/]+)(?:\/(messages|helpful|close|reopen|delete|restore|assign))?$/);
      if (supportThreadMatch) {
        const [, id, action] = supportThreadMatch;
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], Boolean(action) && request.method !== 'GET');
        const row = await getSupportThreadRow(db, id, user);
        if (request.method === 'GET' && !action) {
          if (row.status === 'deleted' && !isSupportAgent(user)) error(404, 'not_found', 'Обращение не найдено');
          const thread = await supportThreadView(db, row, user, true);
          await markSupportRead(db, id, user.id);
          return send(response, 200, { thread });
        }
        if (request.method === 'POST' && action === 'messages') {
          if (row.status === 'deleted') error(404, 'not_found', 'Обращение не найдено');
          if (row.status === 'closed') error(409, 'thread_closed', 'Обращение закрыто');
          const input = await body(request);
          const text = String(input.body || '').trim();
          supportRateLimit(user.id, 'message', 60, 60 * 60 * 1000);
          if (!text || text.length > 8000) error(422, 'invalid_body', 'Введите сообщение до 8000 символов');
          const internal = Boolean(input.internal);
          if (internal && !isSupportAgent(user)) error(403, 'forbidden', 'Внутренние заметки доступны только поддержке');
          const messageId = randomUUID();
          const timestamp = new Date().toISOString();
          const nextStatus = supportStatusAfterMessage(row, user, internal);
          await transaction(db, async () => {
            await db.prepare('INSERT INTO support_messages(id,thread_id,author_id,body,visibility,created_at) VALUES(?,?,?,?,?,?)')
              .run(messageId, id, user.id, text, internal ? 'internal' : 'public', timestamp);
            await attachSupportPhotos(db, id, messageId, user.id, input.attachments);
            await db.prepare('UPDATE support_threads SET status = ?, updated_at = ?, last_message_at = ? WHERE id = ?')
              .run(nextStatus, timestamp, timestamp, id);
            await supportEvent(db, id, user.id, internal ? 'internal_note' : 'message', text.slice(0, 160));
          });
          if (!internal) {
            if (isSupportAgent(user)) await notifyUser(db, row.author_id, user.id, 'support_reply', `Ответ поддержки по обращению ${row.number}`);
            else await notifySupportAgents(db, user.id, 'support_reply', `Новое сообщение в ${row.number}`);
          }
          const updatedRow = await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id);
          await markSupportRead(db, id, user.id);
          return send(response, 201, { thread: await supportThreadView(db, updatedRow, user, true) });
        }
        if (request.method === 'POST' && action === 'helpful') {
          if (Number(row.author_id) !== Number(user.id)) error(403, 'forbidden', 'Отметить может только автор обращения');
          const timestamp = new Date().toISOString();
          await db.prepare('UPDATE support_threads SET user_helpful_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, id);
          await supportEvent(db, id, user.id, 'helpful');
          return send(response, 200, { ok: true });
        }
        if (request.method === 'POST' && action === 'close') {
          if (!isSupportAgent(user)) error(403, 'forbidden', 'Закрывать обращения может только admin+ или GOD');
          if (row.status === 'closed') error(409, 'already_closed', 'Обращение уже закрыто');
          if (row.status === 'deleted') error(404, 'not_found', 'Обращение не найдено');
          const input = await body(request);
          const note = String(input.note || '').trim().slice(0, 1000);
          const timestamp = new Date().toISOString();
          await db.prepare("UPDATE support_threads SET status = 'closed', closed_by = ?, closed_at = ?, resolution_note = ?, updated_at = ? WHERE id = ?")
            .run(user.id, timestamp, note, timestamp, id);
          await supportEvent(db, id, user.id, 'closed', note);
          await notifyUser(db, row.author_id, user.id, 'support_closed', `Обращение ${row.number} закрыто`);
          return send(response, 200, { thread: await supportThreadView(db, await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id), user, true) });
        }
        if (request.method === 'POST' && action === 'reopen') {
          if (!isSupportAgent(user)) error(403, 'forbidden', 'Переоткрывать обращения может только admin+ или GOD');
          if (row.status === 'deleted') error(404, 'not_found', 'Обращение не найдено');
          const timestamp = new Date().toISOString();
          await db.prepare("UPDATE support_threads SET status = 'open', closed_by = NULL, closed_at = NULL, resolution_note = '', updated_at = ? WHERE id = ?")
            .run(timestamp, id);
          await supportEvent(db, id, user.id, 'reopened');
          await notifyUser(db, row.author_id, user.id, 'support_reopened', `Обращение ${row.number} переоткрыто`);
          return send(response, 200, { thread: await supportThreadView(db, await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id), user, true) });
        }
        if (request.method === 'POST' && action === 'delete') {
          if (!isSupportAgent(user)) error(403, 'forbidden', 'Удалять обращения может только admin+ или GOD');
          const input = await body(request);
          const reason = String(input.reason || '').trim();
          if (reason.length < 3) error(422, 'reason_required', 'Укажите причину удаления');
          const timestamp = new Date().toISOString();
          await db.prepare("UPDATE support_threads SET status = 'deleted', deleted_by = ?, deleted_at = ?, delete_reason = ?, updated_at = ? WHERE id = ?")
            .run(user.id, timestamp, reason.slice(0, 1000), timestamp, id);
          await supportEvent(db, id, user.id, 'deleted', reason);
          return send(response, 200, { ok: true });
        }
        if (request.method === 'POST' && action === 'restore') {
          if (user.privileges !== 'GOD') error(403, 'forbidden', 'Восстанавливать обращения может только GOD');
          const timestamp = new Date().toISOString();
          await db.prepare("UPDATE support_threads SET status = 'open', deleted_by = NULL, deleted_at = NULL, delete_reason = '', updated_at = ? WHERE id = ?")
            .run(timestamp, id);
          await supportEvent(db, id, user.id, 'restored');
          return send(response, 200, { thread: await supportThreadView(db, await db.prepare(`${SUPPORT_THREAD_SELECT} WHERE support_threads.id = ?`).get(id), user, true) });
        }
        if (request.method === 'POST' && action === 'assign') {
          if (!isSupportAgent(user)) error(403, 'forbidden', 'Назначать обращения может только admin+ или GOD');
          const input = await body(request);
          const targetId = Number(input.userId);
          if (!Number.isSafeInteger(targetId) || targetId < 1) error(422, 'invalid_user', 'Некорректный пользователь');
          const target = await db.prepare('SELECT id, privileges FROM users WHERE id = ?').get(targetId);
          if (!target || !isSupportAgent(target)) error(422, 'invalid_user', 'Назначить можно только admin+ или GOD');
          const timestamp = new Date().toISOString();
          await db.prepare('UPDATE support_threads SET assigned_to = ?, updated_at = ? WHERE id = ?').run(targetId, timestamp, id);
          await supportEvent(db, id, user.id, 'assigned', String(targetId));
          return send(response, 200, { ok: true });
        }
        error(405, 'method_not_allowed', 'Действие не поддерживается');
      }
      if (path === '/api/reviews/mine' && request.method === 'GET') {
        const session = await getSession(db, request);
        const identity = reviewIdentity(request, response, session ? await db.prepare('SELECT id FROM users WHERE id = ?').get(session.user_id) : null);
        const row = identity.userId
          ? await db.prepare('SELECT * FROM app_reviews WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(identity.userId)
          : await db.prepare('SELECT * FROM app_reviews WHERE visitor_key = ? ORDER BY updated_at DESC LIMIT 1').get(identity.key);
        return send(response, 200, { review: reviewView(row) }, identity.setCookie ? { 'Set-Cookie': identity.setCookie } : {});
      }
      if (path === '/api/reviews' && request.method === 'POST') {
        const session = await getSession(db, request);
        const current = session ? await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true) : null;
        if (!current) {
          const origin = request.headers.origin;
          if (origin) {
            let originHost = null;
            try { originHost = new URL(origin).host; } catch { originHost = null; }
            if (originHost !== request.headers.host) error(403, 'origin_rejected', 'Недопустимый источник запроса');
          }
        }
        const identity = reviewIdentity(request, response, current);
        reviewRateLimit(identity.key);
        const input = await body(request);
        const rating = Number(input.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) error(422, 'invalid_rating', 'Поставьте оценку от 1 до 5');
        const usability = input.usability === undefined || input.usability === null || input.usability === '' ? null : Number(input.usability);
        if (usability !== null && (!Number.isInteger(usability) || usability < 1 || usability > 5)) error(422, 'invalid_usability', 'Оценка удобства должна быть от 1 до 5');
        const features = Array.isArray(input.features) ? [...new Set(input.features.map((value) => String(value)).filter((value) => REVIEW_FEATURES.includes(value)))].slice(0, REVIEW_FEATURES.length) : [];
        const suggestions = String(input.suggestions || '').trim().slice(0, 2000);
        const context = REVIEW_CONTEXTS.includes(input.context) ? input.context : 'settings';
        const timestamp = new Date().toISOString();
        const existing = identity.userId
          ? await db.prepare('SELECT id FROM app_reviews WHERE user_id = ?').get(identity.userId)
          : await db.prepare('SELECT id FROM app_reviews WHERE visitor_key = ?').get(identity.key);
        let reviewId;
        if (existing) {
          reviewId = existing.id;
          await db.prepare('UPDATE app_reviews SET rating = ?, usability = ?, features = ?, suggestions = ?, context = ?, updated_at = ? WHERE id = ?')
            .run(rating, usability, JSON.stringify(features), suggestions, context, timestamp, reviewId);
        } else {
          reviewId = randomUUID();
          await db.prepare('INSERT INTO app_reviews(id,user_id,visitor_key,rating,usability,features,suggestions,context,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(reviewId, identity.userId, identity.key, rating, usability, JSON.stringify(features), suggestions, context, timestamp, timestamp);
        }
        const row = identity.userId
          ? await db.prepare('SELECT app_reviews.*, users.login, users.nickname FROM app_reviews LEFT JOIN users ON users.id = app_reviews.user_id WHERE app_reviews.id = ?').get(reviewId)
          : await db.prepare('SELECT * FROM app_reviews WHERE id = ?').get(reviewId);
        return send(response, existing ? 200 : 201, { review: reviewView(row) }, identity.setCookie ? { 'Set-Cookie': identity.setCookie } : {});
      }
      if (path === '/api/reviews' && request.method === 'GET') {
        await requireUser(db, request, ['admin+', 'GOD']);
        const page = pagination(url);
        const total = Number((await db.prepare('SELECT COUNT(*) AS count FROM app_reviews').get()).count);
        const rows = await db.prepare(`SELECT app_reviews.*, users.login, users.nickname FROM app_reviews
          LEFT JOIN users ON users.id = app_reviews.user_id
          ORDER BY app_reviews.updated_at DESC LIMIT ? OFFSET ?`).all(page.limit, page.offset);
        return send(response, 200, { reviews: rows.map(reviewView), pagination: paginationResult(page, total) });
      }
      if (path === '/api/users' && request.method === 'GET') {
        await requireUser(db, request, ['GOD']);
        const page = pagination(url);
        const total = (await db.prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL').get()).count;
        const users = (await db.prepare(`SELECT users.*,
          (SELECT COUNT(*) FROM proposals WHERE author_id = users.id AND status = 'pending') AS pending_count,
          ${REPUTATION_SQL} AS reputation
          FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?`).all(page.limit, page.offset)).map(publicUser);
        return send(response, 200, { users, pagination: paginationResult(page, total) });
      }
      if (path === '/api/proposals' && request.method === 'GET') {
        const viewer = await getSession(db, request);
        const page = pagination(url);
        const sort = url.searchParams.get('sort');
        const order = sort === 'recent' ? 'created_at DESC' : sort === 'reputation' ? 'author_reputation DESC, score DESC, created_at DESC' : 'score DESC, created_at DESC';
        const selection = `SELECT proposals.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login,
          (SELECT COALESCE(SUM(author_votes.value), 0) FROM votes AS author_votes
            JOIN proposals AS author_proposals ON author_proposals.id = author_votes.proposal_id
            WHERE author_proposals.author_id = proposals.author_id) AS author_reputation
          FROM proposals JOIN users ON users.id = proposals.author_id`;
        if (url.searchParams.get('author') === 'me') {
          const current = await requireUser(db, request);
          const total = (await db.prepare('SELECT COUNT(*) AS count FROM proposals WHERE author_id = ?').get(current.id)).count;
          const rows = await db.prepare(`${selection} WHERE author_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(current.id, page.limit, page.offset);
          return send(response, 200, { proposals: await presentRows(rows, current.id), pagination: paginationResult(page, total) });
        }
        const allowed = ['pending', 'approved', 'rejected', 'needs_evidence', 'changes_requested', 'withdrawn'];
        const status = allowed.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
        const key = url.searchParams.get('reactionKey');
        const total = key
          ? (await db.prepare('SELECT COUNT(*) AS count FROM proposals WHERE status = ? AND reaction_key = ?').get(status, key)).count
          : (await db.prepare('SELECT COUNT(*) AS count FROM proposals WHERE status = ?').get(status)).count;
        const rows = key
          ? await db.prepare(`${selection} WHERE status = ? AND reaction_key = ? ORDER BY ${order} LIMIT ? OFFSET ?`).all(status, key, page.limit, page.offset)
          : await db.prepare(`${selection} WHERE status = ? ORDER BY ${order} LIMIT ? OFFSET ?`).all(status, page.limit, page.offset);
        return send(response, 200, { proposals: await presentRows(rows, viewer?.user_id), pagination: paginationResult(page, total) });
      }
      if (path === '/api/proposals' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        const valid = validateProposal(input, user);
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        await transaction(db, async () => {
          await db.prepare(`INSERT INTO proposals(id,author_id,reaction_key,kind,base_rule_id,original_rule_json,proposed_rule_json,issue_types,source_type,source_details,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id, user.id, valid.reactionKey, input.kind === 'correction' ? 'correction' : 'new', valid.baseRuleId || null, valid.originalRule ? JSON.stringify(valid.originalRule) : null, JSON.stringify(valid.proposedRule), JSON.stringify(valid.issueTypes), valid.source.type, valid.source.details, valid.comment, timestamp, timestamp);
        });
        updated('proposal');
        return send(response, 201, { proposal: await getProposal(id, user.id), warnings: valid.warnings });
      }
      const match = path.match(/^\/api\/proposals\/([^/]+)(?:\/(vote|review|withdraw|history|versions|rollback))?$/);
      if (match) {
        const [, id, action] = match;
        if (request.method === 'GET' && action === 'history') {
          await getProposal(id, null, true);
          return send(response, 200, { events: await reviewHistory(db, id) });
        }
        if (request.method === 'GET' && action === 'versions') {
          const proposal = await getProposal(id, null, true);
          const current = await db.prepare('SELECT rule_json FROM production_rules WHERE reaction_key = ? AND active = 1').get(proposal.reaction_key);
          const rows = await db.prepare(`SELECT rule_versions.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS publisher_login FROM rule_versions
            JOIN users ON users.id = rule_versions.published_by WHERE reaction_key = ? ORDER BY package_version DESC`).all(proposal.reaction_key);
          return send(response, 200, {
            currentRule: current ? JSON.parse(current.rule_json) : null,
            versions: rows.map((row) => ({ ...row, rule: JSON.parse(row.rule_json), current: current?.rule_json === row.rule_json }))
          });
        }
        if (request.method === 'POST' && action === 'rollback') {
          const reviewer = await requireUser(db, request, ['admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, reviewer.id, true);
          if (reviewer.privileges !== 'GOD' && proposal.author_id === reviewer.id) error(403, 'self_review', 'Откат собственной заявки должен подтвердить другой модератор');
          const input = await body(request);
          if (typeof input.versionId !== 'string' || !input.versionId || input.versionId.length > 160) error(422, 'invalid_version', 'Выберите корректную версию');
          const rule = await rollbackRule(db, proposal, reviewer, input.versionId);
          updated('review');
          return send(response, 200, { proposal: await getProposal(id, reviewer.id), rule });
        }
        if (request.method === 'GET' && !action) return send(response, 200, { proposal: await getProposal(id, (await getSession(db, request))?.user_id) });
        if (request.method === 'PATCH' && !action) {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, user.id);
          if (proposal.status !== 'pending') error(409, 'already_reviewed', 'Можно редактировать только ожидающую заявку');
          if (proposal.author_id !== user.id && user.privileges === 'basic') error(403, 'forbidden', 'Можно редактировать только свою заявку');
          const input = await body(request);
          const valid = validateProposal(input, user);
          await transaction(db, async () => {
            await db.prepare('UPDATE proposals SET reaction_key = ?, proposed_rule_json = ?, issue_types = ?, source_type = ?, source_details = ?, comment = ?, version = version + 1, updated_at = ? WHERE id = ?')
              .run(valid.reactionKey, JSON.stringify(valid.proposedRule), JSON.stringify(valid.issueTypes), valid.source.type, valid.source.details, valid.comment, new Date().toISOString(), id);
            if (user.privileges !== 'basic') {
              await recordReview(db, { ...proposal, version: proposal.version + 1 }, user, 'edited', 'Изменение перед решением модератора');
              await notifyProposalAuthor(db, proposal, user, 'edited', 'Модератор отредактировал заявку перед решением');
            }
          });
          updated('proposal');
          return send(response, 200, { proposal: await getProposal(id, user.id), warnings: valid.warnings });
        }
        if (request.method === 'POST' && action === 'vote') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, user.id);
          if (proposal.author_id === user.id) error(403, 'own_vote', 'Нельзя голосовать за свою заявку');
          if (proposal.status !== 'pending') error(409, 'already_reviewed', 'Голосование закрыто');
          const recent = await db.prepare('SELECT COUNT(*) AS count FROM votes WHERE user_id = ? AND updated_at >= ?').get(user.id, new Date(Date.now() - 3600000).toISOString());
          if (Number(recent.count) >= MAX_VOTES_PER_HOUR) error(429, 'vote_rate_limit', 'Слишком много голосов за час. Проверка качества важнее количества.');
          const input = await body(request);
          const value = input.value === -1 ? -1 : input.value === 1 ? 1 : error(422, 'invalid_vote', 'Голос должен быть +1 или −1');
          const comment = String(input.comment || '').trim().slice(0, 1000);
          const timestamp = new Date().toISOString();
          const weight = voteWeight(await reputationForUser(db, user.id));
          await transaction(db, async () => {
            await db.prepare(`INSERT INTO votes(proposal_id,user_id,value,weight,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(proposal_id,user_id) DO UPDATE SET value = excluded.value, comment = excluded.comment, updated_at = excluded.updated_at`)
              .run(id, user.id, value, weight, comment, timestamp, timestamp);
            await db.prepare('UPDATE proposals SET score = (SELECT COALESCE(SUM(value * weight), 0) FROM votes WHERE proposal_id = ?) WHERE id = ?').run(id, id);
          });
          updated('vote');
          return send(response, 200, { proposal: await getProposal(id, user.id) });
        }
        if (request.method === 'POST' && action === 'withdraw') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, user.id);
          if (proposal.author_id !== user.id || proposal.status !== 'pending') error(409, 'already_reviewed', 'Нельзя снять эту заявку');
          await db.prepare("UPDATE proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
          updated('proposal');
          return send(response, 200, { proposal: await getProposal(id, user.id) });
        }
        if (request.method === 'POST' && action === 'review') {
          const reviewer = await requireUser(db, request, ['admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, reviewer.id, true);
          if (reviewer.privileges !== 'GOD' && proposal.author_id === reviewer.id) error(403, 'self_review', 'Admin и admin+ не могут подтверждать собственные заявки. Нужен другой модератор.');
          if (proposal.status !== 'pending') error(409, 'already_reviewed', 'Заявка уже обработана');
          const input = await body(request);
          if (input.action === 'approve') {
            const rule = await publishProposal(db, proposal, reviewer);
            updated('review');
            return send(response, 200, { proposal: await getProposal(id, reviewer.id), rule });
          }
          if (!['rejected', 'needs_evidence', 'changes_requested'].includes(input.action)) error(422, 'invalid_review', 'Недопустимое решение');
          const note = String(input.note || '').trim().slice(0, 2000);
          await transaction(db, async () => {
            await db.prepare('UPDATE proposals SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?')
              .run(input.action, reviewer.id, new Date().toISOString(), note, new Date().toISOString(), id);
            await recordReview(db, proposal, reviewer, input.action, note);
            await notifyProposalAuthor(db, proposal, reviewer, input.action, note || `Новый статус заявки: ${input.action}`);
          });
          updated('review');
          return send(response, 200, { proposal: await getProposal(id, reviewer.id) });
        }
      }
      if (path === '/api/tags' && request.method === 'GET') {
        const rows = await db.prepare('SELECT tags FROM questions').all();
        const counts = new Map();
        for (const row of rows) {
          let tags = [];
          try { tags = JSON.parse(row.tags); } catch { tags = []; }
          for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        const tags = [...counts.entries()].map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')).slice(0, 200);
        return send(response, 200, { tags });
      }
      if (path === '/api/questions' && request.method === 'GET') {
        const viewer = await getSession(db, request);
        const page = pagination(url);
        const sort = url.searchParams.get('sort');
        const order = sort === 'recent' || sort === 'unanswered' ? 'questions.created_at DESC' : 'questions.score DESC, questions.created_at DESC';
        const tags = url.searchParams.getAll('tag').map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 10);
        const conditions = [];
        const filterParams = [];
        for (const tag of tags) {
          conditions.push('questions.tags LIKE ?');
          filterParams.push(`%\"${tag}\"%`);
        }
        if (sort === 'unanswered') conditions.push('(SELECT COUNT(*) FROM answers WHERE answers.question_id = questions.id) = 0');
        const where = conditions.length ? conditions.join(' AND ') : '1 = 1';
        if (url.searchParams.get('author') === 'me') {
          const current = await requireUser(db, request);
          const mineWhere = `questions.author_id = ?${conditions.length ? ` AND ${where}` : ''}`;
          const total = (await db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE ${mineWhere}`).get(current.id, ...filterParams)).count;
          const rows = await db.prepare(`${QUESTION_SELECT} WHERE ${mineWhere} ORDER BY ${order} LIMIT ? OFFSET ?`).all(current.id, ...filterParams, page.limit, page.offset);
          return send(response, 200, { questions: await Promise.all(rows.map((row) => questionView(db, row, current.id))), pagination: paginationResult(page, total) });
        }
        const total = (await db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE ${where}`).get(...filterParams)).count;
        const rows = await db.prepare(`${QUESTION_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...filterParams, page.limit, page.offset);
        return send(response, 200, { questions: await Promise.all(rows.map((row) => questionView(db, row, viewer?.user_id))), pagination: paginationResult(page, total) });
      }
      if (path === '/api/questions' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        const valid = validateQuestionBody(input);
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        await transaction(db, async () => {
          await db.prepare('INSERT INTO questions(id,author_id,title,body,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(id, user.id, valid.title, valid.body, JSON.stringify(valid.tags), timestamp, timestamp);
          await attachUploads('question', id, user.id, input.attachments);
        });
        updated('question');
        return send(response, 201, { question: await getQuestion(id, user.id) });
      }
      const commentDeleteMatch = path.match(/^\/api\/comments\/([^/]+)$/);
      if (commentDeleteMatch && request.method === 'DELETE') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').get(commentDeleteMatch[1]);
        if (!comment) error(404, 'not_found', 'Комментарий не найден');
        if (Number(comment.author_id) !== Number(user.id) && !isModerator(user)) {
          error(403, 'forbidden', 'Удалять комментарий может только автор или модератор');
        }
        await db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
        updated('comment');
        return send(response, 200, { ok: true });
      }
      const questionMatch = path.match(/^\/api\/questions\/([^/]+)(?:\/(vote|comment|close|reopen|flag))?$/);
      if (questionMatch) {
        const [, id, action] = questionMatch;
        const viewer = await getSession(db, request);
        if (request.method === 'GET' && !action) {
          const question = await getQuestion(id, viewer?.user_id);
          const viewCookie = url.searchParams.get('view') !== '0'
            ? await recordQuestionView(request, question, viewer?.user_id)
            : null;
          question.comments = await commentsFor(db, 'question', id, viewer?.user_id);
          question.edits = await postEditsFor(db, 'question', id);
          if (question.duplicate_of) {
            const duplicate = await db.prepare('SELECT id, title FROM questions WHERE id = ?').get(question.duplicate_of);
            question.duplicate_title = duplicate?.title || null;
          }
          const answers = await Promise.all((await db.prepare(`${ANSWER_SELECT} WHERE answers.question_id = ? ORDER BY answers.accepted DESC, answers.score DESC, answers.created_at ASC`).all(id))
            .map((row) => answerView(db, row, viewer?.user_id)));
          for (const answer of answers) {
            answer.comments = await commentsFor(db, 'answer', answer.id, viewer?.user_id);
            answer.edits = await postEditsFor(db, 'answer', answer.id);
          }
          return send(response, 200, { question, answers }, viewCookie ? { 'Set-Cookie': viewCookie } : {});
        }
        if (request.method === 'POST' && action === 'vote') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const question = await getQuestion(id, user.id);
          await postVote(db, 'question', id, user, await body(request), question.author_id, 'Нельзя голосовать за свой вопрос');
          return send(response, 200, { question: await getQuestion(id, user.id) });
        }
        if (request.method === 'POST' && action === 'comment') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const question = await getQuestion(id, user.id);
          const text = validateCommentBody(await body(request));
          const commentId = randomUUID();
          const timestamp = new Date().toISOString();
          await db.prepare('INSERT INTO comments(id,target_type,target_id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(commentId, 'question', id, user.id, text, timestamp, timestamp);
          await notifyUser(db, question.author_id, user.id, 'question_comment', `${displayName(user)} прокомментировал ваш вопрос: «${question.title}»`);
          updated('comment');
          return send(response, 201, { comments: await commentsFor(db, 'question', id, user.id) });
        }
        if (request.method === 'POST' && action === 'flag') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const question = await getQuestion(id, user.id);
          const input = await body(request);
          const reason = String(input.reason || '').trim().slice(0, 1000);
          if (!reason) error(422, 'invalid_reason', 'Укажите причину жалобы');
          const existing = await db.prepare('SELECT id FROM question_flags WHERE question_id = ? AND user_id = ?').get(id, user.id);
          if (existing) error(409, 'already_flagged', 'Вы уже отправили жалобу на этот вопрос');
          await db.prepare('INSERT INTO question_flags(id,question_id,user_id,reason,created_at) VALUES(?,?,?,?,?)')
            .run(randomUUID(), id, user.id, reason, new Date().toISOString());
          await notifyModerators(db, user.id, 'question_flag', `${displayName(user)} пожаловался на вопрос «${question.title}»: ${reason}`);
          updated('review');
          return send(response, 201, { ok: true });
        }
        if (request.method === 'POST' && (action === 'close' || action === 'reopen')) {
          const user = await requireUser(db, request, MODERATOR_ROLES, true);
          const question = await getQuestion(id, user.id);
          const timestamp = new Date().toISOString();
          if (action === 'close') {
            const input = await body(request);
            const reason = String(input.reason || '').trim().slice(0, 1000);
            if (!reason) error(422, 'invalid_reason', 'Укажите причину закрытия');
            let duplicateOf = null;
            if (input.duplicateOf) {
              duplicateOf = String(input.duplicateOf).trim();
              if (duplicateOf === id) error(422, 'invalid_duplicate', 'Вопрос не может быть дубликатом самого себя');
              const target = await db.prepare('SELECT id FROM questions WHERE id = ?').get(duplicateOf);
              if (!target) error(404, 'not_found', 'Вопрос-дубликат не найден');
            }
            await db.prepare('UPDATE questions SET closed = 1, closed_reason = ?, duplicate_of = ?, updated_at = ? WHERE id = ?')
              .run(reason, duplicateOf, timestamp, id);
            await notifyUser(db, question.author_id, user.id, 'question_closed', `Модератор ${displayName(user)} закрыл ваш вопрос «${question.title}»: ${reason}`);
          } else {
            await db.prepare("UPDATE questions SET closed = 0, closed_reason = '', duplicate_of = NULL, updated_at = ? WHERE id = ?").run(timestamp, id);
            await notifyUser(db, question.author_id, user.id, 'question_reopened', `Модератор ${displayName(user)} открыл ваш вопрос «${question.title}»`);
          }
          updated('question');
          return send(response, 200, { question: await getQuestion(id, user.id) });
        }
        if (request.method === 'PATCH' && !action) {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const question = await getQuestion(id, user.id);
          if (question.author_id !== user.id && !isModerator(user)) error(403, 'forbidden', 'Редактировать вопрос может автор или модератор');
          const input = await body(request);
          const title = input.title !== undefined ? String(input.title).trim() : question.title;
          const bodyText = input.body !== undefined ? String(input.body).trim() : question.body;
          const tags = input.tags !== undefined ? parseTags(input.tags) : question.tags;
          if (!title || title.length > 200) error(422, 'invalid_title', 'Заголовок вопроса: 1–200 символов');
          if (!bodyText || bodyText.length > 8000) error(422, 'invalid_body', 'Текст вопроса: 1–8000 символов');
          const reason = String(input.reason || '').trim().slice(0, 1000);
          if (isModerator(user) && question.author_id !== user.id && !reason) error(422, 'invalid_reason', 'Модератор должен указать причину изменения');
          await transaction(db, async () => {
            await db.prepare('UPDATE questions SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?')
              .run(title, bodyText, JSON.stringify(tags), new Date().toISOString(), id);
            await recordPostEdit(db, 'question', id, user, { title: question.title, body: question.body }, { title, body: bodyText }, reason);
          });
          if (question.author_id !== user.id) await notifyUser(db, question.author_id, user.id, 'question_edited', `Модератор ${displayName(user)} изменил ваш вопрос «${question.title}»: ${reason}`);
          updated('question');
          return send(response, 200, { question: await getQuestion(id, user.id) });
        }
        if (request.method === 'DELETE' && !action) {
          const user = await requireUser(db, request, MODERATOR_ROLES, true);
          const question = await getQuestion(id, user.id);
          const input = await body(request);
          const reason = String(input.reason || '').trim().slice(0, 1000);
          if (!reason) error(422, 'invalid_reason', 'Укажите причину удаления');
          await deleteQuestionRecord(db, id);
          await notifyUser(db, question.author_id, user.id, 'question_deleted', `Модератор ${displayName(user)} удалил ваш вопрос «${question.title}»: ${reason}`);
          updated('question');
          return send(response, 200, { ok: true });
        }
      }
      if (path === '/api/answers' && request.method === 'POST') {
        const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        const input = await body(request);
        const questionId = String(input.questionId || '').trim();
        if (!questionId) error(422, 'invalid_question', 'Укажите вопрос');
        const question = await getQuestion(questionId, user.id);
        if (question.closed) error(409, 'question_closed', 'Вопрос закрыт, новые ответы недоступны');
        const text = validatePostBody(input, 'body', 8000);
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        await transaction(db, async () => {
          await db.prepare('INSERT INTO answers(id,question_id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)')
            .run(id, questionId, user.id, text, timestamp, timestamp);
          await attachUploads('answer', id, user.id, input.attachments);
        });
        await notifyUser(db, question.author_id, user.id, 'question_answer', `${displayName(user)} ответил на ваш вопрос: «${question.title}»`);
        updated('answer');
        return send(response, 201, { answer: await getAnswer(id, user.id) });
      }
      const answerMatch = path.match(/^\/api\/answers\/([^/]+)(?:\/(vote|accept|comment))?$/);
      if (answerMatch) {
        const [, id, action] = answerMatch;
        if (request.method === 'PATCH' && !action) {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const answer = await getAnswer(id, user.id);
          if (answer.author_id !== user.id && !isModerator(user)) error(403, 'forbidden', 'Редактировать ответ может автор или модератор');
          const input = await body(request);
          const text = input.body !== undefined ? String(input.body).trim() : answer.body;
          if (!text || text.length > 8000) error(422, 'invalid_body', 'Текст ответа: 1–8000 символов');
          const reason = String(input.reason || '').trim().slice(0, 1000);
          if (isModerator(user) && answer.author_id !== user.id && !reason) error(422, 'invalid_reason', 'Модератор должен указать причину изменения');
          await transaction(db, async () => {
            await db.prepare('UPDATE answers SET body = ?, updated_at = ? WHERE id = ?').run(text, new Date().toISOString(), id);
            await recordPostEdit(db, 'answer', id, user, { body: answer.body }, { body: text }, reason);
          });
          if (answer.author_id !== user.id) await notifyUser(db, answer.author_id, user.id, 'answer_edited', `Модератор ${displayName(user)} изменил ваш ответ: ${reason}`);
          updated('answer');
          return send(response, 200, { answer: await getAnswer(id, user.id) });
        }
        if (request.method === 'DELETE' && !action) {
          const user = await requireUser(db, request, MODERATOR_ROLES, true);
          const answer = await getAnswer(id, user.id);
          const input = await body(request);
          const reason = String(input.reason || '').trim().slice(0, 1000);
          if (!reason) error(422, 'invalid_reason', 'Укажите причину удаления');
          await deleteAnswerRecord(db, id);
          await notifyUser(db, answer.author_id, user.id, 'answer_deleted', `Модератор ${displayName(user)} удалил ваш ответ: ${reason}`);
          updated('answer');
          return send(response, 200, { ok: true });
        }
        if (request.method === 'POST' && action) {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const answer = await getAnswer(id, user.id);
          if (action === 'vote') {
            await postVote(db, 'answer', id, user, await body(request), answer.author_id, 'Нельзя голосовать за свой ответ');
            return send(response, 200, { answer: await getAnswer(id, user.id) });
          }
          if (action === 'comment') {
            const text = validateCommentBody(await body(request));
            const commentId = randomUUID();
            const timestamp = new Date().toISOString();
            await db.prepare('INSERT INTO comments(id,target_type,target_id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
              .run(commentId, 'answer', id, user.id, text, timestamp, timestamp);
            await notifyUser(db, answer.author_id, user.id, 'answer_comment', `${displayName(user)} прокомментировал ваш ответ`);
            updated('comment');
            return send(response, 201, { comments: await commentsFor(db, 'answer', id, user.id) });
          }
          if (action === 'accept') {
            const question = await getQuestion(answer.question_id, user.id);
            if (question.author_id !== user.id) error(403, 'forbidden', 'Отметить ответ может только автор вопроса');
            const accept = answer.accepted ? 0 : 1;
            const timestamp = new Date().toISOString();
            await transaction(db, async () => {
              if (accept) {
                await db.prepare('UPDATE answers SET accepted = 0, updated_at = ? WHERE question_id = ?').run(timestamp, answer.question_id);
                await db.prepare('UPDATE answers SET accepted = 1, updated_at = ? WHERE id = ?').run(timestamp, id);
              } else {
                await db.prepare('UPDATE answers SET accepted = 0, updated_at = ? WHERE id = ?').run(timestamp, id);
              }
            });
            if (accept) await notifyUser(db, answer.author_id, user.id, 'answer_accepted', `${displayName(user)} отметил ваш ответ как полезный`);
            updated('answer');
            return send(response, 200, { answer: await getAnswer(id, user.id) });
          }
        }
      }
      const publicProfileMatch = path.match(/^\/api\/users\/([^/]+)\/public$/);
      if (publicProfileMatch && request.method === 'GET') {
        let login;
        try { login = decodeURIComponent(publicProfileMatch[1]); } catch { error(422, 'invalid_login', 'Некорректный логин'); }
        const record = await db.prepare('SELECT id, login, nickname, privileges, avatar, privacy, created_at FROM users WHERE login_canonical = ?').get(normalizeLogin(login));
        if (!record) error(404, 'not_found', 'Пользователь не найден');
        if (record.privacy === 'private') {
          const viewerSession = await getSession(db, request);
          const viewer = viewerSession ? await db.prepare('SELECT id, privileges FROM users WHERE id = ?').get(viewerSession.user_id) : null;
          if (viewer?.id !== record.id && viewer?.privileges !== 'GOD') error(403, 'private_profile', 'Профиль пользователя скрыт настройками приватности');
        }
        const rows = await db.prepare(`SELECT proposals.*, COALESCE(NULLIF(users.nickname, ''), users.login) AS author_login, 0 AS author_reputation
          FROM proposals JOIN users ON users.id = proposals.author_id WHERE author_id = ? ORDER BY created_at DESC LIMIT 100`).all(record.id);
        const proposals = (await presentRows(rows, null)).map((proposal) => ({
          id: proposal.id,
          kind: proposal.kind,
          status: proposal.status,
          score: proposal.score,
          created_at: proposal.created_at,
          updated_at: proposal.updated_at,
          version: proposal.version,
          review_note: proposal.review_note,
          proposed_rule_json: proposal.proposed_rule_json,
          review_history: proposal.review_history
        }));
        return send(response, 200, { user: { login: record.login, nickname: record.nickname || record.login, privileges: record.privileges, avatar: record.avatar, privacy: record.privacy, created_at: record.created_at, reputation: await reputationForUser(db, record.id) }, proposals });
      }
      const roleMatch = path.match(/^\/api\/users\/(\d+)\/role$/);
      if (roleMatch && request.method === 'PATCH') {
        await requireUser(db, request, ['GOD'], true);
        const id = Number(roleMatch[1]);
        const input = await body(request);
        if (!['basic', 'admin', 'admin+'].includes(input.privileges)) error(422, 'invalid_role', 'Можно назначить только basic, admin или admin+');
        if (await db.prepare("SELECT id FROM users WHERE id = ? AND privileges = 'GOD'").get(id)) error(409, 'god_immutable', 'Роль единственного GOD нельзя изменить');
        const result = await db.prepare('UPDATE users SET privileges = ? WHERE id = ?').run(input.privileges, id);
        if (!result.changes) error(404, 'not_found', 'Пользователь не найден');
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        user.reputation = await reputationForUser(db, id);
        updated('user');
        return send(response, 200, { user: publicUser(user) });
      }
      if (path.startsWith('/api/')) return send(response, 404, { error: { code: 'not_found', message: 'Маршрут не найден' } });
      if (staticHandler) return staticHandler(request, response);
      return send(response, 404, { error: { code: 'not_found', message: 'Маршрут не найден' } });
    } catch (cause) {
      const status = cause.status || (['SQLITE_CONSTRAINT_UNIQUE', '23505'].includes(cause.code) ? 409 : cause instanceof SyntaxError ? 422 : 500);
      send(response, status, { error: { code: cause.code || 'invalid_request', message: cause.message, details: cause.details } });
      if (status >= 500) console.error(cause);
    }
  });
  return {
    server,
    db,
    bootstrap,
    async close() {
      for (const client of clients) client.end();
      await db.close();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
