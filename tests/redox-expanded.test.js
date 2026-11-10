import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { parseEquation, parseSide, parseSpecies } from '../js/parser.js';
import { predictIonicRedox } from '../js/redox-predictor.js';
import { predictReaction } from '../js/predictor.js';

function equationOf(result) {
  return {
    left: result.left.map((item) => ({ ...parseSpecies(item.formula), coefficient: item.coefficient })),
    right: result.right.map((item) => ({ ...parseSpecies(item.formula), coefficient: item.coefficient })),
    separator: '→'
  };
}

function sideMap(equation, side) {
  return Object.fromEntries(equation[side].map((item) => [item.formula, item.coefficient]));
}

function assertReaction(source, conditions, expected) {
  const result = predictIonicRedox(parseSide(source), { solvent: 'aqueous', ...conditions });
  assert.equal(result.status, 'predicted', `${source}: ${result.message || result.status}`);
  const actual = equationOf(result);
  const reference = parseEquation(expected);
  assert.deepEqual(sideMap(actual, 'left'), sideMap(reference, 'left'));
  assert.deepEqual(sideMap(actual, 'right'), sideMap(reference, 'right'));
  assert.ok(inspectBalance(actual).isBalanced);
  assert.equal(inspectBalance(actual).coefficientGcd, 1);
  return result;
}

test('нитрат в разбавленной кислоте восстанавливается до NO', () => {
  const result = assertReaction('NO3^- + Cu + H^+', { medium: 'acidic', acidConcentration: 'dilute' }, '2NO3^- + 3Cu + 8H^+ = 2NO + 3Cu^2+ + 4H2O');
  assert.ok(Math.abs(result.E0_V - 0.623) < 1e-9);
});

test('нитрат требует концентрацию кислоты', () => {
  const result = predictIonicRedox(parseSide('NO3^- + Cu + H^+'), { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(result.status, 'needs-conditions');
});

test('MnO2 окисляет иодид в кислой среде', () => {
  assertReaction('MnO2 + I^- + H^+', { medium: 'acidic' }, 'MnO2 + 2I^- + 4H^+ = Mn^2+ + I2 + 2H2O');
});

test('пероксид окисляет иодид', () => {
  assertReaction('H2O2 + I^- + H^+', { medium: 'acidic' }, 'H2O2 + 2I^- + 2H^+ = 2H2O + I2');
});

test('пероксид диспропорционирует сам', () => {
  assertReaction('H2O2', { medium: 'acidic' }, '2H2O2 = 2H2O + O2');
});

test('хлор в холодной щёлочи диспропорционирует', () => {
  assertReaction('Cl2 + 2OH^-', { medium: 'alkaline' }, 'Cl2 + 2OH^- = Cl^- + ClO^- + H2O');
});

test('сульфат в концентрированной кислоте окисляет цинк', () => {
  assertReaction('SO4^2- + Zn + H^+', { medium: 'acidic', acidConcentration: 'concentrated' }, 'SO4^2- + Zn + 4H^+ = SO2 + Zn^2+ + 2H2O');
});

test('сульфит окисляется перманганатом в щёлочи', () => {
  assertReaction('MnO4^- + SO3^2- + OH^-', { medium: 'alkaline' }, '2MnO4^- + SO3^2- + 2OH^- = 2MnO4^2- + SO4^2- + H2O');
});

test('сероводород окисляется дихроматом до серы', () => {
  assertReaction('Cr2O7^2- + H2S + H^+', { medium: 'acidic' }, 'Cr2O7^2- + 3H2S + 8H^+ = 2Cr^3+ + 3S + 7H2O');
});

test('Нернст вычисляет Q и изменяет ЭДС', () => {
  const result = assertReaction('MnO4^- + Fe^2+ + H^+', {
    medium: 'acidic',
    activities: { 'MnO4^-': 0.01, 'Mn^2+': 0.001, 'Fe^2+': 0.1, 'Fe^3+': 0.01 }
  }, 'MnO4^- + 5Fe^2+ + 8H^+ = Mn^2+ + 5Fe^3+ + 4H2O');
  assert.equal(result.quotient, 0.000001);
  assert.ok(result.E_V > result.E0_V);
  assert.ok(Math.abs(result.E_V - 0.810) < 0.001);
});

test('активности могут изменить знак ЭДС и разрешить реакцию', () => {
  const standard = predictIonicRedox(parseSide('Cu + H^+'), { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(standard.status, 'no-reaction');
  const result = predictIonicRedox(parseSide('Cu + H^+'), {
    medium: 'acidic', solvent: 'aqueous', activities: { 'Cu^2+': 1, H2: 0.000000001, 'H^+': 100 }
  });
  assert.equal(result.status, 'predicted');
  assert.ok(result.E_V > 0);
});

test('режим Авто показывает объяснение по Нернсту', () => {
  const result = predictReaction('MnO4^- + Fe^2+ + H^+', {
    medium: 'acidic', solvent: 'aqueous', activities: { 'MnO4^-': 0.01, 'Mn^2+': 0.001, 'Fe^2+': 0.1, 'Fe^3+': 0.01 }
  });
  assert.equal(result.status, 'predicted', result.message);
  assert.ok(result.why.some((line) => line.includes('Нернста')));
});

test('некорректная активность не приводит к расчёту', () => {
  const result = predictIonicRedox(parseSide('Fe^3+ + I^-'), { medium: 'acidic', solvent: 'aqueous', activities: { 'Fe^3+': -1 } });
  assert.equal(result.status, 'needs-conditions');
  assert.match(result.message, /положительным числом/);
});
