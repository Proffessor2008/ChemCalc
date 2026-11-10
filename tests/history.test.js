import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore, HISTORY_LIMIT } from '../js/history.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

test('история хранит не более 20 записей и сначала новые', () => {
  const store = createHistoryStore(memoryStorage());
  for (let index = 1; index <= 23; index += 1) store.add({ equation: `${index}H2 + O2 = H2O`, mode: 'check' });
  assert.equal(store.list().length, HISTORY_LIMIT);
  assert.match(store.list()[0].equation, /^23H2/);
  assert.equal(store.list().some((item) => item.equation.startsWith('1H2')), false);
});

test('повтор обновляет запись без дубликата и сохраняет избранное', () => {
  const store = createHistoryStore(memoryStorage());
  const entry = store.add({ equation: 'H2 + O2 = H2O', mode: 'check' });
  store.toggleFavorite(entry.id);
  store.add({ equation: 'H2 + O2 = H2O', mode: 'check' });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].favorite, true);
});

test('избранное, удаление и очистка сохраняются', () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage);
  const first = store.add({ equation: 'HCl + NaOH = NaCl + H2O', mode: 'auto', conditions: { medium: 'neutral' } });
  store.add({ equation: 'Fe + O2 = Fe2O3', mode: 'check' });
  assert.equal(store.toggleFavorite(first.id).favorite, true);
  const restored = createHistoryStore(storage);
  assert.equal(restored.list().length, 2);
  assert.equal(restored.list().find((item) => item.id === first.id).favorite, true);
  assert.equal(restored.remove(first.id), true);
  assert.equal(restored.list().length, 1);
  restored.clear();
  assert.equal(restored.list().length, 0);
});

test('повреждённое хранилище не приводит к падению', () => {
  const storage = memoryStorage();
  storage.setItem('chemcalc-history-v2', '{broken');
  const store = createHistoryStore(storage);
  assert.deepEqual(store.list(), []);
});
