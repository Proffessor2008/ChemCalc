import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations, ionicForUnbalanced } from '../js/ionic.js';

test('нейтрализация: полное и краткое ионные уравнения', () => {
  const result = ionicForUnbalanced('HCl + NaOH = NaCl + H2O');
  assert.equal(result.status, 'ok');
  assert.equal(result.netUnicode, 'H⁺ + OH⁻ → H₂O');
  assert.equal(result.spectators.length, 2);
  assert.equal(inspectBalance(result.netEquation).isBalanced, true);
});

test('AgCl не диссоциирует в ионном уравнении', () => {
  const result = ionicForUnbalanced('AgNO3 + NaCl = AgCl↓ + NaNO3');
  assert.equal(result.netUnicode, 'Ag⁺ + Cl⁻ → AgCl↓');
  assert.ok(result.fullUnicode.includes('Ag⁺ + NO₃⁻ + Na⁺ + Cl⁻'));
});

test('учитываются коэффициенты и заряд сульфата', () => {
  const result = ionicForUnbalanced('CuSO4 + NaOH = Cu(OH)2↓ + Na2SO4');
  assert.equal(result.netUnicode, 'Cu²⁺ + 2OH⁻ → Cu(OH)₂↓');
  assert.equal(result.netBalance, undefined);
  assert.equal(inspectBalance(result.netEquation).charge.left, 0);
  assert.equal(inspectBalance(result.netEquation).charge.right, 0);
});

test('если все ионы являются наблюдателями, суммарной реакции нет', () => {
  const result = ionicForUnbalanced('NaCl + KNO3 = NaNO3 + KCl');
  assert.equal(result.status, 'no-net-reaction');
  assert.equal(result.netUnicode, '');
});

test('не уравненное уравнение не выдаётся за ионный результат', () => {
  const result = buildIonicEquations('2H2 + 2O2 = 2H2O');
  assert.equal(result.status, 'unbalanced');
});
