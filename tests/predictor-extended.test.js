import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';
import { correctedEquations, invalidExpectedIds, reactionCases } from './reaction-cases.js';

function sideMap(equation, side) {
  return Object.fromEntries(equation[side].map((species) => [species.formula, species.coefficient]));
}

function assertSameEquation(actual, expected) {
  const left = parseEquation(actual);
  const right = parseEquation(expected);
  assert.deepEqual(sideMap(left, 'left'), sideMap(right, 'left'), 'левая часть');
  assert.deepEqual(sideMap(left, 'right'), sideMap(right, 'right'), 'правая часть');
}

for (const testCase of reactionCases) {
  test(`Расширенный Авто: ${testCase.id}`, () => {
    const result = predictReaction(testCase.input, testCase.conditions);
    if (!testCase.expected) {
      assert.equal(result.status, 'no-reaction');
      return;
    }
    const expectedBalance = inspectBalance(testCase.expected);
    if (invalidExpectedIds.includes(testCase.id)) {
      assert.equal(expectedBalance.isBalanced, false, 'исходный ожидаемый ответ должен быть признан несбалансированным');
      assert.equal(result.status, 'no-rule');
      return;
    }
    const corrected = correctedEquations[testCase.id];
    if (corrected) assert.equal(expectedBalance.isBalanced, false, 'исходная схема содержит исправляемую ошибку');
    assert.equal(result.status, 'predicted', result.message);
    assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
    assert.ok(result.why.length > 0);
    assertSameEquation(result.formatted, corrected || testCase.expected);
  });
}

test('проверочный пакет содержит 35 разных сценариев', () => {
  assert.equal(reactionCases.length, 35);
  assert.equal(new Set(reactionCases.map((item) => item.id)).size, 35);
});
