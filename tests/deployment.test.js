import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Render использует Node backend, проверки и секретные переменные', () => {
  const render = readFileSync('render.yaml', 'utf8');
  for (const value of ['runtime: node', 'buildCommand: npm ci && npm test', 'startCommand: npm start', 'healthCheckPath: /api/health', 'value: production', 'value: 0.0.0.0', 'value: postgres']) assert.ok(render.includes(value), value);
  assert.match(render, /key: DATABASE_URL\s+sync: false/);
  assert.match(render, /key: COMMUNITY_GOD_PASSWORD\s+sync: false/);
  assert.doesNotMatch(render, /sb_(?:secret|publishable)_/);
  assert.ok(!render.includes('DATABASE_URL=postgres'));
});

test('зависимости и локальные секреты не попадают в репозиторий', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const ignore = readFileSync('.gitignore', 'utf8');
  assert.equal(manifest.dependencies.pg, '8.23.1');
  assert.ok(existsSync('package-lock.json'));
  for (const value of ['var/', '.env', '.env.*', 'node_modules/']) assert.ok(ignore.includes(value), value);
  const server = readFileSync('server.mjs', 'utf8');
  assert.ok(server.includes("process.env.DATABASE_URL"));
  assert.ok(!server.includes('NEXT_PUBLIC_SUPABASE'));
});
