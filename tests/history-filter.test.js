import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHistoryStore, filterHistoryEntries } from '../js/history.js';

test('история фильтруется по режиму и избранному без изменения записей', () => {
  const store = createHistoryStore(null);
  const auto = store.add({ equation: 'HCl + NaOH = NaCl + H2O', mode: 'auto' });
  store.add({ equation: '2H2 + O2 = 2H2O', mode: 'check' });
  store.toggleFavorite(auto.id);
  const items = store.list();
  assert.equal(filterHistoryEntries(items, 'auto').length, 1);
  assert.equal(filterHistoryEntries(items, 'check').length, 1);
  assert.equal(filterHistoryEntries(items, 'favorites').length, 1);
  assert.equal(filterHistoryEntries(items, 'favorites')[0].id, auto.id);
  assert.equal(filterHistoryEntries(items, 'all').length, 2);
  assert.equal(store.list().length, 2);
});

test('фильтр истории доступен в интерфейсе', () => {
  const html = readFileSync('index.html', 'utf8');
  const ui = readFileSync('js/history-ui.js', 'utf8');
  assert.ok(html.includes('id="history-filter"'));
  assert.ok(html.includes('value="favorites"'));
  assert.ok(ui.includes("addEventListener('change', render)"));
});
