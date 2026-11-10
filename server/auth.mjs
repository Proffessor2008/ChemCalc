import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const cookieName = 'chemcalc_session';

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
  return Object.fromEntries(String(request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function createSession(db, userId, secure = process.env.NODE_ENV === 'production') {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
    .run(digest(token), userId, csrf, now.toISOString(), expires.toISOString(), now.toISOString());
  return {
    cookie: `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`,
    csrfToken: csrf,
    expiresAt: expires.toISOString()
  };
}

export function getSession(db, request) {
  const token = cookies(request)[cookieName];
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(digest(token));
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return null;
  }
  if (Date.now() - Date.parse(session.last_seen_at) > 60000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(new Date().toISOString(), session.token_hash);
  return { ...session, token };
}

export function destroySession(db, request) {
  const session = getSession(db, request);
  if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function requireUser(db, request, roles = ['basic', 'admin', 'admin+', 'GOD'], csrf = false) {
  const session = getSession(db, request);
  if (!session) throw Object.assign(new Error('Требуется вход в аккаунт'), { status: 401, code: 'authentication_required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user || !roles.includes(user.privileges)) throw Object.assign(new Error('Недостаточно привилегий'), { status: 403, code: 'forbidden' });
  if (csrf) {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) throw Object.assign(new Error('Недопустимый источник запроса'), { status: 403, code: 'origin_rejected' });
    const token = request.headers['x-csrf-token'];
    if (!token || token !== session.csrf_token) throw Object.assign(new Error('Недопустимый CSRF-токен'), { status: 403, code: 'csrf_rejected' });
  }
  return user;
}
