import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations, ionicForUnbalanced } from '../js/ionic.js';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';

function sideMap(equation, side) {
  const totals = new Map();
  for (const species of equation[side]) totals.set(species.formula, (totals.get(species.formula) || 0) + species.coefficient);
  return Object.fromEntries(totals);
}

function assertSameEquation(actual, expected) {
  const left = typeof actual === 'string' ? parseEquation(actual) : actual;
  const right = typeof expected === 'string' ? parseEquation(expected) : expected;
  assert.deepEqual(sideMap(left, 'left'), sideMap(right, 'left'), 'левая часть');
  assert.deepEqual(sideMap(left, 'right'), sideMap(right, 'right'), 'правая часть');
}

const hydrolysisCases = [
  { reactants: 'FeCl3 + Na2CO3', molecular: '2FeCl3 + 3Na2CO3 + 3H2O = 2Fe(OH)3 + 3CO2 + 6NaCl', net: '2Fe^3+ + 3CO3^2- + 3H2O = 2Fe(OH)3 + 3CO2' },
  { reactants: 'Fe(NO3)3 + K2SO3', molecular: '2Fe(NO3)3 + 3K2SO3 + 3H2O = 2Fe(OH)3 + 3SO2 + 6KNO3', net: '2Fe^3+ + 3SO3^2- + 3H2O = 2Fe(OH)3 + 3SO2' },
  { reactants: 'Fe2(SO4)3 + Na2S', molecular: 'Fe2(SO4)3 + 3Na2S + 6H2O = 2Fe(OH)3 + 3H2S + 3Na2SO4', net: '2Fe^3+ + 3S^2- + 6H2O = 2Fe(OH)3 + 3H2S' },
  { reactants: 'AlCl3 + K2CO3', molecular: '2AlCl3 + 3K2CO3 + 3H2O = 2Al(OH)3 + 3CO2 + 6KCl', net: '2Al^3+ + 3CO3^2- + 3H2O = 2Al(OH)3 + 3CO2' },
  { reactants: 'Al2(SO4)3 + Na2SO3', molecular: 'Al2(SO4)3 + 3Na2SO3 + 3H2O = 2Al(OH)3 + 3SO2 + 3Na2SO4', net: '2Al^3+ + 3SO3^2- + 3H2O = 2Al(OH)3 + 3SO2' },
  { reactants: 'Al(NO3)3 + K2S', molecular: '2Al(NO3)3 + 3K2S + 6H2O = 2Al(OH)3 + 3H2S + 6KNO3', net: '2Al^3+ + 3S^2- + 6H2O = 2Al(OH)3 + 3H2S' },
  { reactants: 'CrCl3 + Na2CO3', molecular: '2CrCl3 + 3Na2CO3 + 3H2O = 2Cr(OH)3 + 3CO2 + 6NaCl', net: '2Cr^3+ + 3CO3^2- + 3H2O = 2Cr(OH)3 + 3CO2' },
  { reactants: 'Cr2(SO4)3 + K2SO3', molecular: 'Cr2(SO4)3 + 3K2SO3 + 3H2O = 2Cr(OH)3 + 3SO2 + 3K2SO4', net: '2Cr^3+ + 3SO3^2- + 3H2O = 2Cr(OH)3 + 3SO2' },
  { reactants: 'Cr(NO3)3 + Na2S', molecular: '2Cr(NO3)3 + 3Na2S + 6H2O = 2Cr(OH)3 + 3H2S + 6NaNO3', net: '2Cr^3+ + 3S^2- + 6H2O = 2Cr(OH)3 + 3H2S' },
  { reactants: 'CuSO4 + Na2CO3', molecular: '2CuSO4 + 2Na2CO3 + H2O = (CuOH)2CO3 + CO2 + 2Na2SO4', net: '2Cu^2+ + 2CO3^2- + H2O = (CuOH)2CO3 + CO2' },
  { reactants: 'CuCl2 + K2CO3', molecular: '2CuCl2 + 2K2CO3 + H2O = (CuOH)2CO3 + CO2 + 4KCl', net: '2Cu^2+ + 2CO3^2- + H2O = (CuOH)2CO3 + CO2' }
];

for (const item of hydrolysisCases) {
  test(`Взаимный гидролиз: ${item.reactants}`, () => {
    const result = predictReaction(item.reactants, { medium: 'neutral', solvent: 'aqueous', ratio: 'normal' });
    assert.equal(result.status, 'predicted', result.message);
    assertSameEquation(result.formatted, item.molecular);
    assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
    const ionic = buildIonicEquations({
      ...result.equation,
      left: result.equation.left.map((species, index) => ({ ...species, coefficient: result.coefficients[index] })),
      right: result.equation.right.map((species, index) => ({ ...species, coefficient: result.coefficients[result.equation.left.length + index] }))
    });
    assert.equal(ionic.status, 'ok', ionic.message);
    assertSameEquation(ionic.netEquation, item.net);
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
  });
}

const advancedIonicCases = [
  { reactants: 'K2Cr2O7 + 14HCl', conditions: { medium: 'acidic', acidConcentration: 'concentrated' }, molecular: 'K2Cr2O7 + 14HCl = 2CrCl3 + 3Cl2 + 2KCl + 7H2O', full: '2K^+ + Cr2O7^2- + 14H^+ + 14Cl^- = 2Cr^3+ + 6Cl^- + 3Cl2 + 2K^+ + 2Cl^- + 7H2O', net: 'Cr2O7^2- + 14H^+ + 6Cl^- = 2Cr^3+ + 3Cl2 + 7H2O' },
  { reactants: 'Ba(OH)2 + H2SO4', molecular: 'Ba(OH)2 + H2SO4 = BaSO4 + 2H2O', full: 'Ba^2+ + 2OH^- + 2H^+ + SO4^2- = BaSO4 + 2H2O', net: 'Ba^2+ + 2OH^- + 2H^+ + SO4^2- = BaSO4 + 2H2O' },
  { reactants: 'Na2S2O3 + H2SO4', molecular: 'Na2S2O3 + H2SO4 = S + SO2 + H2O + Na2SO4', full: '2Na^+ + S2O3^2- + 2H^+ + SO4^2- = S + SO2 + H2O + 2Na^+ + SO4^2-', net: 'S2O3^2- + 2H^+ = S + SO2 + H2O' },
  { reactants: 'KHCO3 + KOH', molecular: 'KHCO3 + KOH = K2CO3 + H2O', full: 'K^+ + HCO3^- + K^+ + OH^- = 2K^+ + CO3^2- + H2O', net: 'HCO3^- + OH^- = CO3^2- + H2O' },
  { reactants: 'Al(OH)2Cl + HCl', molecular: 'Al(OH)2Cl + 2HCl = AlCl3 + 2H2O', full: 'Al(OH)2^+ + Cl^- + 2H^+ + 2Cl^- = Al^3+ + 3Cl^- + 2H2O', net: 'Al(OH)2^+ + 2H^+ = Al^3+ + 2H2O' },
  { reactants: 'NaH2PO4 + 2NaOH', conditions: { ratio: 'normal' }, molecular: 'NaH2PO4 + 2NaOH = Na3PO4 + 2H2O', full: 'Na^+ + H2PO4^- + 2Na^+ + 2OH^- = 3Na^+ + PO4^3- + 2H2O', net: 'H2PO4^- + 2OH^- = PO4^3- + 2H2O' },
  { reactants: 'Na[Al(OH)4] + CO2', conditions: { ratio: 'normal' }, molecular: 'Na[Al(OH)4] + CO2 = Al(OH)3 + NaHCO3', full: 'Na^+ + [Al(OH)4]^- + CO2 = Al(OH)3 + Na^+ + HCO3^-', net: '[Al(OH)4]^- + CO2 = Al(OH)3 + HCO3^-' },
  { reactants: 'K2[Zn(OH)4] + 4HBr', conditions: { ratio: 'normal' }, molecular: 'K2[Zn(OH)4] + 4HBr = ZnBr2 + 2KBr + 4H2O', full: '2K^+ + [Zn(OH)4]^2- + 4H^+ + 4Br^- = Zn^2+ + 2Br^- + 2K^+ + 2Br^- + 4H2O', net: '[Zn(OH)4]^2- + 4H^+ = Zn^2+ + 4H2O' },
  { reactants: 'Cu2O + H2SO4', conditions: { medium: 'acidic', acidConcentration: 'diluted' }, molecular: 'Cu2O + H2SO4 = Cu + CuSO4 + H2O', full: 'Cu2O + 2H^+ + SO4^2- = Cu + Cu^2+ + SO4^2- + H2O', net: 'Cu2O + 2H^+ = Cu + Cu^2+ + H2O' },
  { reactants: 'Fe3O4 + 8HCl', conditions: { medium: 'acidic' }, molecular: 'Fe3O4 + 8HCl = FeCl2 + 2FeCl3 + 4H2O', full: 'Fe3O4 + 8H^+ + 8Cl^- = Fe^2+ + 2Cl^- + 2Fe^3+ + 6Cl^- + 4H2O', net: 'Fe3O4 + 8H^+ = Fe^2+ + 2Fe^3+ + 4H2O' }
];

for (const item of advancedIonicCases) {
  test(`Сложное ионное уравнение: ${item.reactants}`, () => {
    const prediction = predictReaction(item.reactants, item.conditions);
    assert.equal(prediction.status, 'predicted', prediction.message);
    assertSameEquation(prediction.formatted, item.molecular);
    const ionic = buildIonicEquations(item.molecular);
    assert.equal(ionic.status, 'ok', ionic.message);
    assertSameEquation(ionic.fullEquation, item.full);
    assertSameEquation(ionic.netEquation, item.net);
    assert.ok(inspectBalance(ionic.fullEquation).isBalanced);
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
  });
}

test('Cl2 + NaOH при нагревании: натрий полностью сокращается', () => {
  const result = ionicForUnbalanced('3Cl2 + 6NaOH = 5NaCl + NaClO3 + 3H2O');
  assert.equal(result.status, 'ok');
  assertSameEquation(result.netEquation, '3Cl2 + 6OH^- = 5Cl^- + ClO3^- + 3H2O');
  assert.ok(result.spectators.some((ion) => ion.formula === 'Na^+' && ion.coefficient === 6));
});
