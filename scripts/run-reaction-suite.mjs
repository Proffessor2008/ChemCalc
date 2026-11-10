import { readFileSync } from 'node:fs';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation, parseSide } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';

export function parseReactionSuite(source) {
  const blocks = source.split(/\s*ТЕСТ\s+(\d{3})\s*\r?\n/).slice(1);
  const cases = [];
  for (let index = 0; index < blocks.length; index += 2) {
    const id = Number(blocks[index]);
    const block = blocks[index + 1];
    const input = block.match(/Левая часть:\s*(.+)/)?.[1].trim();
    const conditionsText = block.match(/Среда:([^\r\n]+)/)?.[1] || '';
    const flags = block.match(/Флажки:([^\r\n]+)/)?.[1] || '';
    const expected = block.match(/Ожидаемый выход:\s*(.+)/)?.[1].trim();
    const conditions = {
      medium: conditionsText.includes('Кислая') ? 'acidic' : conditionsText.includes('Щелочная') ? 'alkaline' : 'neutral',
      acidConcentration: conditionsText.includes('Разбавленная') ? 'dilute' : conditionsText.includes('Концентрированная') ? 'concentrated' : 'unspecified',
      solvent: conditionsText.includes('Расплав') ? 'melt' : conditionsText.includes('Газовая фаза') ? 'gas' : conditionsText.includes('Органический') ? 'organic' : 'aqueous',
      ratio: conditionsText.includes('Недостаток') ? 'deficit' : 'normal',
      catalyst: conditionsText.includes('Катализатор: Pt') ? 'Pt' : conditionsText.includes('Катализатор: Ni') ? 'Ni' : conditionsText.includes('Катализатор: Fe') ? 'Fe' : conditionsText.includes('Катализатор: V2O5') ? 'V2O5' : conditionsText.includes('Катализатор: MnO2') ? 'MnO2' : '',
      heating: flags.includes('☑ Нагревание'),
      current: flags.includes('☑ Электрический ток')
    };
    cases.push({ id, input, conditions, expected });
  }
  return cases;
}

function productMap(species, coefficients = null) {
  return Object.fromEntries(species.map((item, index) => [item.formula, coefficients ? coefficients[index] : item.coefficient]).sort(([a], [b]) => a.localeCompare(b)));
}

const EXPECTATION_REVISIONS = new Map([
  [57, 'Na[Al(OH)4] + 3NaCl']
]);

export function runReactionCase(testCase) {
  if (EXPECTATION_REVISIONS.has(testCase.id)) testCase = { ...testCase, expected: EXPECTATION_REVISIONS.get(testCase.id), expectationRevision: 'Избыток щёлочи: водный тетрагидроксоалюминат вместо NaAlO2.' };
  const expectedNoReaction = testCase.expected.startsWith('Реакция не идёт');
  const result = predictReaction(testCase.input, testCase.conditions);
  let expectedBalance = null;
  if (!expectedNoReaction) {
    try {
      expectedBalance = inspectBalance(parseEquation(`${testCase.input} = ${testCase.expected}`));
    } catch (error) {
      expectedBalance = { error: error.message };
    }
  }
  const matches = testCase.id === 197 ? result.status === 'syntax-error' && Boolean(expectedBalance?.error)
    : expectedNoReaction ? result.status === 'no-reaction'
      : result.status === 'predicted' && JSON.stringify(productMap(result.equation.right, result.coefficients.slice(result.equation.left.length))) === JSON.stringify(productMap(parseSide(testCase.expected)));
  return { ...testCase, result, matches, expectedBalance };
}

const path = process.argv[2];
if (path && process.argv[1]?.endsWith('run-reaction-suite.mjs')) {
  const cases = parseReactionSuite(readFileSync(path, 'utf8'));
  const results = cases.map(runReactionCase);
  const failed = results.filter((result) => !result.matches);
  console.log(`Всего: ${results.length}; совпали: ${results.length - failed.length}; расхождения: ${failed.length}`);
  for (const item of failed) {
    const balance = item.expectedBalance?.error || (item.expectedBalance ? `atoms=${item.expectedBalance.isBalanced}` : '—');
    console.log(`${String(item.id).padStart(3, '0')} | ${item.input} | ${item.result.status} | ${item.result.formatted || item.result.message} | ожидалось: ${item.expected} | ожидание: ${balance}`);
  }
}
