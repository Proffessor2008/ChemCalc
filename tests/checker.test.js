import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEquation, getHint, revealAnswer } from '../js/checker.js';

test('находит несоответствие кислорода в Fe + O2', () => {
  const result = checkEquation('2Fe + 2O2 = Fe2O3');
  assert.equal(result.status, 'not-balanced');
  assert.deepEqual(result.balance.atomRows.find((row) => row.symbol === 'O'), { symbol: 'O', left: 4, right: 3, balanced: false });
});

test('2H2 + 2O2 = 2H2O не считается верным', () => {
  const result = checkEquation('2H2 + 2O2 = 2H2O');
  assert.equal(result.status, 'not-balanced');
  assert.equal(result.balance.atomRows.find((row) => row.symbol === 'O').left, 4);
  assert.equal(result.balance.atomRows.find((row) => row.symbol === 'O').right, 2);
});

test('находит общий делитель у верного баланса', () => {
  const result = checkEquation('4H2 + 2O2 = 4H2O');
  assert.equal(result.status, 'nonminimal');
  assert.equal(result.balance.coefficientGcd, 2);
});

test('предупреждает, что Cu не вытесняет водород из HCl', () => {
  for (const equation of ['Cu + HCl = CuCl2 + H2', 'Cu + 2HCl = CuCl2 + H2']) {
    const result = checkEquation(equation);
    assert.equal(result.status, 'product-warning');
    assert.match(result.message, /не вытесняет/);
  }
});

test('принимает уравнённую реакцию натрия с водой', () => {
  const result = checkEquation('2Na + 2H2O = 2NaOH + H2');
  assert.equal(result.status, 'correct');
  assert.equal(result.balance.isBalanced, true);
});

test('неизвестный элемент возвращает понятную ошибку', () => {
  const result = checkEquation('Xx + O2 = XxO');
  assert.equal(result.status, 'syntax-error');
  assert.match(result.message, /Неизвестный символ Xx/);
});

test('неизвестное вещество не проходит химическую проверку молча', () => {
  const result = checkEquation('Xe + F2 = XeF2');
  assert.equal(result.status, 'partial');
  assert.equal(result.balance.isBalanced, true);
  assert.ok(result.unknownSubstances.length > 0);
});

test('подсказки и полное решение выдаются отдельными вызовами', () => {
  const result = checkEquation('Fe + O2 = Fe2O3');
  assert.match(getHint(result, 1), /O/);
  const answer = revealAnswer(result);
  assert.deepEqual(answer.coefficients, [4, 3, 2]);
  assert.equal(answer.steps.length, 4);
});
