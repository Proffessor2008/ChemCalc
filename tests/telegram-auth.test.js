import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCommunityServer } from '../server/app.mjs';
import { verifyTelegramInitData } from '../server/telegram.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };
const TOKEN = '123456:TEST_BOT_TOKEN_FOR_UNIT_TESTS';

function signInitData(user, { token = TOKEN, authDate = Math.floor(Date.now() / 1000), queryId = 'query-1' } = {}) {
  const parameters = new URLSearchParams({
    auth_date: String(authDate),
    query_id: queryId,
    user: JSON.stringify(user)
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  parameters.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return parameters.toString();
}

async function request(port, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie') };
}

test('Telegram initData: подпись, срок и подделка', () => {
  const telegramUser = { id: 123456789, first_name: 'Иван', last_name: 'Петров', username: 'ivan_petrov' };
  const valid = signInitData(telegramUser);
  const verified = verifyTelegramInitData(valid, TOKEN);
  assert.equal(verified.user.id, 123456789);
  assert.equal(verified.user.username, 'ivan_petrov');
  assert.equal(verified.queryId, 'query-1');

  assert.equal(verifyTelegramInitData(valid, `${TOKEN}_wrong`), null);
  assert.equal(verifyTelegramInitData(valid, TOKEN, { maxAge: -1 }), null);

  const expired = signInitData(telegramUser, { authDate: Math.floor(Date.now() / 1000) - 90000 });
  assert.equal(verifyTelegramInitData(expired, TOKEN), null);

  const forged = new URLSearchParams(valid);
  forged.set('user', JSON.stringify({ ...telegramUser, id: 987654321 }));
  assert.equal(verifyTelegramInitData(forged.toString(), TOKEN), null);
});

test('Telegram API: вход, привязка и сохранение аккаунта', async (context) => {
  const app = await createCommunityServer({
    dbPath: ':memory:',
    god: credentials,
    telegramBotToken: TOKEN,
    publicUrl: 'https://chemcalc.example'
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const telegramUser = { id: 123456789, first_name: 'Иван', last_name: 'Петров', username: 'ivan_petrov', photo_url: 'https://t.me/i/userpic/320/example.jpg' };
  const initData = signInitData(telegramUser, { queryId: 'login-query' });
  const login = await request(port, '/api/auth/telegram', { method: 'POST', body: { initData } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.login, 'tg_123456789');
  assert.equal(login.data.user.nickname, 'Иван Петров');
  assert.equal(login.data.user.telegram_linked, true);
  assert.equal(login.data.user.telegram_username, 'ivan_petrov');
  assert.ok(login.data.csrfToken);
  assert.ok(login.cookie);

  const me = await request(port, '/api/auth/me', { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.login, 'tg_123456789');
  assert.equal(me.data.user.telegram_linked, true);

  // Повторная загрузка страницы в том же запуске Mini App не должна разлогинивать.
  const reload = await request(port, '/api/auth/telegram', { method: 'POST', body: { initData } });
  assert.equal(reload.status, 200);
  assert.equal(reload.data.user.login, 'tg_123456789');

  // Испорченная подпись.
  const broken = await request(port, '/api/auth/telegram', { method: 'POST', body: { initData: initData.replace(/hash=[0-9a-f]+/, 'hash=0'.repeat(32)) } });
  assert.equal(broken.status, 401);

  // Привязка Telegram к обычному аккаунту.
  const web = await request(port, '/api/auth/register', { method: 'POST', body: { login: 'web_user', password: 'password123', confirmPassword: 'password123' } });
  assert.equal(web.status, 201);
  const linkInit = signInitData({ id: 777777777, first_name: 'Мария', username: 'maria' }, { queryId: 'link-query' });
  const link = await request(port, '/api/auth/telegram/link', {
    method: 'POST', cookie: web.cookie, csrfToken: web.data.csrfToken, body: { initData: linkInit }
  });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal(link.data.user.login, 'web_user');
  assert.equal(link.data.user.telegram_linked, true);
  assert.equal(link.data.user.telegram_username, 'maria');

  // Повторный вход через Telegram попадает в привязанный аккаунт.
  const linkedLogin = await request(port, '/api/auth/telegram', {
    method: 'POST', body: { initData: signInitData({ id: 777777777, first_name: 'Мария', username: 'maria' }, { queryId: 'linked-login' }) }
  });
  assert.equal(linkedLogin.status, 200);
  assert.equal(linkedLogin.data.user.login, 'web_user');

  // Другой пользователь не может занять тот же Telegram.
  const other = await request(port, '/api/auth/register', { method: 'POST', body: { login: 'other_user', password: 'password123', confirmPassword: 'password123' } });
  const conflict = await request(port, '/api/auth/telegram/link', {
    method: 'POST', cookie: other.cookie, csrfToken: other.data.csrfToken,
    body: { initData: signInitData({ id: 777777777, first_name: 'Мария' }, { queryId: 'conflict-query' }) }
  });
  assert.equal(conflict.status, 409);

  // Без CSRF привязка запрещена.
  const noCsrf = await request(port, '/api/auth/telegram/link', {
    method: 'POST', cookie: web.cookie,
    body: { initData: signInitData({ id: 888888888, first_name: 'Без', username: 'no_csrf' }, { queryId: 'no-csrf' }) }
  });
  assert.equal(noCsrf.status, 403);
});
