import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation, parseFormula } from '../js/parser.js';
import { analyzeRedox, oxidationStates } from '../js/redox.js';

test('определяет степени окисления в типичных веществах и ионах', () => {
  const cases = [
    ['KMnO4', 'Mn', '7'],
    ['Cr2O7^2-', 'Cr', '6'],
    ['Fe2(SO4)3', 'Fe', '3'],
    ['H2O2', 'O', '-1'],
    ['C3H8', 'C', '-8/3'],
    ['Fe^2+', 'Fe', '2']
  ];
  for (const [formula, symbol, expected] of cases) {
    const result = oxidationStates(parseFormula(formula));
    assert.equal(result.complete, true, formula);
    assert.equal(result.states.get(symbol).toString(), expected, formula);
  }
});

test('распознаёт ОВР KMnO4 + HCl и электронный баланс', () => {
  const equation = parseEquation('2KMnO4 + 16HCl = 2KCl + 2MnCl2 + 5Cl2 + 8H2O');
  const result = analyzeRedox(equation);
  assert.equal(result.isRedox, true);
  assert.equal(result.complete, true);
  assert.equal(result.oxidizers[0].formula, 'KMnO4');
  assert.equal(result.reducers[0].formula, 'HCl');
  assert.equal(result.electronsLost.toString(), '10');
  assert.equal(result.electronsGained.toString(), '10');
  assert.equal(result.electronBalance, true);
  assert.ok(result.halfReactions.some((reaction) => reaction.includes('MnO₄')));
});

test('показывает полуреакции для дихроматного уравнения', () => {
  const equation = parseEquation('Cr2O7^2- + 6Fe^2+ + 14H+ = 2Cr^3+ + 6Fe^3+ + 7H2O');
  const result = analyzeRedox(equation);
  assert.equal(result.isRedox, true);
  assert.equal(result.electronBalance, true);
  assert.equal(result.electronsLost.toString(), '6');
  assert.ok(result.halfReactions.some((reaction) => reaction.includes('Cr₂O₇')));
  assert.ok(result.halfReactions.some((reaction) => reaction.includes('Fe²⁺')));
});

test('не помечает нейтрализацию как ОВР', () => {
  const equation = parseEquation('HCl + NaOH = NaCl + H2O');
  const result = analyzeRedox(equation);
  assert.equal(result.isRedox, false);
});
