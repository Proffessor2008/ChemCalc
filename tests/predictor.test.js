import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { predictReaction, reactionRuleCount } from '../js/predictor.js';

const expected = [
  ['HCl + NaOH', {}, [1, 1, 1, 1], ['NaCl', 'H2O']],
  ['Zn + HCl', {}, [1, 2, 1, 1], ['ZnCl2', 'H2']],
  ['Fe + CuSO4', {}, [1, 1, 1, 1], ['FeSO4', 'Cu']],
  ['CuSO4 + NaOH', {}, [1, 2, 1, 1], ['Cu(OH)2', 'Na2SO4']],
  ['AgNO3 + NaCl', {}, [1, 1, 1, 1], ['AgCl', 'NaNO3']],
  ['Na + H2O', {}, [2, 2, 2, 1], ['NaOH', 'H2']],
  ['CH4 + O2', {}, [1, 2, 1, 2], ['CO2', 'H2O']],
  ['CaCO3', { heating: true }, [1, 1, 1], ['CaO', 'CO2']],
  ['Cu + HNO3', { acidConcentration: 'dilute' }, [3, 8, 3, 2, 4], ['Cu(NO3)2', 'NO', 'H2O']],
  ['Cu + HNO3', { acidConcentration: 'concentrated' }, [1, 4, 1, 2, 2], ['Cu(NO3)2', 'NO2', 'H2O']]
];

for (const [source, conditions, coefficients, products] of expected) {
  test(`Авто: ${source}`, () => {
    const result = predictReaction(source, conditions);
    assert.equal(result.status, 'predicted');
    assert.deepEqual(result.coefficients, coefficients);
    assert.deepEqual(result.equation.right.map((item) => item.formula), products);
    assert.equal(inspectBalance(result.equation, result.coefficients).isBalanced, true);
    assert.ok(result.why.length > 0);
    assert.ok(result.source);
    assert.ok(result.notice);
  });
}

test('Cu не вытесняет водород из HCl', () => {
  const result = predictReaction('Cu + HCl');
  assert.equal(result.status, 'no-reaction');
  assert.match(result.message, /не вытесняет/);
});

test('перманганат меняет продукты по среде', () => {
  const acid = predictReaction('KMnO4 + FeSO4', { medium: 'acidic' });
  const neutral = predictReaction('KMnO4 + FeSO4', { medium: 'neutral' });
  const alkaline = predictReaction('KMnO4 + FeSO4', { medium: 'alkaline' });
  assert.deepEqual(acid.coefficients, [2, 10, 8, 1, 2, 5, 8]);
  assert.ok(acid.equation.right.some((item) => item.formula === 'MnSO4'));
  assert.ok(neutral.equation.right.some((item) => item.formula === 'MnO2'));
  assert.ok(alkaline.equation.right.some((item) => item.formula === 'K2MnO4'));
  for (const result of [acid, neutral, alkaline]) assert.equal(inspectBalance(result.equation, result.coefficients).isBalanced, true);
});

test('не заданная концентрация HNO3 даёт два уравненных варианта', () => {
  const result = predictReaction('Cu + HNO3');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.confidence, 'low');
  assert.equal(result.variants.length, 2);
  assert.deepEqual(result.variants.map((variant) => variant.conditions.acidConcentration).sort(), ['concentrated', 'dilute']);
});

test('неизвестная пара не получает выдуманных продуктов', () => {
  const result = predictReaction('Xe + F2');
  assert.equal(result.status, 'no-rule');
  assert.equal(result.equation, undefined);
});

test('разложение CaCO3 требует нагревания', () => {
  assert.equal(predictReaction('CaCO3').status, 'needs-conditions');
});

test('общие правила: нейтрализация, горение спирта и кислота + карбонат', () => {
  assert.deepEqual(predictReaction('HNO3 + KOH').coefficients, [1, 1, 1, 1]);
  assert.deepEqual(predictReaction('C2H5OH + O2').coefficients, [1, 3, 2, 3]);
  assert.deepEqual(predictReaction('CaCO3 + HCl').coefficients, [1, 2, 1, 1, 1]);
});

test('обмен без осадка и вытеснение менее активным металлом не идут', () => {
  assert.equal(predictReaction('NaCl + KNO3').status, 'no-reaction');
  assert.equal(predictReaction('Ag + ZnSO4').status, 'no-reaction');
});

test('соотношение реагентов и электролиз меняют результат', () => {
  const deficit = predictReaction('H2SO4 + NaOH', { ratio: 'deficit' });
  assert.ok(deficit.equation.right.some((item) => item.formula === 'NaHSO4'));
  const melt = predictReaction('NaCl', { current: true, solvent: 'melt' });
  assert.deepEqual(melt.coefficients, [2, 2, 1]);
  const solution = predictReaction('NaCl', { current: true, solvent: 'aqueous' });
  assert.ok(solution.equation.left.some((item) => item.formula === 'H2O'));
});

test('полное уравнение направляется в Проверку', () => {
  assert.equal(predictReaction('HCl + NaOH = NaCl + H2O').status, 'check-required');
  assert.ok(reactionRuleCount() >= 35);
});
