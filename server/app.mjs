import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openCommunityDatabase, publicUser, jsonRecord, transaction } from './db.mjs';
import { openPostgresDatabase } from './postgres.mjs';
import { createSession, destroySession, getSession, hashPassword, normalizeLogin, requireUser, validateCredentials, verifyPassword } from './auth.mjs';
import { validateProposal } from './validation.mjs';
import { communityPackage, publishProposal } from './production.mjs';

const JSON_LIMIT = 250_000;
const attempts = new Map();

function error(status, code, message, details) {
  throw Object.assign(new Error(message), { status, code, details });
}

function send(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  response.end(body);
}

async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > JSON_LIMIT) error(413, 'too_large', 'Слишком большой запрос');
  }
  try { return text ? JSON.parse(text) : {}; } catch { error(400, 'invalid_json', 'Некорректный JSON'); }
}

function rateLimit(request) {
  const key = request.socket.remoteAddress || 'local';
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 900000);
  if (recent.length >= 60) error(429, 'rate_limit', 'Слишком много попыток входа. Повторите позже.');
  recent.push(now);
  attempts.set(key, recent);
}

function authResponse(response, status, user, session) {
  return send(response, status, { user: publicUser(user), csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { 'Set-Cookie': session.cookie });
}

async function proposalView(db, row, viewerId) {
  const proposal = jsonRecord(row, ['issue_types', 'original_rule_json', 'proposed_rule_json']);
  proposal.score = Number(proposal.score);
  proposal.viewer_vote = viewerId ? (await db.prepare('SELECT value FROM votes WHERE proposal_id = ? AND user_id = ?').get(row.id, viewerId))?.value ?? 0 : null;
  return proposal;
}

export async function createCommunityServer({ dbPath, god, staticHandler, dbBackend = 'sqlite', connectionString, pgClient }) {
  const db = dbBackend === 'postgres' ? await openPostgresDatabase(connectionString, { client: pgClient }) : openCommunityDatabase(dbPath);
  const events = new EventEmitter();
  const clients = new Set();
  let bootstrap = null;
  if (Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count) === 0) {
    const canonical = validateCredentials({ ...god, requireConfirmation: false });
    await db.prepare('INSERT INTO users(login,login_canonical,password_hash,privileges,created_at) VALUES(?,?,?,?,?)')
      .run(god.login.trim(), canonical, hashPassword(god.password), 'GOD', new Date().toISOString());
    bootstrap = { login: god.login.trim(), password: god.password };
  }

  function updated(type) { events.emit('update', { type, at: new Date().toISOString() }); }

  async function getProposal(id, viewerId, raw = false) {
    const row = await db.prepare('SELECT proposals.*, users.login AS author_login FROM proposals JOIN users ON users.id = proposals.author_id WHERE proposals.id = ?').get(id);
    if (!row) error(404, 'not_found', 'Заявка не найдена');
    return raw ? row : proposalView(db, row, viewerId);
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/api/events' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        response.write('retry: 3000\n\n');
        clients.add(response);
        const timer = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        timer.unref();
        const update = (event) => response.write(`event: community-update\ndata: ${JSON.stringify(event)}\n\n`);
        events.on('update', update);
        request.on('close', () => { clearInterval(timer); events.off('update', update); clients.delete(response); });
        return;
      }
      if (path === '/api/health' && request.method === 'GET') return send(response, 200, { ok: true, database: db.kind || 'sqlite', schemaVersion: 2 });
      if (path === '/api/rules' && request.method === 'GET') return send(response, 200, await communityPackage(db));
      if (path === '/api/auth/register' && request.method === 'POST') {
        rateLimit(request);
        const input = await body(request);
        const canonical = validateCredentials(input);
        if (await db.prepare('SELECT id FROM users WHERE login_canonical = ?').get(canonical)) error(409, 'login_taken', 'Этот логин уже занят');
        const timestamp = new Date().toISOString();
        const userId = (await db.prepare('INSERT INTO users(login,login_canonical,password_hash,privileges,created_at,last_login_at) VALUES(?,?,?,?,?,?)')
          .run(String(input.login).trim(), canonical, hashPassword(input.password), 'basic', timestamp, timestamp)).lastInsertRowid;
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        updated('user');
        return authResponse(response, 201, user, await createSession(db, userId));
      }
      if (path === '/api/auth/login' && request.method === 'POST') {
        rateLimit(request);
        const input = await body(request);
        const canonical = normalizeLogin(input.login);
        const user = await db.prepare('SELECT * FROM users WHERE login_canonical = ?').get(canonical);
        if (!user || !verifyPassword(input.password || '', user.password_hash)) error(401, 'invalid_credentials', 'Неверный логин или пароль');
        user.last_login_at = new Date().toISOString();
        await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(user.last_login_at, user.id);
        return authResponse(response, 200, user, await createSession(db, user.id));
      }
      if (path === '/api/auth/logout' && request.method === 'POST') {
        await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
        updated('user');
        return send(response, 200, { ok: true }, { 'Set-Cookie': await destroySession(db, request) });
      }
      if (path === '/api/auth/me' && request.method === 'GET') {
        const user = await requireUser(db, request);
        const session = await getSession(db, request);
        return send(response, 200, { user: publicUser(user), csrfToken: session.csrf_token, expiresAt: session.expires_at });
      }
      if (path === '/api/users' && request.method === 'GET') {
        await requireUser(db, request, ['GOD']);
        const users = (await db.prepare("SELECT users.*, (SELECT COUNT(*) FROM proposals WHERE author_id = users.id AND status = 'pending') AS pending_count FROM users ORDER BY id").all()).map(publicUser);
        return send(response, 200, { users });
      }
      if (path === '/api/proposals' && request.method === 'GET') {
        const viewer = await getSession(db, request);
        if (url.searchParams.get('author') === 'me') {
          const current = await requireUser(db, request);
          const rows = await db.prepare('SELECT proposals.*, users.login AS author_login FROM proposals JOIN users ON users.id = proposals.author_id WHERE author_id = ? ORDER BY created_at DESC LIMIT 200').all(current.id);
          return send(response, 200, { proposals: await Promise.all(rows.map((row) => proposalView(db, row, current.id))) });
        }
        const allowed = ['pending', 'approved', 'rejected', 'needs_evidence', 'changes_requested', 'withdrawn'];
        const status = allowed.includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
        const order = url.searchParams.get('sort') === 'recent' ? 'created_at DESC' : 'score DESC, created_at DESC';
        const key = url.searchParams.get('reactionKey');
        const rows = key
          ? await db.prepare(`SELECT proposals.*, users.login AS author_login FROM proposals JOIN users ON users.id = proposals.author_id WHERE status = ? AND reaction_key = ? ORDER BY ${order} LIMIT 200`).all(status, key)
          : await db.prepare(`SELECT proposals.*, users.login AS author_login FROM proposals JOIN users ON users.id = proposals.author_id WHERE status = ? ORDER BY ${order} LIMIT 200`).all(status);
        return send(response, 200, { proposals: await Promise.all(rows.map((row) => proposalView(db, row, viewer?.user_id))) });
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
      const match = path.match(/^\/api\/proposals\/([^/]+)(?:\/(vote|review|withdraw))?$/);
      if (match) {
        const [, id, action] = match;
        if (request.method === 'GET' && !action) return send(response, 200, { proposal: await getProposal(id, (await getSession(db, request))?.user_id) });
        if (request.method === 'PATCH' && !action) {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, user.id);
          if (proposal.status !== 'pending') error(409, 'already_reviewed', 'Можно редактировать только ожидающую заявку');
          if (proposal.author_id !== user.id && user.privileges === 'basic') error(403, 'forbidden', 'Можно редактировать только свою заявку');
          const input = await body(request);
          const valid = validateProposal(input, user);
          await db.prepare('UPDATE proposals SET reaction_key = ?, proposed_rule_json = ?, issue_types = ?, source_type = ?, source_details = ?, comment = ?, version = version + 1, updated_at = ? WHERE id = ?')
            .run(valid.reactionKey, JSON.stringify(valid.proposedRule), JSON.stringify(valid.issueTypes), valid.source.type, valid.source.details, valid.comment, new Date().toISOString(), id);
          updated('proposal');
          return send(response, 200, { proposal: await getProposal(id, user.id), warnings: valid.warnings });
        }
        if (request.method === 'POST' && action === 'vote') {
          const user = await requireUser(db, request, ['basic', 'admin', 'admin+', 'GOD'], true);
          const proposal = await getProposal(id, user.id);
          if (proposal.author_id === user.id) error(403, 'own_vote', 'Нельзя голосовать за свою заявку');
          if (proposal.status !== 'pending') error(409, 'already_reviewed', 'Голосование закрыто');
          const input = await body(request);
          const value = input.value === -1 ? -1 : input.value === 1 ? 1 : error(422, 'invalid_vote', 'Голос должен быть +1 или −1');
          const comment = String(input.comment || '').trim().slice(0, 1000);
          const timestamp = new Date().toISOString();
          await transaction(db, async () => {
            await db.prepare(`INSERT INTO votes(proposal_id,user_id,value,comment,created_at,updated_at) VALUES(?,?,?,?,?,?)
              ON CONFLICT(proposal_id,user_id) DO UPDATE SET value = excluded.value, comment = excluded.comment, updated_at = excluded.updated_at`)
              .run(id, user.id, value, comment, timestamp, timestamp);
            await db.prepare('UPDATE proposals SET score = (SELECT COALESCE(SUM(value), 0) FROM votes WHERE proposal_id = ?) WHERE id = ?').run(id, id);
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
          await db.prepare('UPDATE proposals SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?')
            .run(input.action, reviewer.id, new Date().toISOString(), note, new Date().toISOString(), id);
          updated('review');
          return send(response, 200, { proposal: await getProposal(id, reviewer.id) });
        }
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
        updated('user');
        return send(response, 200, { user: publicUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
      }
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
