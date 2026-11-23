import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solubilityData from '../data/solubility.json' with { type: 'json' };
import substancesData from '../data/substances.json' with { type: 'json' };
import elementDescriptions from '../data/element-descriptions.json' with { type: 'json' };
import substanceDescriptions from '../data/substance-descriptions.json' with { type: 'json' };
import elementsData from '../data/elements.json' with { type: 'json' };

const allIonFormulas = Object.values(solubilityData.substances).flatMap((record) => (record.ions || []).map((ion) => ion.formula));

test('растворимость расширена новыми анионами и солями', () => {
  for (const ion of ['SiO3^2-', 'HSO4^-', 'FeO4^2-', 'S2O8^2-', 'C2O4^2-', 'ClO4^-', 'BrO3^-', 'IO3^-', 'BO2^-', 'B4O7^2-', 'AsO4^3-', 'P2O7^4-', 'SeO4^2-']) {
    assert.ok(allIonFormulas.includes(ion), `нет аниона ${ion}`);
  }
  for (const formula of ['Na2SiO3', 'Ca(HSO4)2', 'Na2FeO4', 'Na2S2O8', 'Na2C2O4', 'NaClO4', 'NaBrO3', 'Na2B4O7', 'Na3AsO4', 'Na4P2O7', 'Ag2SO4', 'BaCO3', 'CaSO4', 'FeS', 'ZnS', 'PbSO4', 'SrSO4', 'FeO2']) {
    assert.ok(solubilityData.substances[formula], `нет записи растворимости ${formula}`);
  }
  assert.equal(solubilityData.substances.FeO2.solubility, 'Н');
});

test('вкладка сообщества разделена на заявки и вопросы', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('id="community-proposals-view"'));
  assert.ok(html.includes('id="community-questions-view"'));
  assert.ok(html.includes('data-community-view="proposals"'));
  assert.ok(html.includes('data-community-view="questions"'));
  assert.ok(html.indexOf('data-community-view="questions"') < html.indexOf('data-community-view="proposals"'));
  const community = readFileSync('js/community-ui.js', 'utf8');
  assert.ok(community.includes('mountQuestions'));
  assert.ok(community.includes("communityView = 'questions'"));
  assert.ok(community.includes('showQuestions'));
  assert.ok(community.includes("initQAUI({ container: $('#community-questions-view')"));
  const qa = readFileSync('js/qa-ui.js', 'utf8');
  for (const phrase of ['data-qa-vote', 'data-qa-accept', 'data-qa-comment', 'data-qa-tag', 'data-qa-flag', 'data-qa-close', 'data-qa-reopen', 'data-qa-edit-question', 'data-qa-delete-question', 'data-qa-edit-answer', 'data-qa-delete-answer', 'data-qa-format', 'data-qa-share', 'qa-ask-page', 'editHistory', 'qa-row-title', 'qa-comment-editor', '/api/questions', '/api/answers', '/api/tags']) {
    assert.ok(qa.includes(phrase), `нет в qa-ui: ${phrase}`);
  }
  assert.ok(!qa.includes('qa-question-link'), 'в списке не должно быть вложенной кнопки');
  assert.ok(html.includes('community-ask-question'));
  assert.ok(community.includes("$('#community-ask-question')"));
  assert.ok(community.includes('qaController?.activate()'));
  assert.ok(community.includes('qaController?.onAuthChange({ reload: true })'));
  const server = readFileSync('server/app.mjs', 'utf8');
  for (const phrase of ["action === 'flag'", "action === 'close'", "request.method === 'PATCH'", "request.method === 'DELETE'", 'post_edits', 'question_flags', 'notifyModerators', 'MODERATOR_ROLES']) {
    assert.ok(server.includes(phrase), `нет в server/app.mjs: ${phrase}`);
  }
  const database = readFileSync('server/db.mjs', 'utf8');
  for (const phrase of ['post_edits', 'question_flags', 'duplicate_of', 'views INTEGER']) {
    assert.ok(database.includes(phrase), `нет в server/db.mjs: ${phrase}`);
  }
  const entry = readFileSync('server.mjs', 'utf8');
  assert.ok(entry.includes('fileURLToPath'));
  assert.ok(entry.includes('createStaticHandler(projectRoot)'));
});

test('новые вещества получили русские названия', () => {
  const formulas = new Set(substancesData.items.map((item) => item.formula));
  for (const formula of ['Li2SiO3', 'Ca(HSO4)2', 'Na2FeO4', 'Na2S2O8', 'Na2C2O4', 'NaClO4', 'KClO4', 'Na2B4O7', 'Na3AsO4', 'Na4P2O7', 'Ag2SO4', 'PbSO4', 'BaCO3', 'CaSO4', 'FeS', 'ZnS', 'SrCl2', 'SnCl2', 'H2C2O4']) {
    assert.ok(formulas.has(formula), `нет названия вещества ${formula}`);
  }
  assert.ok(substancesData.items.length >= 370);
});

test('описания элементов покрывают все 118 элементов', () => {
  assert.equal(elementsData.elements.length, 118);
  const symbols = new Set(elementsData.elements.map((element) => element.symbol));
  assert.equal(Object.keys(elementDescriptions).length, 118);
  for (const symbol of symbols) {
    assert.ok(elementDescriptions[symbol]?.summary, `нет краткого описания для ${symbol}`);
  }
  assert.ok(elementDescriptions.Fe.chemical_relations);
  assert.ok(elementDescriptions.Fe.characteristic_compounds?.length);
  assert.ok(elementDescriptions.Fe.reactions?.length);
});

test('описания соединений ссылаются на известные формулы', () => {
  assert.ok(Object.keys(substanceDescriptions).length >= 40);
  const formulas = new Set(substancesData.items.map((item) => item.formula));
  for (const formula of Object.keys(substanceDescriptions)) {
    assert.ok(formulas.has(formula), `описание для неизвестного вещества ${formula}`);
    assert.ok(substanceDescriptions[formula].description, `нет описания у ${formula}`);
  }
});

test('справочник «Вещества» и подробный гайд подключены', () => {
  const reference = readFileSync('js/reference-ui.js', 'utf8');
  assert.ok(reference.includes("id: 'substances'"));
  assert.ok(reference.includes('substances: renderSubstances'));
  assert.ok(reference.includes('substance-descriptions.json'));
  const onboarding = readFileSync('js/onboarding.js', 'utf8');
  for (const phrase of ['Стехиометрия', 'Экспорт в PDF и DOCX', 'Сообщество', 'Личный кабинет', 'Офлайн', 'Лаборатория', 'Методика и примеры', 'Распознавание по камере', 'Отзыв о программе', 'Поддержка', 'restart']) {
    assert.ok(onboarding.includes(phrase), `нет пункта гайда: ${phrase}`);
  }
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('id="restart-onboarding"'));
});
