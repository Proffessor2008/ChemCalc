import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { equationToLatex, speciesToLatex } from '../js/export.js';
import { parseSpecies } from '../js/parser.js';
import { calculateStoichiometry } from '../js/stoichiometry.js';
import { buildPracticalLines, buildStoichiometryTable } from '../js/stoichiometry-ui.js';
import { t } from '../js/i18n.js';

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

test('все новые подписи переведены', () => {
  for (const key of ['stoichBasisLimiting', 'stoichBasisSingleAvailable', 'limitingReactant', 'practicalProductsTitle', 'practicalLine', 'practicalLineGas', 'gasConditionsShortNormal', 'gasConditionsShortSatp']) {
    assert.notEqual(t(key), key, `нет перевода для ${key}`);
  }
});

test('таблица и сводка показывают практический объём газа', () => {
  const result = calculateStoichiometry('3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O', {
    known: { index: 0, kind: 'mass', value: 19.2 },
    availableReactants: { 0: 0.3, 1: 0.8 },
    gasConditions: 'satp',
    yieldPercent: 80,
    yieldProductIndex: 3
  });
  const table = buildStoichiometryTable(result);
  assert.match(table, /V практ\., л/);
  assert.match(table, /<td>0\.16<\/td>/);
  assert.match(table, /<td>4\.80096<\/td>/);
  assert.match(table, /<td>3\.92<\/td>/);
  const lines = buildPracticalLines(result);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].isGas, true);
  assert.match(lines[0].text, /NO: n = 0\.16 моль; m = 4\.80096 г; V = 3\.92 л \(САТП\)/);
});

test('без газообразного продукта колонка V практ. не выводится', () => {
  const result = calculateStoichiometry('HCl + NaOH = NaCl + H2O', {
    known: { index: 0, kind: 'amount', value: 0.2 },
    yieldPercent: 80,
    yieldProductIndex: 2
  });
  assert.doesNotMatch(buildStoichiometryTable(result), /V практ/);
  const lines = buildPracticalLines(result);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].isGas, false);
  assert.doesNotMatch(lines[0].text, /V =/);
});

test('кнопки экспорта PDF/DOCX заменили печать во всех разделах', () => {
  const html = readFileSync('index.html', 'utf8');
  for (const id of ['check-export-pdf', 'check-export-docx', 'auto-export-pdf', 'auto-export-docx', 'stoich-export-pdf', 'stoich-export-docx', 'reference-export-pdf', 'reference-export-docx']) {
    assert.ok(html.includes(`id="${id}"`), `нет кнопки ${id}`);
  }
  for (const id of ['check-print', 'auto-print', 'reference-print']) assert.ok(!html.includes(`id="${id}"`));
  assert.ok(!html.includes('id="print-solution"'));
  const docx = readFileSync('js/report-docx.js', 'utf8');
  assert.ok(docx.includes('w:tblHeader'));
  assert.ok(docx.includes('w:pgSz'));
  assert.ok(docx.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  const pdf = readFileSync('js/report-pdf.js', 'utf8');
  assert.ok(pdf.includes('foreignObject'));
  assert.ok(pdf.includes("toDataURL('image/jpeg'"));
  assert.ok(pdf.includes('buildPdfDocument'));
  assert.ok(pdf.includes("orientation === 'landscape'"));
  const ui = readFileSync('js/ui.js', 'utf8');
  assert.ok(ui.includes('exportCheckReport'));
  assert.ok(!ui.includes('printSolution'));
  const auto = readFileSync('js/auto-ui.js', 'utf8');
  assert.ok(auto.includes('exportAutoReport') && !auto.includes('printSolution'));
  const reference = readFileSync('js/reference-ui.js', 'utf8');
  assert.ok(reference.includes('exportReference') && !reference.includes('window.print'));
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
  assert.ok(stoich.includes('const showActual'));
  assert.ok(stoich.includes("t('actualMolesShort')") && stoich.includes("t('actualGasVolumeShort')"));
  assert.ok(stoich.includes('previousSubstance') && stoich.includes('previousYieldProduct'));
});

test('интерфейс показывает практический объём газа и объясняет лимитирующий реагент', () => {
  const html = readFileSync('index.html', 'utf8');
  const stoich = readFileSync('js/stoichiometry-ui.js', 'utf8');
  const css = readFileSync('styles.css', 'utf8');
  assert.ok(html.includes('id="stoich-basis-note"'));
  assert.ok(html.includes('id="stoich-practical"'));
  assert.ok(stoich.includes('hasGasProduct') && stoich.includes("t('practicalProductsTitle')"));
  assert.ok(stoich.includes("t('practicalLineGas'"));
  assert.ok(stoich.includes("t('practicalLine'"));
  assert.ok(stoich.includes('basisSource'));
  assert.ok(stoich.includes('class="chem"'));
  assert.ok(stoich.includes('preserveAvailable') && stoich.includes('populate(true)'));
  assert.ok(stoich.includes('function invalidateResult'));
  assert.ok(stoich.includes("addEventListener('input', invalidateResult)"));
  assert.ok(css.includes('.chem { text-transform: none !important; }'));
  assert.doesNotMatch(css, /thead th \{[^}]*text-transform:\s*uppercase/);
  const reference = readFileSync('js/reference-ui.js', 'utf8');
  assert.ok(reference.includes('scope="col" class="chem"'));
  assert.ok(reference.includes('scope="row" class="chem"'));
});
