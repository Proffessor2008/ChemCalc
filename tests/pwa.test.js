import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('manifest и его локальные иконки существуют', () => {
  const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(existsSync(icon.src));
});

test('service worker кеширует все шесть источников справочников и основные модули', () => {
  const worker = readFileSync('sw.js', 'utf8');
  for (const name of ['solubility', 'activity-series', 'electronegativity', 'acid-base-constants', 'electrode-potentials', 'thermo']) assert.ok(worker.includes(`./data/${name}.json`));
  for (const name of ['predictor', 'reaction-conditions', 'redox-predictor', 'redox-view', 'internal-redox', 'electrolytes', 'dissociation', 'clipboard', 'export', 'reference-ui', 'thermo', 'periodic-table', 'ui']) assert.ok(worker.includes(`./js/${name}.js`));
  assert.ok(worker.includes('./data/redox-sites.json'));
  assert.ok(worker.includes('./data/functional-groups.json'));
  assert.ok(worker.includes('chemcalc-v33'));
  assert.ok(worker.includes('./js/community-ui.js'));
  assert.ok(worker.includes('./data/reaction-rules-community.json'));
  assert.ok(worker.includes("url.pathname.startsWith('/api/')"));
  assert.ok(worker.includes("request.mode === 'navigate'"));
  const browserSuite = readFileSync('tests.html', 'utf8');
  assert.ok(browserSuite.includes("caches.open('chemcalc-v33')"));
  assert.ok(browserSuite.includes('./js/community-ui.js'));
  assert.ok(browserSuite.includes('./data/reaction-rules-community.json'));
});

test('README содержит источники, лицензии, запуск и деплой', () => {
  const readme = readFileSync('README.md', 'utf8');
  for (const text of ['CIAAW', 'Periodic-Table-JSON', 'CRC', 'NIST', 'MIT', 'npm test', 'GitHub Pages', 'Netlify']) assert.ok(readme.includes(text));
});
