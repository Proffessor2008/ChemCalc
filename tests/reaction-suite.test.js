import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectBalance } from '../js/balancer.js';
import { predictReaction } from '../js/predictor.js';
import { parseReactionSuite, runReactionCase } from '../scripts/run-reaction-suite.mjs';
import finalReactionData from '../data/reaction-rules-final.json' with { type: 'json' };

const sourcePath = process.env.REACTION_TESTS_PATH;
const embeddedCases = finalReactionData.rules.map((rule) => ({
  id: Number(rule.id.slice(-3)),
  input: rule.reactants.map((formula, index) => `${rule.inputCoefficients?.[index] > 1 ? rule.inputCoefficients[index] : ''}${formula}`).join(' + '),
  conditions: rule.when,
  expected: rule.outcome === 'no-reaction' ? rule.message : rule.products.map((formula, index) => `${rule.expectedCoefficients?.[index] > 1 ? rule.expectedCoefficients[index] : ''}${formula}`).join(' + ')
}));
const cases = sourcePath ? parseReactionSuite(readFileSync(sourcePath, 'utf8')) : embeddedCases;

for (const item of cases) {
  test(`Финальный пакет ${String(item.id).padStart(3, '0')}: ${item.input}`, () => {
    const result = runReactionCase(item);
    assert.equal(result.matches, true, result.result.formatted || result.result.message);
    if (item.id !== 197 && !item.expected.startsWith('Реакция не идёт')) {
      assert.ok(inspectBalance(result.result.equation, result.result.coefficients).isBalanced);
    }
  });
}

test('исправление теста 197: омыление корректно записанного триглицерида', () => {
  const result = predictReaction('C3H5(C17H35COO)3 + 3NaOH', { medium: 'alkaline', solvent: 'aqueous', heating: true });
  assert.equal(result.status, 'predicted');
  assert.deepEqual(result.coefficients, [1, 3, 3, 1]);
  assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
});
