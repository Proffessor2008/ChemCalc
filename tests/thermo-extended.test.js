import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReactionThermo, findThermoRecord, THERMO_RECORDS } from '../js/thermo.js';

test('3.1: разложение бертолетовой соли', () => {
  const result = calculateReactionThermo('2KClO3 = 2KCl + 3O2');
  assert.equal(result.status, 'ok');
  assert.equal(result.deltaH, -77.6);
  assert.equal(result.deltaS, 494.6);
  assert.equal(result.deltaG, -224.4);
});

test('3.3: каталитическое разложение H2O2', () => {
  const result = calculateReactionThermo('2H2O2 = 2H2O + O2');
  assert.equal(result.status, 'ok');
  assert.equal(result.deltaH, -196);
  assert.equal(result.deltaS, 126);
  assert.equal(result.deltaG, -233.4);
});

test('3.4: PH3 + 2O2 = H3PO4', () => {
  const result = calculateReactionThermo('PH3 + 2O2 = H3PO4');
  assert.equal(result.status, 'ok');
  assert.equal(result.deltaH, -1289.8);
  assert.equal(result.deltaS, -510.1);
  assert.equal(result.deltaG, -1137.8);
});

test('3.2: K2FeO4 имеет данные с погрешностями и твёрдым стандартным состоянием', () => {
  const record = findThermoRecord('K2FeO4', 's');
  assert.equal(record.Hf_kJ_mol, -1026);
  assert.equal(record.Gf_kJ_mol, -896);
  assert.equal(record.S_J_mol_K, 130);
  assert.deepEqual(record.uncertainty, { Hf_kJ_mol: 4, Gf_kJ_mol: 8, S_J_mol_K: 17 });
  assert.match(record.note, /не к водному раствору/);
});

test('добавлены хроматы, перманганаты, манганаты и ионные формы', () => {
  for (const formula of ['CrO4^2-', 'Cr2O7^2-', 'MnO4^-', 'MnO4^2-', 'Fe^2+', 'Fe^3+', 'I^-']) assert.ok(findThermoRecord(formula, 'aq'), formula);
  assert.ok(THERMO_RECORDS.length >= 436);
  assert.ok(THERMO_RECORDS.every((record) => record.source));
});

test('тиосульфат, бромид и ромбическая сера имеют подтверждённые константы', () => {
  assert.deepEqual(
    ['Hf_kJ_mol', 'Gf_kJ_mol', 'S_J_mol_K'].map((key) => findThermoRecord('S2O3^2-', 'aq')[key]),
    [-648.5, -522.5, 67]
  );
  assert.deepEqual(
    ['Hf_kJ_mol', 'Gf_kJ_mol', 'S_J_mol_K'].map((key) => findThermoRecord('Br^-', 'aq')[key]),
    [-120.9, -102.82, 80.71]
  );
  assert.equal(findThermoRecord('S', 's').S_J_mol_K, 32.1);
  const result = calculateReactionThermo('S2O3^2- + 2H^+ = S↓ + SO2↑ + H2O');
  assert.equal(result.status, 'ok', result.message);
  assert.ok(result.selected.every((entry) => entry.record));
});
