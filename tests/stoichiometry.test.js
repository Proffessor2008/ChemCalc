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

test('практический выход газа включает количество и объём', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'mass', value: 19.2 },
    availableReactants: { 0: 0.3, 1: 0.8 },
    gasConditions: 'satp',
    yieldPercent: 80,
    yieldProductIndex: 3
  });
  assert.equal(result.limitingFormula, 'Cu');
  assert.equal(result.basisMoles, 0.3);
  assert.equal(result.knownMoles, null);
  assert.equal(result.rows[3].actualMoles, 0.16);
  assert.equal(result.rows[3].actualMassG, 4.80096);
  assert.equal(result.rows[3].actualGasVolumeL, 3.92);
  assert.match(result.steps[0], /Cu: n = 0.3 моль/);
  assert.doesNotMatch(result.steps.join('\n'), /0\.3021433/);
  assert.match(result.steps.at(-1), /NO: n = 0\.16 моль; m = 4\.80096 г; V = 3\.92 л/);
});

test('раствор без газов не получает лишние шаги', () => {
  const result = calculateStoichiometry('CuSO4·5H2O + 2NaOH = Cu(OH)2 + Na2SO4 + 5H2O', {
    known: { index: 1, kind: 'solution', value: 0.5, concentrationMolL: 1 },
    yieldPercent: 80,
    yieldProductIndex: 3
  });
  const text = result.steps.join('\n');
  assert.match(text, /n = C × V = 1 × 0.5 = 0.5 моль/);
  assert.doesNotMatch(text, /Молярная масса NaOH/);
  assert.doesNotMatch(text, /Для газов/);
});

test('чистые галогенводороды считаются газами в стехиометрии', () => {
  const result = calculateStoichiometry('H2S + 4Br2 + 4H2O = H2SO4 + 8HBr', {
    known: { index: 0, kind: 'amount', value: 0.3 },
    gasConditions: 'normal'
  });
  assert.equal(result.rows[4].formula, 'HBr');
  assert.equal(result.rows[4].gasVolumeL, 53.76);
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

test('явная фаза раствора отменяет газ для галогенводорода', () => {
  const aqueous = calculateStoichiometry('H2S + 4Br2 + 4H2O = H2SO4 + 8HBr(aq)', {
    known: { index: 0, kind: 'amount', value: 0.3 },
    gasConditions: 'normal'
  });
  assert.equal(aqueous.rows[4].formula, 'HBr');
  assert.equal(aqueous.rows[4].isGas, false);
  assert.equal(aqueous.rows[4].gasVolumeL, null);
  assert.equal(aqueous.hasGasProduct, false);
  assert.throws(
    () => calculateStoichiometry('H2S + 4Br2 + 4H2O = H2SO4 + 8HBr(aq)', { known: { index: 4, kind: 'gas', value: 10 } }),
    /не отмечено как газ/
  );
  const gaseous = calculateStoichiometry('H2S + 4Br2 + 4H2O = H2SO4 + 8HBr(g)', {
    known: { index: 0, kind: 'amount', value: 0.3 },
    gasConditions: 'normal'
  });
  assert.equal(gaseous.rows[4].isGas, true);
  assert.equal(gaseous.rows[4].gasVolumeL, 53.76);
});

test('расчёт по лимитирующему реагенту прямо объясняет игнор верхних полей', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'mass', value: 19.2 },
    availableReactants: { 0: 0.3, 1: 0.8 },
    gasConditions: 'satp',
    yieldPercent: 80,
    yieldProductIndex: 3
  });
  assert.equal(result.basisSource, 'limiting');
  assert.match(result.steps[0], /Верхние поля «Известное вещество» и «Значение» не используются/);
  assert.doesNotMatch(result.steps.join('\n'), /0\.3021433/);
  assert.equal(result.practicalProducts.length, 1);
  assert.equal(result.targetProduct.formula, 'NO');
  assert.equal(result.targetProduct.moles, 0.16);
  assert.equal(result.targetProduct.massG, 4.80096);
  assert.equal(result.targetProduct.gasVolumeL, 3.92);
});

test('формула газового объёма появляется только при газообразном продукте', () => {
  const noGasProduct = calculateStoichiometry('HCl + NaOH = NaCl + H2O', {
    known: { index: 0, kind: 'solution', value: 0.2, concentrationMolL: 0.5 }
  });
  assert.equal(noGasProduct.hasGasProduct, false);
  assert.doesNotMatch(noGasProduct.steps.join('\n'), /Для газов V = n/);
  const withGasProduct = calculateStoichiometry('2H2 + O2 = 2H2O', { known: { index: 0, kind: 'amount', value: 2 } });
  assert.equal(withGasProduct.hasGasProduct, false);
  const waterGas = calculateStoichiometry('2H2O = 2H2 + O2', { known: { index: 0, kind: 'amount', value: 2 } });
  assert.equal(waterGas.hasGasProduct, true);
  assert.match(waterGas.steps.join('\n'), /Для газов V = n × 22\.4 л\/моль \(н\. у\.\)/);
});

test('одно заданное наличие не подменяет известное вещество молча', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'mass', value: 19.2 },
    availableReactants: { 0: 0.3 }
  });
  assert.equal(result.availableCount, 1);
  assert.equal(result.availableFormula, 'Cu');
  assert.equal(result.basisSource, 'known');
  assert.ok(Math.abs(result.knownMoles - 19.2 / 63.546) < 1e-6);
});

test('остаток реагента очищается от машинного округления', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'amount', value: 1 },
    availableReactants: { 0: 0.3, 1: 0.8 }
  });
  assert.equal(result.rows[1].remainingMoles, 0);
});
