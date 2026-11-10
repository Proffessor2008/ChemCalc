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
  assert.deepEqual(sideMap(actual, 'left'), sideMap(reference, 'left'));
  assert.deepEqual(sideMap(actual, 'right'), sideMap(reference, 'right'));
  assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  return result;
}

const acidSaltCases = [
  ['KHCO3 + HCl', 'KHCO3 + HCl = KCl + CO2 + H2O', {}],
  ['KHSO3 + HCl', 'KHSO3 + HCl = KCl + SO2 + H2O', {}],
  ['KHS + HCl', 'KHS + HCl = KCl + H2S', {}],
  ['KHCO3 + KOH', 'KHCO3 + KOH = K2CO3 + H2O', {}],
  ['NaHSO3 + NaOH', 'NaHSO3 + NaOH = Na2SO3 + H2O', {}],
  ['KHS + KOH', 'KHS + KOH = K2S + H2O', {}],
  ['KH2PO4 + 2KOH', 'KH2PO4 + 2KOH = K3PO4 + 2H2O', {}],
  ['Na2HPO4 + NaOH', 'Na2HPO4 + NaOH = Na3PO4 + H2O', {}],
  ['Ca(HCO3)2 + 2NaOH', 'Ca(HCO3)2 + 2NaOH = CaCO3 + Na2CO3 + 2H2O', {}]
];

for (const [reactants, expected, conditions] of acidSaltCases) {
  test(`Кислая соль: ${reactants}`, () => assertPrediction(reactants, expected, conditions));
}

test('разные катионы сохраняются в виде двух отдельных солей', () => {
  const result = assertPrediction('NaHCO3 + KOH', '2NaHCO3 + 2KOH = Na2CO3 + K2CO3 + 2H2O');
  assert.ok(result.assumptions.some((line) => line.includes('двойная соль')));
});

const complexCases = [
  ['K[Al(OH)4] + HCl', 'K[Al(OH)4] + HCl = Al(OH)3 + KCl + H2O', { ratio: 'deficit' }],
  ['K[Al(OH)4] + 4HCl', 'K[Al(OH)4] + 4HCl = AlCl3 + KCl + 4H2O', { ratio: 'normal' }],
  ['K2[Zn(OH)4] + 2HCl', 'K2[Zn(OH)4] + 2HCl = Zn(OH)2 + 2KCl + 2H2O', { ratio: 'deficit' }],
  ['K2[Zn(OH)4] + 4HCl', 'K2[Zn(OH)4] + 4HCl = ZnCl2 + 2KCl + 4H2O', { ratio: 'normal' }],
  ['K3[Cr(OH)6] + 3HCl', 'K3[Cr(OH)6] + 3HCl = Cr(OH)3 + 3KCl + 3H2O', { ratio: 'deficit' }],
  ['K3[Cr(OH)6] + 6HCl', 'K3[Cr(OH)6] + 6HCl = CrCl3 + 3KCl + 6H2O', { ratio: 'normal' }]
];

for (const [reactants, expected, conditions] of complexCases) {
  test(`Комплекс и кислота: ${reactants}`, () => assertPrediction(reactants, expected, conditions));
}

test('электролиз KCl и CaCl2 в расплаве', () => {
  assertPrediction('KCl', '2KCl = 2K + Cl2', { current: true, solvent: 'melt' });
  assertPrediction('CaCl2', 'CaCl2 = Ca + Cl2', { current: true, solvent: 'melt' });
});

test('электролиз NaBr в расплаве', () => {
  assertPrediction('NaBr', '2NaBr = 2Na + Br2', { current: true, solvent: 'melt' });
});

test('электролиз KCl в водном растворе', () => {
  assertPrediction('KCl', '2KCl + 2H2O = 2KOH + H2 + Cl2', { current: true, solvent: 'aqueous' });
});

test('электролиз ZnSO4 в водном растворе', () => {
  assertPrediction('ZnSO4', '2ZnSO4 + 2H2O = 2Zn + O2 + 2H2SO4', { current: true, solvent: 'aqueous' });
});

test('электролиз NaNO3 сводится к разложению воды', () => {
  assertPrediction('NaNO3', '2H2O = 2H2 + O2', { current: true, solvent: 'aqueous' });
});

test('без тока электролиз не выдаётся', () => {
  assert.equal(predictReaction('KCl', { current: false, solvent: 'melt' }).status, 'needs-conditions');
  assert.equal(predictReaction('KCl', { current: false, solvent: 'aqueous' }).status, 'needs-conditions');
});
