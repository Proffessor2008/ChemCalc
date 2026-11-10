import test from 'node:test';
import assert from 'node:assert/strict';
import { Fraction, balanceEquation, inspectBalance } from '../js/balancer.js';

const cases = [
  ['Fe + O2 -> Fe2O3', [4, 3, 2]],
  ['C3H8 + O2 -> CO2 + H2O', [1, 5, 3, 4]],
  ['Al + H2SO4 -> Al2(SO4)3 + H2', [2, 3, 1, 3]],
  ['KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O', [2, 16, 2, 2, 5, 8]],
  ['Cr2O7^2- + Fe^2+ + H+ -> Cr^3+ + Fe^3+ + H2O', [1, 6, 14, 2, 6, 7]],
  ['Ca3(PO4)2 + SiO2 + C -> CaSiO3 + P4 + CO', [2, 6, 10, 6, 1, 10]],
  ['KMnO4 + FeSO4 + H2SO4 -> K2SO4 + MnSO4 + Fe2(SO4)3 + H2O', [2, 10, 8, 1, 2, 5, 8]]
];

for (const [equation, expected] of cases) {
  test(`точное уравнивание: ${equation}`, () => {
    const result = balanceEquation(equation);
    assert.equal(result.status, 'balanced');
    assert.deepEqual(result.coefficients, expected);
    const inspection = inspectBalance(result.equation, result.coefficients);
    assert.equal(inspection.isBalanced, true);
    assert.equal(inspection.mass.balanced, true);
    assert.equal(inspection.isMinimal, true);
  });
}

test('рациональная арифметика не теряет точность', () => {
  const third = new Fraction(1, 3);
  assert.equal(third.add(new Fraction(2, 3)).toString(), '1');
  assert.equal(third.mul(9).div(2).toString(), '3/2');
  assert.equal(new Fraction(6, -8).toString(), '-3/4');
});

test('обнаруживает недоопределённую систему', () => {
  const result = balanceEquation('C + O2 -> CO + CO2');
  assert.equal(result.status, 'underdetermined');
  assert.ok(result.nullity > 1);
});

test('отклоняет набор без положительного решения', () => {
  const result = balanceEquation('H2 + O2 -> H2O + CO2');
  assert.equal(result.status, 'no-positive-solution');
});

test('проверяет заряд и общий делитель коэффициентов', () => {
  const result = inspectBalance('2Cr2O7^2- + 12Fe^2+ + 28H+ = 4Cr^3+ + 12Fe^3+ + 14H2O');
  assert.equal(result.isBalanced, true);
  assert.equal(result.charge.balanced, true);
  assert.equal(result.coefficientGcd, 2);
  assert.equal(result.isMinimal, false);
});
