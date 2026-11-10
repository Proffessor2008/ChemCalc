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
  { reactants: 'AlCl3 + NaOH', molecular: 'AlCl3 + 4NaOH → Na[Al(OH)4] + 3NaCl', full: 'Al³⁺ + 3Cl⁻ + 4Na⁺ + 4OH⁻ → Na⁺ + [Al(OH)₄]⁻ + 3Na⁺ + 3Cl⁻', net: 'Al³⁺ + 4OH⁻ → [Al(OH)₄]⁻' },
  { reactants: 'ZnSO4 + KOH', molecular: 'ZnSO4 + 4KOH → K2[Zn(OH)4] + K2SO4', full: 'Zn²⁺ + SO₄²⁻ + 4K⁺ + 4OH⁻ → 2K⁺ + [Zn(OH)₄]²⁻ + 2K⁺ + SO₄²⁻', net: 'Zn²⁺ + 4OH⁻ → [Zn(OH)₄]²⁻' },
  { reactants: 'Cr(NO3)3 + NaOH', molecular: 'Cr(NO3)3 + 4NaOH → Na[Cr(OH)4] + 3NaNO3', full: 'Cr³⁺ + 3NO₃⁻ + 4Na⁺ + 4OH⁻ → Na⁺ + [Cr(OH)₄]⁻ + 3Na⁺ + 3NO₃⁻', net: 'Cr³⁺ + 4OH⁻ → [Cr(OH)₄]⁻' },
  { reactants: 'BeCl2 + KOH', molecular: 'BeCl2 + 4KOH → K2[Be(OH)4] + 2KCl', full: 'Be²⁺ + 2Cl⁻ + 4K⁺ + 4OH⁻ → 2K⁺ + [Be(OH)₄]²⁻ + 2K⁺ + 2Cl⁻', net: 'Be²⁺ + 4OH⁻ → [Be(OH)₄]²⁻' }
];

for (const item of cases) {
  test(`Амфотерность при избытке щёлочи: ${item.reactants}`, () => {
    const prediction = predictReaction(item.reactants, { medium: 'neutral', solvent: 'aqueous', ratio: 'normal' });
    assert.equal(prediction.status, 'predicted', prediction.message);
    assert.equal(prediction.formatted, item.molecular);
    const ionic = buildIonicEquations(withCoefficients(prediction));
    assert.equal(ionic.status, 'ok', ionic.message);
    assert.equal(ionic.fullUnicode, item.full);
    assert.equal(ionic.netUnicode, item.net);
    assert.ok(inspectBalance(ionic.fullEquation).isBalanced);
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
  });
}

test('щелочная среда использует обновлённый шаблон AlCl3', () => {
  const result = predictReaction('AlCl3 + NaOH', { medium: 'alkaline', solvent: 'aqueous', ratio: 'normal' });
  assert.equal(result.status, 'predicted', result.message);
  assert.equal(result.formatted, 'AlCl3 + 4NaOH → Na[Al(OH)4] + 3NaCl');
});
