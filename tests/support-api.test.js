import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };

async function api(port, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get('set-cookie') };
}

async function register(port, login) {
  const result = await api(port, '/api/auth/register', { method: 'POST', body: { login, password: 'password123', confirmPassword: 'password123' } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { ...result.data, cookie: result.cookie };
}

async function login(port, login, password) {
  const result = await api(port, '/api/auth/login', { method: 'POST', body: { login, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { ...result.data, cookie: result.cookie };
}

test('поддержка: обращения, фото, роли, внутренние заметки и закрытие', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const alice = await register(port, 'support_alice');
  const bob = await register(port, 'support_bob');
  const staff = await register(port, 'support_staff');
  const admin = await register(port, 'support_admin');
  const god = await login(port, credentials.login, credentials.password);

  for (const target of [staff, admin]) {
    const promoted = await api(port, `/api/users/${target.user.id}/role`, {
      method: 'PATCH', cookie: god.cookie, csrfToken: god.csrfToken,
      body: { privileges: target === staff ? 'admin+' : 'admin' }
    });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
  }

  const categories = await api(port, '/api/support/categories');
  assert.equal(categories.status, 200);
  assert.ok(categories.data.categories.some((category) => category.key === 'bug'));

  const photo = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('support-photo')]).toString('base64');
  const upload = await api(port, '/api/support/attachments', {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { filename: 'screen.png', type: 'image/png', data: photo }
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));

  const created = await api(port, '/api/support/threads', {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { category: 'bug', subject: 'Не работает PDF', body: 'При экспорте не открывается файл, проверьте пожалуйста.', attachments: [upload.data.attachment.id] }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const thread = created.data.thread;
  assert.equal(thread.author.nickname, 'support_alice');
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].attachments.length, 1);
  assert.equal(thread.status, 'new');

  const own = await api(port, '/api/support/threads', { cookie: alice.cookie });
  assert.equal(own.status, 200);
  assert.equal(own.data.threads.length, 1);
  const other = await api(port, `/api/support/threads/${thread.id}`, { cookie: bob.cookie });
  assert.equal(other.status, 404);
  const attachment = await api(port, `/api/support/attachments/${upload.data.attachment.id}`, { cookie: bob.cookie });
  assert.equal(attachment.status, 404);

  const staffInbox = await api(port, '/api/support/threads?scope=inbox', { cookie: staff.cookie });
  assert.equal(staffInbox.status, 200);
  assert.equal(staffInbox.data.threads.length, 1);
  const adminInbox = await api(port, '/api/support/threads?scope=inbox', { cookie: admin.cookie });
  assert.equal(adminInbox.status, 403);

  const staffReply = await api(port, `/api/support/threads/${thread.id}/messages`, {
    method: 'POST', cookie: staff.cookie, csrfToken: staff.csrfToken,
    body: { body: 'Проверяем экспорт, пришлите версию браузера.' }
  });
  assert.equal(staffReply.status, 201, JSON.stringify(staffReply.data));
  assert.equal(staffReply.data.thread.status, 'waiting_user');
  assert.equal(staffReply.data.thread.messages.at(-1).author.nickname, 'support_staff');
  assert.equal(staffReply.data.thread.messages.at(-1).author.privileges, 'admin+');

  const internal = await api(port, `/api/support/threads/${thread.id}/messages`, {
    method: 'POST', cookie: staff.cookie, csrfToken: staff.csrfToken,
    body: { body: 'Внутренняя заметка: проверить шаблон.', internal: true }
  });
  assert.equal(internal.status, 201);
  assert.equal(internal.data.thread.status, 'waiting_user');
  const aliceThread = await api(port, `/api/support/threads/${thread.id}`, { cookie: alice.cookie });
  assert.equal(aliceThread.status, 200);
  assert.ok(!aliceThread.data.thread.messages.some((message) => message.visibility === 'internal'));

  const userReply = await api(port, `/api/support/threads/${thread.id}/messages`, {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { body: 'Chrome 157, Windows.' }
  });
  assert.equal(userReply.status, 201);
  assert.equal(userReply.data.thread.status, 'open');

  const noCsrf = await api(port, `/api/support/threads/${thread.id}/messages`, { method: 'POST', cookie: alice.cookie, body: { body: 'no csrf' } });
  assert.equal(noCsrf.status, 403);

  const closeByBasic = await api(port, `/api/support/threads/${thread.id}/close`, {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { note: 'сам' }
  });
  assert.equal(closeByBasic.status, 403);
  const closeByAdmin = await api(port, `/api/support/threads/${thread.id}/close`, {
    method: 'POST', cookie: admin.cookie, csrfToken: admin.csrfToken, body: { note: 'нет прав' }
  });
  assert.equal(closeByAdmin.status, 404);
  const closed = await api(port, `/api/support/threads/${thread.id}/close`, {
    method: 'POST', cookie: staff.cookie, csrfToken: staff.csrfToken, body: { note: 'Проблема воспроизведена и исправлена.' }
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.equal(closed.data.thread.status, 'closed');
  const replyClosed = await api(port, `/api/support/threads/${thread.id}/messages`, {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken, body: { body: 'Ещё вопрос' }
  });
  assert.equal(replyClosed.status, 409);

  const helpful = await api(port, `/api/support/threads/${thread.id}/helpful`, {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken, body: {}
  });
  assert.equal(helpful.status, 200);

  const reopened = await api(port, `/api/support/threads/${thread.id}/reopen`, {
    method: 'POST', cookie: staff.cookie, csrfToken: staff.csrfToken, body: {}
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.thread.status, 'open');

  const deleted = await api(port, `/api/support/threads/${thread.id}/delete`, {
    method: 'POST', cookie: staff.cookie, csrfToken: staff.csrfToken, body: { reason: 'Спам для проверки' }
  });
  assert.equal(deleted.status, 200);
  const hidden = await api(port, `/api/support/threads/${thread.id}`, { cookie: alice.cookie });
  assert.equal(hidden.status, 404);
  const deletedForStaff = await api(port, '/api/support/threads?scope=inbox&status=deleted', { cookie: staff.cookie });
  assert.equal(deletedForStaff.status, 200);
  assert.equal(deletedForStaff.data.threads.length, 1);
  const restored = await api(port, `/api/support/threads/${thread.id}/restore`, {
    method: 'POST', cookie: god.cookie, csrfToken: god.csrfToken, body: {}
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.thread.status, 'open');
});
