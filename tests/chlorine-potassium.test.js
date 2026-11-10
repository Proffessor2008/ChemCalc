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

test('3Cl2 + 6KOH при нагревании: молекулярное и ионные уравнения', () => {
  const result = predictReaction('3Cl2 + 6KOH', { medium: 'alkaline', solvent: 'aqueous', heating: true });
  assert.equal(result.status, 'predicted', result.message);
  assert.equal(result.formatted, '3Cl2 + 6KOH → 5KCl + KClO3 + 3H2O');
  const ionic = buildIonicEquations(withCoefficients(result));
  assert.equal(ionic.status, 'ok', ionic.message);
  assert.equal(ionic.fullUnicode, '3Cl₂ + 6K⁺ + 6OH⁻ → 5K⁺ + 5Cl⁻ + K⁺ + ClO₃⁻ + 3H₂O');
  assert.equal(ionic.netUnicode, '3Cl₂ + 6OH⁻ → 5Cl⁻ + ClO₃⁻ + 3H₂O');
  assert.ok(ionic.spectators.some((ion) => ion.formula === 'K^+' && ion.coefficient === 6));
  assert.ok(inspectBalance(ionic.netEquation).isBalanced);
});

test('Cl2 + 2KOH в холоде: KClO диссоциирует и K+ сокращается', () => {
  const result = predictReaction('Cl2 + 2KOH', { medium: 'alkaline', solvent: 'aqueous', heating: false });
  assert.equal(result.status, 'predicted', result.message);
  assert.equal(result.formatted, 'Cl2 + 2KOH → KCl + KClO + H2O');
  const ionic = buildIonicEquations(withCoefficients(result));
  assert.equal(ionic.fullUnicode, 'Cl₂ + 2K⁺ + 2OH⁻ → K⁺ + Cl⁻ + K⁺ + ClO⁻ + H₂O');
  assert.equal(ionic.netUnicode, 'Cl₂ + 2OH⁻ → Cl⁻ + ClO⁻ + H₂O');
});
