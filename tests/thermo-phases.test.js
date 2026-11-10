import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecies } from '../js/parser.js';
import { calculateReactionThermo, recordForSpecies, THERMO_RECORDS } from '../js/thermo.js';

test('термодинамическая база содержит 486 записей с источниками', () => {
  assert.equal(THERMO_RECORDS.length, 486);
  assert.ok(THERMO_RECORDS.every((record) => record.source && Number.isFinite(record.Hf_kJ_mol) && Number.isFinite(record.Gf_kJ_mol) && Number.isFinite(record.S_J_mol_K)));
});

test('водный раствор выбирает aq и не подставляет твёрдую фазу растворимой соли', () => {
  assert.equal(recordForSpecies(parseSpecies('NaCl'), { solvent: 'aqueous' }).phase, 'aq');
  assert.equal(recordForSpecies(parseSpecies('NaCl')).phase, 's');
  assert.equal(recordForSpecies(parseSpecies('FeCl3'), { solvent: 'aqueous' }), null);
  assert.equal(recordForSpecies(parseSpecies('FeCl3↓'), { solvent: 'aqueous' }).phase, 's');
});

test('расчёт сообщает только о действительно отсутствующих фазах', () => {
  const result = calculateReactionThermo('FeCl3 + 3NaOH = Fe(OH)3↓ + 3NaCl', { solvent: 'aqueous' });
  assert.equal(result.status, 'missing-data');
  assert.deepEqual(result.missing, ['FeCl3', 'NaOH']);
});

test('новые данные поддерживают разложение кальцита и горение глюкозы', () => {
  const calcite = calculateReactionThermo('CaCO3 = CaO + CO2');
  assert.equal(calcite.status, 'ok', calcite.message);
  assert.equal(calcite.deltaH, 179.2);
  const glucose = calculateReactionThermo('C6H12O6 + 6O2 = 6CO2 + 6H2O');
  assert.equal(glucose.status, 'ok', glucose.message);
  assert.equal(glucose.deltaH, -2802.5);
});
