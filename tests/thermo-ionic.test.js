import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateIonicReactionThermo, calculateReactionThermo } from '../js/thermo.js';

const equation = '2KMnO4 + 10FeSO4 + 8H2SO4 = K2SO4 + 2MnSO4 + 5Fe2(SO4)3 + 8H2O';

test('молекулярный расчёт и ионный расчёт не подменяют друг друга', () => {
  const molecular = calculateReactionThermo(equation, { solvent: 'aqueous' });
  assert.equal(molecular.status, 'missing-data');
  const ionic = calculateIonicReactionThermo(equation, { solvent: 'aqueous' });
  assert.equal(ionic.status, 'ok', ionic.message);
  assert.equal(ionic.ionic.netUnicode, 'MnO₄⁻ + 5Fe²⁺ + 8H⁺ → Mn²⁺ + 5Fe³⁺ + 4H₂O');
  assert.deepEqual(ionic.coefficients, [1, 5, 8, 1, 5, 4]);
  assert.equal(ionic.deltaH, -619.6);
  assert.ok(ionic.selected.every((entry) => entry.record.phase === 'aq' || entry.record.phase === 'l'));
  assert.match(ionic.note, /по краткому ионному уравнению/);
});

test('уже ионная ОВР вычисляется той же функцией', () => {
  const result = calculateIonicReactionThermo('MnO4^- + 5Fe^2+ + 8H^+ = Mn^2+ + 5Fe^3+ + 4H2O');
  assert.equal(result.status, 'ok', result.message);
  assert.equal(result.deltaH, -619.6);
});

test('неприменимость ионной формы сообщается явно', () => {
  const result = calculateIonicReactionThermo('CH4 + 2O2 = CO2 + 2H2O');
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /по краткому ионному уравнению невозможен/);
});

test('панель предлагает ионный расчёт отдельной кнопкой', () => {
  const panel = readFileSync('js/thermo-panel.js', 'utf8');
  assert.ok(panel.includes("t('tryIonicThermo')"));
  assert.ok(panel.includes('options.ionic'));
});
