import { readFileSync, statSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { extname, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md', '.webmanifest']);
const MIN_COMPRESS_SIZE = 1024;
const MAX_FILE_CACHE = 64;
const fileCache = new Map();

function acceptsEncoding(header, encoding) {
  return String(header || '').split(',').some((part) => {
    const [name, ...parameters] = part.trim().split(';').map((value) => value.trim());
    if (name !== encoding && name !== '*') return false;
    const quality = parameters.find((parameter) => parameter.startsWith('q='));
    return !quality || Number(quality.slice(2)) > 0;
  });
}

function readCached(file, stat) {
  const key = file;
  let entry = fileCache.get(key);
  if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
    entry = { mtimeMs: stat.mtimeMs, size: stat.size, raw: readFileSync(file), encoded: new Map() };
    if (fileCache.size >= MAX_FILE_CACHE) fileCache.delete(fileCache.keys().next().value);
    fileCache.set(key, entry);
  } else {
    fileCache.delete(key);
    fileCache.set(key, entry);
  }
  return entry;
}

function encodeCached(entry, extension, encoding) {
  if (!COMPRESSIBLE.has(extension) || entry.raw.length < MIN_COMPRESS_SIZE || entry.encoded.has(encoding)) return entry.encoded.get(encoding);
  const options = encoding === 'br'
    ? { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }
    : { level: 6 };
  const encoded = encoding === 'br' ? brotliCompressSync(entry.raw, options) : gzipSync(entry.raw, options);
  entry.encoded.set(encoding, encoded);
  return encoded;
}

function etag(stat) {
  return `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
}

function etagMatches(header, value) {
  return String(header || '').split(',').some((part) => part.trim() === value || part.trim() === '*');
}

function sendFile(response, request, file, stat, entry, extension, encoded, encoding) {
  const headers = {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Content-Length': (encoded || entry.raw).length,
    'Cache-Control': 'no-cache',
    ETag: etag(stat)
  };
  if (COMPRESSIBLE.has(extension)) headers.Vary = 'Accept-Encoding';
  if (encoding) headers['Content-Encoding'] = encoding;
  if (etagMatches(request.headers['if-none-match'], etag(stat))) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, headers);
  response.end(request.method === 'HEAD' ? undefined : (encoded || entry.raw));
}

export function createStaticHandler(root = process.cwd()) {
  const rootPath = resolve(root);
  return function staticHandler(request, response) {
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
    let file = resolve(rootPath, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${rootPath}${sep}`) || file.startsWith(`${rootPath}${sep}var${sep}`) || file.startsWith(`${rootPath}${sep}.git${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    let stat;
    try {
      stat = statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      if (extname(pathname)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      file = resolve(rootPath, 'index.html');
      stat = statSync(file);
    }
    const entry = readCached(file, stat);
    const extension = extname(file);
    const encoding = entry.raw.length >= MIN_COMPRESS_SIZE && acceptsEncoding(request.headers['accept-encoding'], 'br') ? 'br'
      : entry.raw.length >= MIN_COMPRESS_SIZE && acceptsEncoding(request.headers['accept-encoding'], 'gzip') ? 'gzip' : '';
    sendFile(response, request, file, stat, entry, extension, encodeCached(entry, extension, encoding), encoding);
  };
}
