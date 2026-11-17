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
  return { status: response.status, data, setCookie: response.headers.getSetCookie?.()[0] || '' };
}

async function register(port, login) {
  const result = await api(port, '/api/auth/register', { method: 'POST', body: { login, password: 'password123', confirmPassword: 'password123' } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { ...result.data, cookie: result.setCookie };
}

test('отзывы: аноним, обновление, вопросы и просмотр для admin+', async (context) => {
  const app = await createCommunityServer({ dbPath: ':memory:', god: credentials });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const empty = await api(port, '/api/reviews/mine');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.review, null);
  assert.ok(empty.setCookie.includes('chemcalc_reviewer='));
  const anonymousCookie = empty.setCookie.split(';')[0];

  const first = await api(port, '/api/reviews', {
    method: 'POST', cookie: anonymousCookie,
    body: { rating: 5, usability: 4, features: ['calculations', 'reports'], suggestions: 'Добавьте больше примеров.', context: 'calculator' }
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.review.rating, 5);
  assert.equal(first.data.review.author, null);
  assert.deepEqual(first.data.review.features, ['calculations', 'reports']);

  const mine = await api(port, '/api/reviews/mine', { cookie: anonymousCookie });
  assert.equal(mine.data.review.suggestions, 'Добавьте больше примеров.');
  const update = await api(port, '/api/reviews', {
    method: 'POST', cookie: anonymousCookie,
    body: { rating: 4, usability: 5, features: ['calculations'], suggestions: 'Обновлено.', context: 'settings' }
  });
  assert.equal(update.status, 200);
  assert.equal(update.data.review.rating, 4);
  assert.equal(update.data.review.suggestions, 'Обновлено.');

  const invalid = await api(port, '/api/reviews', { method: 'POST', cookie: anonymousCookie, body: { rating: 0 } });
  assert.equal(invalid.status, 422);

  const summary = await api(port, '/api/reviews/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.count, 1);
  assert.equal(summary.data.distribution.find((item) => item.rating === 4).count, 1);
  assert.equal(summary.data.suggestions, undefined);
  assert.equal(summary.data.reviews, undefined);

  const alice = await register(port, 'review_alice');
  const noCsrf = await api(port, '/api/reviews', {
    method: 'POST', cookie: alice.cookie, body: { rating: 5, suggestions: 'Без CSRF' }
  });
  assert.equal(noCsrf.status, 403);
  const byUser = await api(port, '/api/reviews', {
    method: 'POST', cookie: alice.cookie, csrfToken: alice.csrfToken,
    body: { rating: 5, usability: 5, features: ['community', 'telegram'], suggestions: 'Отличная поддержка.', context: 'stoichiometry' }
  });
  assert.equal(byUser.status, 201, JSON.stringify(byUser.data));
  assert.equal(byUser.data.review.author.nickname, 'review_alice');

  const anonList = await api(port, '/api/reviews');
  assert.equal(anonList.status, 401);

  const god = await api(port, '/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(god.status, 200);
  const godCookie = god.setCookie.split(';')[0];
  const promoted = await api(port, `/api/users/${alice.user.id}/role`, {
    method: 'PATCH', cookie: godCookie, csrfToken: god.data.csrfToken, body: { privileges: 'admin+' }
  });
  assert.equal(promoted.status, 200);
  const list = await api(port, '/api/reviews', { cookie: alice.cookie });
  assert.equal(list.status, 200);
  assert.ok(list.data.reviews.some((review) => review.author?.nickname === 'review_alice'));
  assert.ok(list.data.reviews.some((review) => review.author === null));
});
