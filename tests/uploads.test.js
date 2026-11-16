import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };

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
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get('set-cookie') };
}

async function register(port, login) {
  const result = await request(port, '/api/auth/register', {
    method: 'POST',
    body: { login, password: 'password123', confirmPassword: 'password123' }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { cookie: result.cookie, csrfToken: result.data.csrfToken, user: result.data.user };
}

test('вложения вопросов и ответов: загрузка, привязка, выдача и запреты', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const user = await register(port, 'upload_user');
  const text = Buffer.from('ChemCalc attachment', 'utf8').toString('base64');
  const upload = await request(port, '/api/uploads', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { filename: 'note.txt', type: 'text/plain', data: text }
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  assert.equal(upload.data.upload.filename, 'note.txt');

  const question = await request(port, '/api/questions', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { title: 'Вопрос с файлом', body: 'Проверка вложения', tags: ['тест'], attachments: [upload.data.upload.id] }
  });
  assert.equal(question.status, 201, JSON.stringify(question.data));
  assert.equal(question.data.question.attachments.length, 1);
  assert.equal(question.data.question.attachments[0].filename, 'note.txt');

  const answer = await request(port, '/api/answers', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { questionId: question.data.question.id, body: 'Ответ с файлом', attachments: [upload.data.upload.id] }
  });
  assert.equal(answer.status, 422);

  const secondUpload = await request(port, '/api/uploads', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { filename: 'answer.txt', type: 'text/plain', data: text }
  });
  const answerWithFile = await request(port, '/api/answers', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { questionId: question.data.question.id, body: 'Ответ с файлом', attachments: [secondUpload.data.upload.id] }
  });
  assert.equal(answerWithFile.status, 201, JSON.stringify(answerWithFile.data));
  assert.equal(answerWithFile.data.answer.attachments.length, 1);

  const file = await fetch(`http://127.0.0.1:${port}/api/uploads/${upload.data.upload.id}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'text/plain');
  assert.equal(await file.text(), 'ChemCalc attachment');

  const anonymousUpload = await request(port, '/api/uploads', {
    method: 'POST', body: { filename: 'x.txt', type: 'text/plain', data: text }
  });
  assert.equal(anonymousUpload.status, 401);

  const disallowed = await request(port, '/api/uploads', {
    method: 'POST', cookie: user.cookie, csrfToken: user.csrfToken,
    body: { filename: 'x.html', type: 'text/html', data: text }
  });
  assert.equal(disallowed.status, 422);
});
