import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENTS,
  FormulaSyntaxError,
  atomCountsToObject,
  equationToUnicode,
  parseEquation,
  parseFormula,
  parseSide
} from '../js/parser.js';

test('база содержит все 118 элементов', () => {
  assert.equal(ELEMENTS.length, 118);
  assert.equal(new Set(ELEMENTS.map((element) => element.symbol)).size, 118);
  for (const element of ELEMENTS) assert.equal(parseFormula(element.symbol).atoms.get(element.symbol), 1);
});

test('разбирает вложенные скобки и индексы', () => {
  assert.deepEqual(atomCountsToObject(parseFormula('Al2(SO4)3').atoms), { Al: 2, S: 3, O: 12 });
  assert.deepEqual(atomCountsToObject(parseFormula('Ca3(PO4)2').atoms), { Ca: 3, P: 2, O: 8 });
  assert.deepEqual(atomCountsToObject(parseFormula('K4[Fe(CN)6]').atoms), { K: 4, Fe: 1, C: 6, N: 6 });
});

test('учитывает множители кристаллогидрата', () => {
  for (const separator of ['·', '*', '.']) {
    const species = parseFormula(`CuSO4${separator}5H2O`);
    assert.deepEqual(atomCountsToObject(species.atoms), { Cu: 1, S: 1, O: 9, H: 10 });
  }
});

test('разбирает заряды, электрон и состояние', () => {
  assert.equal(parseFormula('Fe^3+').charge, 3);
  assert.equal(parseFormula('Fe³⁺').charge, 3);
  assert.equal(parseFormula('SO4^2-').charge, -2);
  assert.equal(parseFormula('MnO4-').charge, -1);
  assert.equal(parseFormula('e-').charge, -1);
  assert.equal(parseFormula('e-').isElectron, true);
  const solid = parseFormula('AgCl(s)↓');
  assert.equal(solid.state, 's');
  assert.equal(solid.annotation, '↓');
});

test('разбирает коэффициенты и разные стрелки', () => {
  for (const separator of ['=', '->', '→', '⇄']) {
    const equation = parseEquation(`2H₂ + O₂ ${separator} 2H₂O`);
    assert.deepEqual([...equation.left, ...equation.right].map((species) => species.coefficient), [2, 1, 2]);
  }
});

test('не путает заряды со знаками-соединителями', () => {
  const side = parseSide('Cr2O7^2- + 6Fe^2+ + 14H+');
  assert.equal(side.length, 3);
  assert.deepEqual(side.map((species) => species.charge), [-2, 2, 1]);
  assert.deepEqual(side.map((species) => species.coefficient), [1, 6, 14]);
  assert.equal(parseSide('H2+O2').length, 2);
  assert.equal(parseSide('H+ + OH-').length, 2);
});

test('сообщает о неизвестном элементе и непарной скобке', () => {
  assert.throws(() => parseFormula('H2XxO'), (error) => error instanceof FormulaSyntaxError && error.code === 'unknown-element' && /Xx/.test(error.message));
  assert.throws(() => parseFormula('Al2(SO4'), /скобк/i);
  assert.throws(() => parseFormula('h2O'), /заглавной/i);
  assert.throws(() => parseEquation('H2 + O2'), /разделитель/i);
});

test('отображает Unicode-индексы и заряды', () => {
  const equation = parseEquation('2H2 + O2 = 2H2O');
  assert.equal(equationToUnicode(equation), '2H₂ + O₂ → 2H₂O');
  assert.equal(equationToUnicode(parseEquation('Fe^3+ = Fe^2+')), 'Fe³⁺ → Fe²⁺');
});
