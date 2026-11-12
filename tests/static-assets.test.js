import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { createCommunityServer } from '../server/app.mjs';
import { createStaticHandler } from '../server/static.mjs';

test('статика сжимается, получает ETag и поддерживает 304', async (context) => {
  const app = await createCommunityServer({
    dbPath: ':memory:',
    god: { login: 'creator', password: 'StrongPass123!' },
    staticHandler: createStaticHandler(process.cwd())
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  context.after(() => app.close());
  const url = (path) => `http://127.0.0.1:${port}${path}`;

  const brotli = await fetch(url('/styles.css'), { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(brotli.status, 200);
  assert.equal(brotli.headers.get('content-encoding'), 'br');
  assert.match(brotli.headers.get('vary'), /Accept-Encoding/);
  assert.ok(Number(brotli.headers.get('content-length')) < statSync('styles.css').size);
  const etag = brotli.headers.get('etag');
  assert.ok(etag);

  const cached = await fetch(url('/styles.css'), { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');

  const gzip = await fetch(url('/data/elements.json'), { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers.get('content-encoding'), 'gzip');
  assert.ok(Number(gzip.headers.get('content-length')) < statSync('data/elements.json').size / 5);

  const fallback = await fetch(url('/public-profile'));
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('content-type'), /text\/html/);
  assert.match(await fallback.text(), /id="panel-calculator"/);

  const missing = await fetch(url('/missing.js'));
  assert.equal(missing.status, 404);

  const head = await fetch(url('/index.html'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) < statSync('index.html').size);
  assert.equal(await head.text(), '');
});
