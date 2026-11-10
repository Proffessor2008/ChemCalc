import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations } from '../js/ionic.js';
import { predictReaction } from '../js/predictor.js';

function withCoefficients(result) {
  return {
    ...result.equation,
    left: result.equation.left.map((item, index) => ({ ...item, coefficient: result.coefficients[index] })),
    right: result.equation.right.map((item, index) => ({ ...item, coefficient: result.coefficients[result.equation.left.length + index] }))
  };
}

const cases = [
  { reactants: 'NH4Cl + NaOH', molecular: 'NH4Cl + NaOH → NaCl + NH3↑ + H2O', full: 'NH₄⁺ + Cl⁻ + Na⁺ + OH⁻ → Na⁺ + Cl⁻ + NH₃↑ + H₂O', net: 'NH₄⁺ + OH⁻ → NH₃↑ + H₂O' },
  { reactants: '(NH4)2SO4 + 2KOH', molecular: '(NH4)2SO4 + 2KOH → K2SO4 + 2NH3↑ + 2H2O', full: '2NH₄⁺ + SO₄²⁻ + 2K⁺ + 2OH⁻ → 2K⁺ + SO₄²⁻ + 2NH₃↑ + 2H₂O', net: 'NH₄⁺ + OH⁻ → NH₃↑ + H₂O' },
  { reactants: 'NH4NO3 + NaOH', molecular: 'NH4NO3 + NaOH → NaNO3 + NH3↑ + H2O', full: 'NH₄⁺ + NO₃⁻ + Na⁺ + OH⁻ → Na⁺ + NO₃⁻ + NH₃↑ + H₂O', net: 'NH₄⁺ + OH⁻ → NH₃↑ + H₂O' },
  { reactants: '(NH4)2CO3 + 2HCl', molecular: '(NH4)2CO3 + 2HCl → 2NH4Cl + CO2↑ + H2O', full: '2NH₄⁺ + CO₃²⁻ + 2H⁺ + 2Cl⁻ → 2NH₄⁺ + 2Cl⁻ + CO₂↑ + H₂O', net: 'CO₃²⁻ + 2H⁺ → CO₂↑ + H₂O' }
];

for (const item of cases) {
  test(`Аммоний и ионный баланс: ${item.reactants}`, () => {
    const prediction = predictReaction(item.reactants, { solvent: 'aqueous', heating: !item.reactants.includes('CO3') });
    assert.equal(prediction.status, 'predicted', prediction.message);
    assert.equal(prediction.formatted, item.molecular);
    const ionic = buildIonicEquations(withCoefficients(prediction));
    assert.equal(ionic.status, 'ok', ionic.message);
    assert.equal(ionic.fullUnicode, item.full);
    assert.equal(ionic.netUnicode, item.net);
    assert.ok(inspectBalance(ionic.fullEquation).isBalanced);
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
    assert.equal(ionic.netEquation.left.reduce((sum, species) => sum + species.charge * species.coefficient, 0), 0);
    assert.equal(ionic.netEquation.right.reduce((sum, species) => sum + species.charge * species.coefficient, 0), 0);
  });
}

test('щелочная среда использует общее правило солей аммония', () => {
  for (const item of cases.filter(({ reactants }) => !reactants.includes('CO3'))) {
    const prediction = predictReaction(item.reactants, { medium: 'alkaline', solvent: 'aqueous', heating: true });
    assert.equal(prediction.status, 'predicted', prediction.message);
    if (item.reactants === 'NH4Cl + NaOH') assert.equal(prediction.ruleId, 'generic-ammonium-salt-base');
    assert.equal(prediction.formatted, item.molecular);
    const ionic = buildIonicEquations(withCoefficients(prediction));
    assert.equal(ionic.fullUnicode, item.full);
    assert.equal(ionic.netUnicode, item.net);
    assert.ok(inspectBalance(ionic.fullEquation).isBalanced);
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
  }
});
