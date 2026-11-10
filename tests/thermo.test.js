import test from 'node:test';
import assert from 'node:assert/strict';
import { THERMO_RECORDS, calculateReactionThermo, findThermoRecord, gibbsAtTemperature } from '../js/thermo.js';

test('термодинамическая таблица содержит не менее 300 полных записей с источниками', () => {
  assert.ok(THERMO_RECORDS.length >= 300);
  for (const record of THERMO_RECORDS) {
    assert.ok(record.formula && record.name_ru && record.source);
    assert.ok(['s', 'l', 'g', 'aq'].includes(record.phase));
    assert.ok(Number.isFinite(record.Hf_kJ_mol));
    assert.ok(Number.isFinite(record.Gf_kJ_mol));
    assert.ok(Number.isFinite(record.S_J_mol_K));
  }
});

test('простые вещества в стандартном состоянии имеют явные нули', () => {
  for (const [formula, phase] of [['C', 's'], ['O2', 'g'], ['H2', 'g']]) {
    const [symbol, expectedPhase] = formula.split(',');
    const record = findThermoRecord(symbol, expectedPhase);
    assert.equal(record.Hf_kJ_mol, 0);
    assert.equal(record.Gf_kJ_mol, 0);
  }
});

test('C(графит) + O2 = CO2', () => {
  const result = calculateReactionThermo('C + O2 = CO2');
  assert.equal(result.status, 'ok');
  assert.equal(result.deltaH, -393.5);
  assert.equal(result.effect, 'Экзотермическая реакция');
  assert.ok(result.curve.length > 10);
});

test('образование воды и горение метана', () => {
  const water = calculateReactionThermo('2H2 + O2 = 2H2O');
  assert.ok(Math.abs(water.deltaH + 571.6) < 0.01);
  const methane = calculateReactionThermo('CH4 + 2O2 = CO2 + 2H2O');
  assert.ok(Math.abs(methane.deltaH + 890.5) < 0.01);
  assert.ok(methane.logK > 100);
  assert.equal(gibbsAtTemperature(-100, -50, 400), -80);
});

test('отсутствие хотя бы одного вещества останавливает расчёт', () => {
  const result = calculateReactionThermo('Xe + F2 = XeF2');
  assert.equal(result.status, 'missing-data');
  assert.ok(result.missing.length > 0);
  assert.equal(result.deltaH, undefined);
});
