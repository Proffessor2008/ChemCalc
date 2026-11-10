import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStoichiometry } from '../js/stoichiometry.js';

const water = '2H2 + O2 = 2H2O';

test('пересчёт массы через количество вещества', () => {
  const result = calculateStoichiometry(water, { known: { index: 0, kind: 'mass', value: 4 }, yieldPercent: 100 });
  assert.equal(result.status, 'ok');
  assert.ok(Math.abs(result.knownMoles - 4 / 2.016) < 5e-8);
  assert.ok(Math.abs(result.rows[2].massG - 4 / 2.016 * 18.015) < 5e-6);
  assert.deepEqual(result.coefficients, [2, 1, 2]);
});

test('объём газа на н.у. и САТП', () => {
  const normal = calculateStoichiometry(water, { known: { index: 0, kind: 'gas', value: 44.8, gasConditions: 'normal' } });
  assert.equal(normal.knownMoles, 2);
  assert.equal(normal.rows[2].moles, 2);
  const satp = calculateStoichiometry(water, { known: { index: 0, kind: 'amount', value: 2 }, gasConditions: 'satp' });
  assert.equal(satp.rows[1].gasVolumeL, 24.5);
});

test('количество по объёму и концентрации раствора', () => {
  const result = calculateStoichiometry('HCl + NaOH = NaCl + H2O', { known: { index: 0, kind: 'solution', value: 0.2, concentrationMolL: 0.5 } });
  assert.equal(result.knownMoles, 0.1);
  assert.equal(result.rows[2].moles, 0.1);
});

test('определяется лимитирующий реагент и остаток', () => {
  const result = calculateStoichiometry(water, {
    known: { index: 0, kind: 'amount', value: 1 },
    availableReactants: { 0: 2, 1: 2 },
    yieldPercent: 100
  });
  assert.equal(result.limitingFormula, 'H2');
  assert.equal(result.rows[2].moles, 2);
  assert.equal(result.rows[1].remainingMoles, 1);
});

test('практический выход применяется только к продуктам', () => {
  const result = calculateStoichiometry(water, { known: { index: 0, kind: 'amount', value: 2 }, yieldPercent: 80 });
  assert.equal(result.rows[2].moles, 2);
  assert.equal(result.rows[2].actualMoles, 1.6);
  assert.equal(result.rows[0].actualMassG, null);
});

test('пропан пересчитывается по коэффициентам', () => {
  const result = calculateStoichiometry('C3H8 + O2 = CO2 + H2O', { known: { index: 0, kind: 'amount', value: 1 } });
  assert.deepEqual(result.coefficients, [1, 5, 3, 4]);
  assert.equal(result.rows[2].moles, 3);
  assert.equal(result.rows[3].moles, 4);
});

test('некорректные значения отклоняются', () => {
  assert.throws(() => calculateStoichiometry(water, { known: { index: 0, kind: 'mass', value: -1 } }), /положительным/);
  assert.throws(() => calculateStoichiometry(water, { known: { index: 0, kind: 'amount', value: 1 }, yieldPercent: 120 }), /интервале/);
});
