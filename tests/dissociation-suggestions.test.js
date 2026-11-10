import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acidDissociationSteps } from '../js/dissociation.js';
import { ionicForUnbalanced } from '../js/ionic.js';
import { predictReaction } from '../js/predictor.js';

test('фосфорная кислота имеет три обратимые ступени с Ka', () => {
  const steps = acidDissociationSteps('H3PO4');
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((step) => step.from), ['H3PO4', 'H2PO4^-', 'HPO4^2-']);
  assert.deepEqual(steps.map((step) => step.to), ['H2PO4^-', 'HPO4^2-', 'PO4^3-']);
  assert.ok(steps.every((step) => step.strength === 'weak' && step.equation.includes('⇄') && step.Ka > 0 && step.source));
  assert.equal(steps[0].pKa, 2.15);
  assert.equal(steps[2].pKa, 12.35);
});

test('серная кислота разделяет сильную и слабую ступени', () => {
  const steps = acidDissociationSteps('H2SO4');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].strength, 'strong');
  assert.ok(steps[0].equation.includes('→'));
  assert.equal(steps[1].strength, 'weak');
  assert.ok(steps[1].equation.includes('⇄'));
  assert.equal(steps[1].pKa, 1.92);
});

test('уксусная кислота остаётся молекулой в кратком ионном уравнении', () => {
  const result = ionicForUnbalanced('CH3COOH + NaOH = CH3COONa + H2O');
  assert.equal(result.status, 'ok');
  assert.equal(result.netUnicode, 'CH₃COOH + OH⁻ → CH₃COO⁻ + H₂O');
  assert.equal(result.dissociation.length, 1);
  assert.equal(result.dissociation[0].pKa, 4.76);
});

test('H3PO4 не диссоциирует полностью, но доступны все три ступени', () => {
  const result = ionicForUnbalanced('H3PO4 + 3NaOH = Na3PO4 + 3H2O');
  assert.equal(result.status, 'ok', result.message);
  assert.equal(result.netUnicode, 'H₃PO₄ + 3OH⁻ → PO₄³⁻ + 3H₂O');
  assert.equal(result.dissociation.length, 3);
  assert.ok(result.notes.some((note) => note.includes('не разбиваются полностью')));
});

test('угольная кислота имеет две ступени, NaCl — ни одной', () => {
  assert.equal(acidDissociationSteps('H2CO3').length, 2);
  assert.equal(acidDissociationSteps('NaCl').length, 0);
});

test('при отсутствии правила предлагаются близкие примеры, а не продукты', () => {
  const result = predictReaction('KMnO4 + NaCl');
  assert.equal(result.status, 'no-rule');
  assert.ok(result.suggestions.length > 0 && result.suggestions.length <= 3);
  assert.ok(result.suggestions.every((suggestion) => suggestion.reactants && suggestion.hint && !('score' in suggestion)));
  assert.ok(result.suggestions.some((suggestion) => suggestion.reactants.includes('KMnO4') || suggestion.reactants.includes('NaCl')));
});

test('для совершенно незнакомой пары не создаются фиктивные подсказки', () => {
  const result = predictReaction('He + Ne');
  assert.equal(result.status, 'no-rule');
  assert.deepEqual(result.suggestions, []);
});

test('интерфейс содержит ступени диссоциации и обработчики подсказок', () => {
  const html = readFileSync('index.html', 'utf8');
  const auto = readFileSync('js/auto-ui.js', 'utf8');
  assert.ok(html.includes('id="auto-dissociation"'));
  assert.ok(auto.includes('data-suggestion'));
  assert.ok(auto.includes('renderSuggestions'));
  assert.ok(auto.includes("`${input.value.trim()} = `"));
});
