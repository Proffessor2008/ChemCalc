import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

async function register(port, login) {
  const result = await request(port, '/api/auth/register', { method: 'POST', body: { login, password: 'password123', confirmPassword: 'password123' } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { user: result.data.user, csrfToken: result.data.csrfToken, cookie: result.cookie };
}

async function login(port, loginName, password) {
  const result = await request(port, '/api/auth/login', { method: 'POST', body: { login: loginName, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { user: result.data.user, csrfToken: result.data.csrfToken, cookie: result.cookie };
}

test('профиль: никнейм, аватар и приватность аккаунта', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const alice = await register(port, 'alice_profile');
  const bob = await register(port, 'bob_profile');
  const creator = await login(port, credentials.login, credentials.password);

  // Никнейм меняется, логин для входа остаётся прежним.
  const renamed = await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { nickname: 'alice_nick' }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.user.nickname, 'alice_nick');
  assert.equal(renamed.data.user.login, 'alice_profile');
  const me = await request(port, '/api/auth/me', { cookie: alice.cookie });
  assert.equal(me.data.user.nickname, 'alice_nick');
  assert.equal(me.data.user.login, 'alice_profile');
  const oldLogin = await request(port, '/api/auth/login', { method: 'POST', body: { login: 'alice_profile', password: 'password123' } });
  assert.equal(oldLogin.status, 200);
  const nicknameLogin = await request(port, '/api/auth/login', { method: 'POST', body: { login: 'alice_nick', password: 'password123' } });
  assert.equal(nicknameLogin.status, 401);
  const loginImmutable = await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { login: 'alice_new' }
  });
  assert.equal(loginImmutable.status, 422);

  // Аватар.
  const avatar = await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { avatar: PNG }
  });
  assert.equal(avatar.status, 200);
  assert.equal(avatar.data.user.avatar, PNG);
  const invalidAvatar = await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { avatar: 'data:text/html;base64,AAAA' }
  });
  assert.equal(invalidAvatar.status, 422);

  // Приватность.
  const privateProfile = await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { privacy: 'private' }
  });
  assert.equal(privateProfile.status, 200);
  assert.equal(privateProfile.data.user.privacy, 'private');

  const anonymous = await request(port, '/api/users/alice_profile/public');
  assert.equal(anonymous.status, 403);
  const otherUser = await request(port, '/api/users/alice_profile/public', { cookie: bob.cookie });
  assert.equal(otherUser.status, 403);
  const owner = await request(port, '/api/users/alice_profile/public', { cookie: alice.cookie });
  assert.equal(owner.status, 200);
  assert.equal(owner.data.user.avatar, PNG);
  assert.equal(owner.data.user.nickname, 'alice_nick');
  const god = await request(port, '/api/users/alice_profile/public', { cookie: creator.cookie });
  assert.equal(god.status, 200);

  // Возврат публичности.
  await request(port, '/api/auth/profile', {
    method: 'PATCH', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { privacy: 'public' }
  });
  const publicProfile = await request(port, '/api/users/alice_profile/public', { cookie: bob.cookie });
  assert.equal(publicProfile.status, 200);

  // Удаление аккаунта владельцем: профиль и сессии удаляются, логин перестаёт работать.
  const wrongConfirm = await request(port, '/api/auth/account', {
    method: 'DELETE', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { password: 'password123', confirm: 'нет' }
  });
  assert.equal(wrongConfirm.status, 422);
  const wrongPassword = await request(port, '/api/auth/account', {
    method: 'DELETE', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { password: 'wrong-password', confirm: 'УДАЛИТЬ' }
  });
  assert.equal(wrongPassword.status, 401);
  const deleted = await request(port, '/api/auth/account', {
    method: 'DELETE', cookie: bob.cookie, csrfToken: bob.csrfToken, body: { password: 'password123', confirm: 'УДАЛИТЬ' }
  });
  assert.equal(deleted.status, 200);
  const deletedMe = await request(port, '/api/auth/me', { cookie: bob.cookie });
  assert.equal(deletedMe.status, 401);
  const deletedLogin = await request(port, '/api/auth/login', { method: 'POST', body: { login: 'bob_profile', password: 'password123' } });
  assert.equal(deletedLogin.status, 401);
  const deletedProfile = await request(port, '/api/users/bob_profile/public');
  assert.equal(deletedProfile.status, 404);
});
