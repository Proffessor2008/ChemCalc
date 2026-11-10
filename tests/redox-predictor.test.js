import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation, parseSide, parseSpecies } from '../js/parser.js';
import { predictIonicRedox } from '../js/redox-predictor.js';
import { predictReaction } from '../js/predictor.js';

function resultEquation(result) {
  return {
    left: result.left.map((item) => ({ ...parseSpecies(item.formula), coefficient: item.coefficient })),
    right: result.right.map((item) => ({ ...parseSpecies(item.formula), coefficient: item.coefficient })),
    separator: '→'
  };
}

function sideMap(equation, side) {
  return Object.fromEntries(equation[side].map((item) => [item.formula, item.coefficient]));
}

function assertReaction(source, medium, expected) {
  const result = predictIonicRedox(parseSide(source), { medium, solvent: 'aqueous' });
  assert.equal(result.status, 'predicted', source);
  const actual = resultEquation(result);
  const reference = parseEquation(expected);
  assert.deepEqual(sideMap(actual, 'left'), sideMap(reference, 'left'));
  assert.deepEqual(sideMap(actual, 'right'), sideMap(reference, 'right'));
  assert.ok(inspectBalance(actual).isBalanced);
  assert.ok(result.E0_V > 0);
  assert.equal(result.halfReactions.length, 2);
  assert.ok(result.halfReactions.every((reaction) => reaction.includes('e⁻')));
  return result;
}

test('кислая среда: перманганат и Fe2+ по полуреакциям', () => {
  assertReaction('MnO4^- + Fe^2+ + H^+', 'acidic', 'MnO4^- + 5Fe^2+ + 8H^+ = Mn^2+ + 5Fe^3+ + 4H2O');
});

test('кислая среда: дихромат и Fe2+', () => {
  assertReaction('Cr2O7^2- + Fe^2+ + H^+', 'acidic', 'Cr2O7^2- + 6Fe^2+ + 14H^+ = 2Cr^3+ + 6Fe^3+ + 7H2O');
});

test('нейтральная среда: перманганат восстанавливается до MnO2', () => {
  assertReaction('MnO4^- + I^-', 'neutral', '2MnO4^- + 6I^- + 4H2O = 2MnO2 + 3I2 + 8OH^-');
});

test('щелочная среда: перманганат восстанавливается до манганата', () => {
  assertReaction('MnO4^- + I^-', 'alkaline', '2MnO4^- + 2I^- = 2MnO4^2- + I2');
});

test('галоген вытесняет менее активный галоген', () => {
  assertReaction('Cl2 + I^-', 'neutral', 'Cl2 + 2I^- = 2Cl^- + I2');
});

test('активный металл реагирует с водой в нейтральной среде', () => {
  assertReaction('Na + H2O', 'neutral', '2Na + 2H2O = 2Na^+ + 2OH^- + H2');
});

test('положительная ЭДС не выдаётся для Cu + H+', () => {
  const result = predictIonicRedox(parseSide('Cu + H^+'), { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(result.status, 'no-reaction');
  assert.ok(result.E0_V < 0);
});

test('неизвестная пара и лишний ион не обрабатываются молча', () => {
  assert.equal(predictIonicRedox(parseSide('CH4 + O2'), { medium: 'neutral', solvent: 'aqueous' }), null);
  assert.equal(predictIonicRedox(parseSide('MnO4^- + Fe^2+ + K^+'), { medium: 'acidic', solvent: 'aqueous' }), null);
});

test('режим Авто использует движок и возвращает объяснение с ЭДС', () => {
  const result = predictReaction('MnO4^- + Fe^2+ + H^+', { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(result.status, 'predicted', result.message);
  assert.equal(result.ruleId, 'ionic-redox-half-reactions');
  assert.ok(result.E0_V > 0);
  assert.equal(result.halfReactions.length, 2);
  assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  assert.ok(result.why.some((line) => line.includes('Восстановление')));
});

test('режим Авто сообщает о неположительной ЭДС', () => {
  const result = predictReaction('Cu + H^+', { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(result.status, 'no-reaction');
  assert.match(result.message, /E°.*≤ 0/);
});
