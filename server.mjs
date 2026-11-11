import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { createCommunityServer } from './server/app.mjs';

const root = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function staticHandler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const url = new URL(request.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${root}${sep}`) || file.startsWith(`${root}${sep}var${sep}`) || file.startsWith(`${root}${sep}.git${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
    const content = readFileSync(file);
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    if (!extname(pathname) && pathname !== '/index.html') {
      const content = readFileSync(resolve(root, 'index.html'));
      response.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const production = process.env.NODE_ENV === 'production';
const god = {
  login: process.env.COMMUNITY_GOD_LOGIN || 'creator',
  password: process.env.COMMUNITY_GOD_PASSWORD || (production ? null : randomBytes(18).toString('base64url'))
};
if (!god.password) throw new Error('Задайте COMMUNITY_GOD_PASSWORD перед публичным запуском');

const app = await createCommunityServer({
  dbPath: process.env.COMMUNITY_DB || 'var/community.db',
  god,
  staticHandler,
  dbBackend: process.env.COMMUNITY_DB_BACKEND || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
  connectionString: process.env.DATABASE_URL
});
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT || 8080);
app.server.listen(port, host, () => {
  console.log(`ChemCalc: http://${host}:${port}`);
  if (app.bootstrap) console.log(production ? `GOD login: ${app.bootstrap.login}; пароль берётся из секретной переменной окружения` : `GOD login: ${app.bootstrap.login}; password: ${app.bootstrap.password}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
