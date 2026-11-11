import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../js/drafts.js';
import { buildPrintModel } from '../js/print-solution.js';
import { parseEquation } from '../js/parser.js';

function storageMock() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('черновики разделены по пользователям, обновляются и ограничены двадцатью', () => {
  const storage = storageMock();
  const alice = createDraftStore(storage, 2);
  const bob = createDraftStore(storage, 3);
  const id = alice.save({ equation: 'HCl + NaOH = NaCl + H2O' }, 'first');
  alice.save({ equation: '2H2 + O2 = 2H2O' }, id);
  bob.save({ equation: 'CaCO3 = CaO + CO2' });
  assert.equal(alice.list().length, 1);
  assert.equal(alice.get(id).data.equation, '2H2 + O2 = 2H2O');
  assert.equal(bob.list().length, 1);
  for (let index = 0; index < 25; index++) alice.save({ equation: String(index) }, `draft-${index}`);
  assert.equal(alice.list().length, 20);
  alice.remove(id);
  assert.equal(alice.get(id), null);
});

test('повреждённые черновики не мешают работе', () => {
  const storage = storageMock();
  storage.setItem('chemcalc-community-drafts-v1:2', '{bad json');
  assert.deepEqual(createDraftStore(storage, 2).list(), []);
});

test('печатная карточка содержит условия, источник, баланс и ионные формы', () => {
  const model = buildPrintModel({
    equation: parseEquation('HCl + NaOH = NaCl + H2O'),
    conditions: { medium: 'neutral', solvent: 'aqueous' },
    type: 'нейтрализация',
    source: 'Учебник',
    explanation: ['Образуется вода']
  });
  assert.equal(model.equation, 'HCl + NaOH → NaCl + H₂O');
  assert.equal(model.source, 'Учебник');
  assert.ok(model.steps.some((step) => step.includes('1, 1, 1, 1')));
  assert.equal(model.ionic.net, 'H⁺ + OH⁻ → H₂O');
});
