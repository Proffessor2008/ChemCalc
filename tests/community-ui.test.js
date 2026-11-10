import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const ui = readFileSync('js/community-ui.js', 'utf8');
const main = readFileSync('js/ui.js', 'utf8');
const auto = readFileSync('js/auto-ui.js', 'utf8');

test('сообщество содержит регистрацию, роли, ленту и модерацию', () => {
  assert.ok(html.includes('data-panel="community"'));
  assert.ok(html.includes('id="community-register-confirm"'));
  assert.ok(html.includes('id="community-users-section"'));
  assert.ok(html.includes('id="community-sort"'));
  assert.ok(main.includes("'community'"));
  assert.ok(main.includes('initCommunityUI'));
  for (const route of ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/users', '/review', '/withdraw', '/vote']) assert.ok(ui.includes(route), route);
  assert.ok(ui.includes("new EventSource('/api/events')"));
  assert.ok(ui.includes("user?.privileges !== 'GOD'"));
  assert.ok(ui.includes("const MODERATORS = ['admin', 'admin+', 'GOD']"));
  assert.ok(ui.includes("selectOptions(['basic', 'admin', 'admin+']"));
});

test('форма проверяет баланс, среду, источник и состав новых веществ', () => {
  assert.ok(html.includes('id="community-proposal-dialog"'));
  for (const code of ['inspectBalance', 'buildIonicEquations', 'phaseSpecific', 'sourceDetails', 'name_ru', 'solubility', 'strong', 'ions', 'validatePreview', 'specialCase', 'manualIonicFull', 'manualIonicNet', 'canReviewWarnings', 'updateManualIonicVisibility']) assert.ok(ui.includes(code), code);
  assert.ok(ui.includes("ions.placeholder = strong.checked ? 'Na^+:1, Cl^-:1' : ''"));
  assert.ok(ui.includes('ionsOptional'));
  assert.ok(auto.includes('result.ionicOverride'));
  assert.ok(auto.includes("override ? t('manualIonicApproved')"));
  assert.ok(ui.includes('textContent = error.message'));
  assert.ok(ui.includes("element('strong', '', proposal.author_login)"));
  assert.ok(!ui.includes('innerHTML = proposal'));
});

test('авто и проверка открывают заявку с условиями текущей реакции', () => {
  assert.ok(html.includes('id="auto-proposal-button"'));
  assert.ok(html.includes('id="auto-correction-button"'));
  assert.ok(html.includes('id="check-proposal-button"'));
  assert.ok(auto.includes('onPropose?.(false)'));
  assert.ok(auto.includes('onPropose?.(true)'));
  assert.ok(main.includes('originalRule: result?.ruleId ? getReactionRule(result.ruleId) : null'));
  assert.ok(main.includes('conditions: { solvent: state.checkSolvent }'));
  assert.ok(ui.includes('reactionKey'));
});
