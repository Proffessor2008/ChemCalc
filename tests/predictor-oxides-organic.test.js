import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';

function sideMap(equation, side) {
  return Object.fromEntries(equation[side].map((item) => [item.formula, item.coefficient]));
}

function assertPrediction(reactants, expected, conditions = {}) {
  const result = predictReaction(reactants, conditions);
  assert.equal(result.status, 'predicted', `${reactants}: ${result.message}`);
  const actual = parseEquation(result.formatted);
  const reference = parseEquation(expected);
  assert.deepEqual(sideMap(actual, 'left'), sideMap(reference, 'left'), 'левая часть');
  assert.deepEqual(sideMap(actual, 'right'), sideMap(reference, 'right'), 'правая часть');
  assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  return result;
}

const oxideCases = [
  ['MgO + HCl', 'MgO + 2HCl = MgCl2 + H2O'],
  ['FeO + H2SO4', 'FeO + H2SO4 = FeSO4 + H2O'],
  ['Na2O + HNO3', 'Na2O + 2HNO3 = 2NaNO3 + H2O'],
  ['CO2 + KOH', 'CO2 + 2KOH = K2CO3 + H2O'],
  ['SO2 + KOH', 'SO2 + 2KOH = K2SO3 + H2O'],
  ['P2O5 + NaOH', 'P2O5 + 6NaOH = 2Na3PO4 + 3H2O'],
  ['SiO2 + KOH', 'SiO2 + 2KOH = K2SiO3 + H2O'],
  ['N2O5 + NaOH', 'N2O5 + 2NaOH = 2NaNO3 + H2O'],
  ['Al(OH)3 + KOH', 'Al(OH)3 + KOH = K[Al(OH)4]'],
  ['Zn(OH)2 + KOH', 'Zn(OH)2 + 2KOH = K2[Zn(OH)4]'],
  ['Cr(OH)3 + KOH', 'Cr(OH)3 + 3KOH = K3[Cr(OH)6]'],
  ['Al2O3 + KOH', 'Al2O3 + 2KOH + 3H2O = 2K[Al(OH)4]'],
  ['ZnO + KOH', 'ZnO + 2KOH + H2O = K2[Zn(OH)4]'],
  ['Cr2O3 + KOH', 'Cr2O3 + 6KOH + 3H2O = 2K3[Cr(OH)6]'],
  ['Mg(OH)2 + HCl', 'Mg(OH)2 + 2HCl = MgCl2 + 2H2O']
];

for (const [reactants, expected] of oxideCases) {
  test(`Общее правило: ${reactants}`, () => assertPrediction(reactants, expected));
}

test('недостаток основания даёт гидрокарбонат', () => {
  assertPrediction('CO2 + KOH', 'CO2 + KOH = KHCO3', { ratio: 'deficit' });
});

test('недостаток основания даёт гидросульфат', () => {
  assertPrediction('SO3 + KOH', 'SO3 + KOH = KHSO4', { ratio: 'deficit' });
});

test('гидролиз P2O5 при недостатке основания добавляет воду слева', () => {
  assertPrediction('P2O5 + NaOH', 'P2O5 + 2NaOH + H2O = 2NaH2PO4', { ratio: 'deficit' });
});

test('окислительные условия не подменяются простой схемой', () => {
  assert.equal(predictReaction('FeO + HNO3').status, 'no-rule');
  assert.equal(predictReaction('MgO + H2SO4', { acidConcentration: 'concentrated' }).status, 'no-rule');
});

test('омыление этилацетата', () => {
  assertPrediction('CH3COOC2H5 + NaOH', 'CH3COOC2H5 + NaOH = CH3COONa + C2H5OH', { medium: 'alkaline', solvent: 'aqueous', heating: true });
});

test('кислотный гидролиз этилацетата обратим', () => {
  const result = assertPrediction('CH3COOC2H5 + H2O', 'CH3COOC2H5 + H2O = CH3COOH + C2H5OH', { medium: 'acidic', solvent: 'aqueous', heating: true });
  assert.equal(result.equation.separator, '⇄');
});

test('окисление ацетальдегида до уксусной кислоты', () => {
  assertPrediction('CH3CHO + O2', '2CH3CHO + O2 = 2CH3COOH', { heating: true });
});

test('гидрирование ацетальдегида, этилена и ацетилена', () => {
  const conditions = { catalyst: 'Ni', heating: true };
  assertPrediction('CH3CHO + H2', 'CH3CHO + H2 = C2H5OH', conditions);
  assertPrediction('C2H4 + H2', 'C2H4 + H2 = C2H6', conditions);
  assertPrediction('C2H2 + 2H2', 'C2H2 + 2H2 = C2H6', conditions);
});

test('окисление этанола оксидом меди', () => {
  assertPrediction('C2H5OH + CuO', 'C2H5OH + CuO = CH3CHO + Cu + H2O', { heating: true });
});
