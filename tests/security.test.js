import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';
import { createStaticHandler } from '../server/static.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };

async function api(port, path, { method = 'GET', body, cookie, csrfToken, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, headers: response.headers, data, cookie: response.headers.get('set-cookie') };
}

async function page(port, path, { method = 'GET', headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { accept: 'text/html', ...headers } });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function register(port, login, extra = {}) {
  const result = await api(port, '/api/auth/register', {
    method: 'POST',
    body: { login, password: 'password123', confirmPassword: 'password123', ...extra }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { ...result.data, cookie: result.cookie };
}

test('безопасность: SQL-инъекции, роли, приватность, CSRF и скрытые маршруты', async (context) => {
  const app = await createCommunityServer({
    dbPath: ':memory:',
    god: credentials,
    staticHandler: createStaticHandler(process.cwd())
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const alice = await register(port, 'alice_sec', { privileges: 'GOD', id: 1 });
  const bob = await register(port, 'bob_sec');
  assert.equal(alice.user.privileges, 'basic');
  assert.notEqual(alice.user.id, 1);

  const godLogin = await api(port, '/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(godLogin.status, 200, JSON.stringify(godLogin.data));
  const god = { ...godLogin.data, cookie: godLogin.cookie };

  // SQL-инъекция в логине не проходит и не вызывает 500.
  const injectionLogin = await api(port, '/api/auth/login', {
    method: 'POST',
    body: { login: "creator' OR '1'='1", password: 'x' }
  });
  assert.equal(injectionLogin.status, 401);

  // Параметры поиска/статуса не подставляются в SQL как код.
  for (const path of [
    '/api/questions?tag=%22%20OR%201%3D1--',
    '/api/proposals?status=pending%27%20OR%201%3D1--',
    '/api/questions?sort=score%3B%20DROP%20TABLE%20users--'
  ]) {
    const response = await api(port, path);
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
  }

  // Регистрация не принимает privileges, профиль не меняет роль.
  const profile = await api(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { nickname: 'Alice Sec', privileges: 'GOD', id: 1, privacy: 'private' }
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.user.privileges, 'basic');
  assert.equal(profile.data.user.id, alice.user.id);

  // Без CSRF изменение отклоняется; чужой Origin отклоняется.
  const noCsrf = await api(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, body: { nickname: 'No CSRF' }
  });
  assert.equal(noCsrf.status, 403);
  const foreignOrigin = await api(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken,
    headers: { origin: 'https://evil.example' }, body: { nickname: 'Foreign' }
  });
  assert.equal(foreignOrigin.status, 403);
  const malformedOrigin = await api(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken,
    headers: { origin: 'not a valid url' }, body: { nickname: 'Malformed' }
  });
  assert.equal(malformedOrigin.status, 403);
  const malformedCookie = await api(port, '/api/auth/me', { cookie: 'chemcalc_session=%E0%A4%A' });
  assert.equal(malformedCookie.status, 401);

  // Служебные API закрыты для обычных пользователей.
  assert.equal((await api(port, '/api/users')).status, 401);
  assert.equal((await api(port, '/api/users', { cookie: alice.cookie })).status, 403);
  assert.equal((await api(port, '/api/users', { cookie: god.cookie })).status, 200);
  const roleAttempt = await api(port, `/api/users/${bob.user.id}/role`, {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { privileges: 'admin' }
  });
  assert.equal(roleAttempt.status, 403);

  // GOD может назначить admin/basic, но не может изменить GOD.
  const promote = await api(port, `/api/users/${bob.user.id}/role`, {
    method: 'PATCH', cookie: god.cookie, csrfToken: god.csrfToken, body: { privileges: 'admin' }
  });
  assert.equal(promote.status, 200, JSON.stringify(promote.data));
  assert.equal(promote.data.user.privileges, 'admin');
  const demoteGod = await api(port, `/api/users/${god.user.id}/role`, {
    method: 'PATCH', cookie: god.cookie, csrfToken: god.csrfToken, body: { privileges: 'basic' }
  });
  assert.equal(demoteGod.status, 409);
  const makeGod = await api(port, `/api/users/${bob.user.id}/role`, {
    method: 'PATCH', cookie: god.cookie, csrfToken: god.csrfToken, body: { privileges: 'GOD' }
  });
  assert.equal(makeGod.status, 422);

  // Приватный профиль не отдаётся другому пользователю и анониму.
  const privateBob = await api(port, '/api/auth/profile', {
    method: 'PATCH', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { privacy: 'private' }
  });
  assert.equal(privateBob.status, 200);
  assert.equal((await api(port, '/api/users/bob_sec/public')).status, 403);
  assert.equal((await api(port, '/api/users/bob_sec/public', { cookie: alice.cookie })).status, 403);
  assert.equal((await api(port, '/api/users/bob_sec/public', { cookie: bob.cookie })).status, 200);

  // Скрытые и несуществующие страницы отдают 404, а не исходники/SPA.
  for (const hidden of ['/admin', '/server/app.mjs', '/server.mjs', '/package.json', '/GOD.txt', '/README.md', '/tests/security.test.js', '/data/%2e%2e/server/app.mjs', '/does-not-exist']) {
    const response = await page(port, hidden);
    assert.equal(response.status, 404, `${hidden}: ${response.status}`);
    assert.ok(!response.text.includes('createServer'), `${hidden} отдал исходник`);
    assert.ok(!response.text.includes('GOD login'), `${hidden} отдал секрет`);
  }
  const notFound = await page(port, '/does-not-exist');
  assert.match(notFound.text, /404/);
  assert.match(notFound.text, /испарилась/i);
  assert.equal((await page(port, '/404.html')).status, 200);
  assert.equal((await page(port, '/')).status, 200);
  assert.equal((await page(port, '/js/ui.js')).status, 200);
  const apiMissing = await api(port, '/api/does-not-exist');
  assert.equal(apiMissing.status, 404);
  assert.equal(apiMissing.data.error.code, 'not_found');

  // Базовые защитные заголовки.
  const home = await page(port, '/');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.match(home.headers.get('permissions-policy') || '', /microphone=\(\)/);
  assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors/);
});
