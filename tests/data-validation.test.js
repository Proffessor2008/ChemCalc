import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/validate-data.mjs';
import { findThermoRecord } from '../js/thermo.js';

test('все локальные справочники согласованы', () => {
  const result = validateData();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.elements, 118);
  assert.equal(result.stats.substances, 265);
  assert.equal(result.stats.rules, 333);
  assert.equal(result.stats.thermoRecords, 486);
});

test('структурные формулы выбирают правильный изомер по CAS', () => {
  assert.equal(findThermoRecord('CH3CHO', 'l').cas, '75-07-0');
  assert.equal(findThermoRecord('C2H5OH', 'g').cas, '64-17-5');
  assert.equal(findThermoRecord('CH3OCH3', 'g').cas, '115-10-6');
  assert.equal(findThermoRecord('CH3NH2', 'g').cas, '75-04-7');
  assert.equal(findThermoRecord('(CH3)2NH', 'g').cas, '124-40-3');
});
