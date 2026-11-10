import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';

const cases = [
  { id: '4.1', input: 'Fe + HNO3', heating: false, status: 'no-reaction' },
  { id: '4.2', input: 'Fe + HNO3', heating: true, expected: 'Fe + 6HNO3 = Fe(NO3)3 + 3NO2 + 3H2O' },
  { id: '4.3', input: 'Al + H2SO4', heating: false, status: 'no-reaction' },
  { id: '4.4', input: 'Al + H2SO4', heating: true, expected: '2Al + 6H2SO4 = Al2(SO4)3 + 3SO2 + 6H2O' },
  { id: '4.5', input: 'Cr + HNO3', heating: false, status: 'no-reaction' },
  { id: '4.6', input: 'Cr + HNO3', heating: true, expected: 'Cr + 6HNO3 = Cr(NO3)3 + 3NO2 + 3H2O' },
  { id: '4.7', input: 'Fe + H2SO4', heating: false, status: 'no-reaction' },
  { id: '4.8', input: 'Fe + H2SO4', heating: true, expected: '2Fe + 6H2SO4 = Fe2(SO4)3 + 3SO2 + 6H2O' }
];

function maps(equation) {
  return {
    left: Object.fromEntries(equation.left.map((item) => [item.formula, item.coefficient])),
    right: Object.fromEntries(equation.right.map((item) => [item.formula, item.coefficient]))
  };
}

for (const item of cases) {
  test(`Пассивация ${item.id}: ${item.input}, нагрев ${item.heating}`, () => {
    const result = predictReaction(item.input, { medium: 'acidic', acidConcentration: 'concentrated', heating: item.heating });
    if (!item.heating) {
      assert.equal(result.status, 'no-reaction');
      assert.match(result.message, /пассивац/i);
    } else {
      assert.equal(result.status, 'predicted');
      assert.deepEqual(maps(parseEquation(result.formatted)), maps(parseEquation(item.expected)));
    }
  });
}
