import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations } from '../js/ionic.js';

test('готовая ионная ОВР не требует молекулярных электролитов', () => {
  const source = 'MnO4^- + 5Fe^2+ + 8H^+ = Mn^2+ + 5Fe^3+ + 4H2O';
  const result = buildIonicEquations(source);
  assert.equal(result.status, 'ok', result.message);
  assert.equal(result.netUnicode, 'MnO₄⁻ + 5Fe²⁺ + 8H⁺ → Mn²⁺ + 5Fe³⁺ + 4H₂O');
  assert.equal(result.fullUnicode, result.netUnicode);
  assert.deepEqual(result.spectators, []);
  assert.ok(result.notes.some((note) => note.includes('уже записано в ионной форме')));
  assert.ok(inspectBalance(result.netEquation).isBalanced);
});

test('полуреакция с электронами также считается ионной формой', () => {
  const result = buildIonicEquations('MnO4^- + 8H^+ + 5e^- = Mn^2+ + 4H2O');
  assert.equal(result.status, 'ok', result.message);
  assert.equal(result.netUnicode, 'MnO₄⁻ + 8H⁺ + 5e⁻ → Mn²⁺ + 4H₂O');
});

test('уравнение без заряженных частиц и электролитов остаётся неприменимым', () => {
  const result = buildIonicEquations('CH4 + 2O2 = CO2 + 2H2O');
  assert.equal(result.status, 'unavailable');
});
