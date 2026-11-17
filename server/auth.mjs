import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const cookieName = 'chemcalc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function sessionCookie(token, secure = process.env.NODE_ENV === 'production') {
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function normalizeLogin(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

export function validateCredentials({ login, password, confirmPassword, requireConfirmation = true }) {
  const canonical = normalizeLogin(login);
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(canonical)) throw Object.assign(new Error('Логин должен содержать 3–32 буквы, цифры, точки, подчёркивания или дефисы'), { status: 422, code: 'invalid_login' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Object.assign(new Error('Пароль должен содержать от 8 до 128 символов'), { status: 422, code: 'invalid_password' });
  if (requireConfirmation && password !== confirmPassword) throw Object.assign(new Error('Пароли не совпадают'), { status: 422, code: 'password_mismatch' });
  return canonical;
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const reference = Buffer.from(expected, 'hex');
  return reference.length === actual.length && timingSafeEqual(actual, reference);
}

function cookies(request) {
  const result = {};
  for (const part of String(request.headers.cookie || '').split(';').filter(Boolean)) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { result[name] = decodeURIComponent(part.slice(index + 1)); } catch { /* игнорируем повреждённую cookie */ }
  }
  return result;
}

function constantTimeEqual(left, right) {
  const first = Buffer.from(String(left ?? ''), 'utf8');
  const second = Buffer.from(String(right ?? ''), 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

export async function createSession(db, userId, secure = process.env.NODE_ENV === 'production') {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
    .run(digest(token), userId, csrf, now.toISOString(), expires.toISOString(), now.toISOString());
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  return {
    cookie: sessionCookie(token, secure),
    csrfToken: csrf,
    expiresAt: expires.toISOString()
  };
}

export async function getSession(db, request) {
  const token = cookies(request)[cookieName];
  if (!token) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(digest(token));
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }
  if (Date.now() - Date.parse(session.last_seen_at) > 60000) await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), session.token_hash);
  if (Date.parse(session.expires_at) - Date.now() < 7 * 24 * 60 * 60 * 1000) {
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires, session.token_hash);
    session.expires_at = expires;
  }
  return { ...session, token };
}

export async function destroySession(db, request) {
  const session = await getSession(db, request);
  if (session) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function requireUser(db, request, roles = ['basic', 'admin', 'admin+', 'GOD'], csrf = false) {
  const session = await getSession(db, request);
  if (!session) throw Object.assign(new Error('Требуется вход в аккаунт'), { status: 401, code: 'authentication_required' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user || !roles.includes(user.privileges)) throw Object.assign(new Error('Недостаточно привилегий'), { status: 403, code: 'forbidden' });
  if (csrf) {
    const origin = request.headers.origin;
    if (origin) {
      let originHost = null;
      try { originHost = new URL(origin).host; } catch { originHost = null; }
      if (originHost !== request.headers.host) throw Object.assign(new Error('Недопустимый источник запроса'), { status: 403, code: 'origin_rejected' });
    }
    const token = request.headers['x-csrf-token'];
    if (!token || !constantTimeEqual(token, session.csrf_token)) throw Object.assign(new Error('Недопустимый CSRF-токен'), { status: 403, code: 'csrf_rejected' });
  }
  return user;
}
