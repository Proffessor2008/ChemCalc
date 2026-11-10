import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';

const cases = [
  ['H3PO4 + 3NaOH', 'H3PO4 + 3NaOH = Na3PO4 + 3H2O'],
  ['H2CO3 + 2NaOH', 'H2CO3 + 2NaOH = Na2CO3 + 2H2O'],
  ['H2SO3 + 2KOH', 'H2SO3 + 2KOH = K2SO3 + 2H2O'],
  ['CH3COOH + KOH', 'CH3COOH + KOH = CH3COOK + H2O'],
  ['HClO + NaOH', 'HClO + NaOH = NaClO + H2O'],
  ['HCOOH + NaOH', 'HCOOH + NaOH = HCOONa + H2O']
];

for (const [reactants, expected] of cases) {
  test(`Слабая кислота и сильное основание: ${reactants}`, () => {
    const result = predictReaction(reactants);
    assert.equal(result.status, 'predicted', result.message);
    assert.equal(result.ruleId, 'generic-weak-acid-base');
    const actual = parseEquation(result.formatted);
    const reference = parseEquation(expected);
    assert.deepEqual(actual.left.map((item) => [item.formula, item.coefficient]), reference.left.map((item) => [item.formula, item.coefficient]));
    assert.deepEqual(actual.right.map((item) => [item.formula, item.coefficient]), reference.right.map((item) => [item.formula, item.coefficient]));
    assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  });
}

test('при недостатке NaOH образуется дигидрофосфат натрия', () => {
  const result = predictReaction('H3PO4 + NaOH', { ratio: 'deficit' });
  assert.equal(result.status, 'predicted');
  assert.equal(result.ruleId, 'generic-acid-deficit-salt');
  assert.equal(result.formatted, 'H3PO4 + NaOH → NaH2PO4 + H2O');
});
