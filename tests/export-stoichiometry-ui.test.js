import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { equationToLatex, speciesToLatex } from '../js/export.js';
import { parseSpecies } from '../js/parser.js';
import { calculateStoichiometry } from '../js/stoichiometry.js';

test('LaTeX экспортирует коэффициенты, индексы и газовую стрелку', () => {
  const result = equationToLatex('2KMnO4 + 16HCl = 2KCl + 2MnCl2 + 5Cl2↑ + 8H2O');
  assert.equal(result, '2\\mathrm{KMnO_{4}} + 16\\mathrm{HCl} \\rightarrow 2\\mathrm{KCl} + 2\\mathrm{MnCl_{2}} + 5\\mathrm{Cl_{2}}\\uparrow + 8\\mathrm{H_{2}O}');
});

test('LaTeX сохраняет заряды и электрон', () => {
  const result = equationToLatex('Cr2O7^2- + 6Fe^2+ + 14H^+ = 2Cr^3+ + 6Fe^3+ + 7H2O');
  assert.ok(result.includes('\\mathrm{Cr_{2}O_{7}^{2-}}'));
  assert.ok(result.includes('14\\mathrm{H^{+}}'));
  assert.ok(result.includes('6\\mathrm{Fe^{2+}}'));
  assert.equal(speciesToLatex(parseSpecies('e^-')), 'e^{-}');
});

test('LaTeX не превращает множитель кристаллогидрата в индекс', () => {
  const result = equationToLatex('CuSO4·5H2O = CuSO4 + 5H2O');
  assert.ok(result.includes('\\mathrm{CuSO_{4}\\cdot 5H_{2}O}'));
});

test('обратимая реакция экспортируется через rightleftharpoons', () => {
  const result = equationToLatex('CH3COOC2H5 + H2O ⇄ CH3COOH + C2H5OH');
  assert.ok(result.includes('\\rightleftharpoons'));
  assert.ok(result.includes('\\mathrm{CH_{3}COOC_{2}H_{5}}'));
});

test('практический выход применяется только к выбранному продукту', () => {
  const options = { known: { index: 0, kind: 'amount', value: 1 }, yieldPercent: 80, yieldProductIndex: 3 };
  const result = calculateStoichiometry('CO2 + 2NaOH = Na2CO3 + H2O', options);
  assert.equal(result.status, 'ok');
  assert.equal(result.rows[2].actualMassG, null);
  assert.equal(result.rows[3].actualMoles, 0.8);
  const allProducts = calculateStoichiometry('CO2 + 2NaOH = Na2CO3 + H2O', { known: options.known, yieldPercent: 80 });
  assert.equal(allProducts.rows[2].actualMoles, 0.8);
  assert.equal(allProducts.rows[3].actualMoles, 0.8);
});

test('выход нельзя применить к реагенту', () => {
  assert.throws(
    () => calculateStoichiometry('CO2 + 2NaOH = Na2CO3 + H2O', { known: { index: 0, kind: 'amount', value: 1 }, yieldProductIndex: 0 }),
    /правой части/
  );
});

test('интерфейс содержит выбор продукта и обе LaTeX-кнопки', () => {
  const html = readFileSync('index.html', 'utf8');
  const auto = readFileSync('js/auto-ui.js', 'utf8');
  const check = readFileSync('js/ui.js', 'utf8');
  const stoich = readFileSync('js/stoichiometry-ui.js', 'utf8');
  assert.ok(html.includes('id="auto-latex"') && html.includes('id="latex-button"'));
  assert.ok(html.includes('id="stoich-yield-product"'));
  assert.ok(auto.includes('equationToLatex(currentEquation)'));
  assert.ok(check.includes('equationToLatex(state.result.equation)'));
  assert.ok(stoich.includes('yieldProductIndex'));
  assert.ok(stoich.includes('previousSubstance') && stoich.includes('previousYieldProduct'));
});
