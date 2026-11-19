import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityServer } from '../server/app.mjs';
import { normalizeOcrEquation, recognizeEquation } from '../server/ocr.mjs';

const credentials = { login: 'creator', password: 'StrongPass123!' };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]).toString('base64');

async function api(port, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, setCookie: response.headers.getSetCookie?.()[0] || '' };
}

test('нормализация и fallback OCR', async () => {
  assert.equal(normalizeOcrEquation('C₃H₈ + 5O₂ → 3CO₂ + 4H₂O'), 'C3H8 + 5O2 = 3CO2 + 4H2O');
  assert.equal(normalizeOcrEquation('С3Н8 + 5О2 → 3СО2 + 4Н2О'), 'C3H8 + 5O2 = 3CO2 + 4H2O');
  assert.equal(normalizeOcrEquation('\\ce{2H2 + O2 -> 2H2O}'), '2H2 + O2 = 2H2O');
  const result = await recognizeEquation({
    buffer: Buffer.from('x'),
    apiKey: 'test',
    spaceRecognizer: async () => { throw new Error('space down'); },
    tesseractRecognizer: async () => ({ text: '2H2 + O2 → 2H2O', provider: 'tesseract', confidence: 0.8 })
  });
  assert.equal(result.provider, 'tesseract');
  assert.equal(result.text, '2H2 + O2 = 2H2O');
});

test('GOD имеет безлимитное распознавание', async (context) => {
  const app = await createCommunityServer({
    dbPath: ':memory:',
    god: credentials,
    ocrFreeScans: 5,
    ocrRecognizer: async () => ({ text: '2H2 + O2 = 2H2O', provider: 'ocr.space', confidence: null })
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const god = await api(port, '/api/auth/login', { method: 'POST', body: credentials });
  assert.equal(god.status, 200);
  const cookie = god.setCookie;
  const csrfToken = god.data.csrfToken;
  const quota = await api(port, '/api/ocr/quota', { cookie });
  assert.equal(quota.data.unlimited, true);
  assert.equal(quota.data.remaining, null);

  for (let index = 0; index < 7; index += 1) {
    const result = await api(port, '/api/ocr', { method: 'POST', cookie, csrfToken, body: { image: jpeg, mime: 'image/jpeg' } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.unlimited, true);
    assert.equal(result.data.remaining, null);
  }
});

test('OCR только для авторизованных и 5 бесплатных сканов', async (context) => {
  const app = await createCommunityServer({
    dbPath: ':memory:',
    god: credentials,
    ocrFreeScans: 5,
    ocrRecognizer: async () => ({ text: 'C3H8 + 5O2 = 3CO2 + 4H2O', provider: 'ocr.space', confidence: null })
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());

  const anonymous = await api(port, '/api/ocr/quota');
  assert.equal(anonymous.status, 401);
  const anonymousPost = await api(port, '/api/ocr', { method: 'POST', body: { image: jpeg, mime: 'image/jpeg' } });
  assert.equal(anonymousPost.status, 401);

  const registration = await api(port, '/api/auth/register', { method: 'POST', body: { login: 'ocr_user', password: 'password123', confirmPassword: 'password123' } });
  assert.equal(registration.status, 201);
  const cookie = registration.setCookie;
  const csrfToken = registration.data.csrfToken;
  const quota = await api(port, '/api/ocr/quota', { cookie });
  assert.deepEqual({ limit: quota.data.limit, used: quota.data.used, remaining: quota.data.remaining, period: quota.data.period }, { limit: 5, used: 0, remaining: 5, period: 'day' });

  for (let index = 0; index < 5; index += 1) {
    const result = await api(port, '/api/ocr', { method: 'POST', cookie, csrfToken, body: { image: jpeg, mime: 'image/jpeg', context: 'calculator' } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.text, 'C3H8 + 5O2 = 3CO2 + 4H2O');
    assert.equal(result.data.period, 'day');
    assert.equal(result.data.remaining, 4 - index);
  }
  const exhausted = await api(port, '/api/ocr', { method: 'POST', cookie, csrfToken, body: { image: jpeg, mime: 'image/jpeg' } });
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.data.error.code, 'ocr_quota_exceeded');

  const noCsrf = await api(port, '/api/ocr', { method: 'POST', cookie, body: { image: jpeg, mime: 'image/jpeg' } });
  assert.equal(noCsrf.status, 403);
});
