import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t } from '../js/i18n.js';

const source = readFileSync('js/qa-ui.js', 'utf8');

function extractFunction(name) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`  function ${name}(`));
  if (start < 0) throw new Error(`нет функции ${name}`);
  let end = start + 1;
  while (end < lines.length && lines[end] !== '  }') end += 1;
  return lines.slice(start, end + 1).join('\n');
}

function extractConst(name) {
  const line = source.split('\n').find((item) => item.startsWith(`const ${name} =`));
  if (!line) throw new Error(`нет ${name}`);
  return line;
}

function buildRenderer(state = { commentDrafts: new Map(), openComments: new Set() }) {
  const bodies = ['tagChips', 'authorCard', 'questionCard', 'commentList', 'voteMarkup'].map(extractFunction).join('\n');
  const helpers = `${extractConst('countLabel')}\n${extractConst('unitLabel')}`;
  const factory = new Function('t', 'escapeHtml', 'formatTime', 'user', 'state', `
    ${helpers}
    ${bodies}
    return { tagChips, authorCard, questionCard, commentList, voteMarkup };
  `);
  return factory(
    t,
    (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
    () => '15.11.2026, 18:51',
    () => ({ id: 1, login: 'creator', privileges: 'GOD' }),
    state
  );
}

function maxButtonDepth(html) {
  const re = /<\/?button\b[^>]*>/g;
  let depth = 0;
  let max = 0;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith('</')) depth = Math.max(0, depth - 1);
    else { depth += 1; max = Math.max(max, depth); }
  }
  return max;
}

test('карточка вопроса не содержит вложенных кнопок и повторяет строку Stack Overflow', () => {
  const render = buildRenderer();
  const html = render.questionCard({
    id: 'q1',
    title: 'Это тестовый вопрос!',
    tags: ['redox', 'acid'],
    score: 0,
    answers_count: 1,
    has_accepted: true,
    views: 60,
    author_login: 'creator',
    author_reputation: 2801,
    updated_at: '2026-11-15T18:51:00.000Z',
    closed: false
  });
  assert.equal(maxButtonDepth(html), 1, 'кнопки не должны вкладываться друг в друга');
  assert.match(html, /class="qa-row"/);
  assert.match(html, /class="qa-row-title"/);
  assert.equal((html.match(/class="qa-tag"/g) || []).length, 2);
  assert.match(html, /qa-stat-answers accepted/);
  assert.match(html, /1 ответ/);
  assert.match(html, /creator/);
  assert.match(html, /Репутация/);
  assert.doesNotMatch(html, /qa-question-link/);
});

test('редактор комментария — большое поле, подсказка и кнопка до 5 символов', () => {
  const render = buildRenderer();
  const html = render.commentList([{ author_login: 'creator', body: 'Комментарий', created_at: '2026-11-15T18:51:00.000Z' }], 'question', 'q1');
  assert.equal(maxButtonDepth(html), 1);
  assert.match(html, /class="qa-comment-editor"/);
  assert.match(html, /<textarea[^>]*data-comment-input="question:q1"/);
  assert.match(html, /Нужно ещё 5 символов/);
  assert.match(html, /data-qa-submit-comment="question:q1" disabled/);
  assert.match(html, /Комментарий/);
});

test('черновик комментария и открытый редактор восстанавливаются после перерисовки', () => {
  const state = {
    commentDrafts: new Map([['question:q1', 'Черновик комментария']]),
    openComments: new Set(['question:q1'])
  };
  const render = buildRenderer(state);
  const html = render.commentList([], 'question', 'q1');
  assert.match(html, /Черновик комментария/);
  assert.match(html, /data-comment-form="question:q1" >/);
  assert.doesNotMatch(html, /data-comment-form="question:q1" hidden/);
});

test('детальная карточка не кладёт теги в узкую колонку', () => {
  const css = readFileSync('styles.css', 'utf8');
  assert.doesNotMatch(css, /\.qa-detail-body\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.qa-detail-footer/);
  assert.match(css, /\.qa-comment-editor textarea/);
});

test('детальная карточка: кнопка «Назад», действия, автор и комментарии', () => {
  const bodies = ['tagChips', 'authorCard', 'commentList', 'voteMarkup', 'renderDetail'].map(extractFunction).join('\n');
  const helpers = `${extractConst('countLabel')}\n${extractConst('unitLabel')}`;
  const container = { innerHTML: '' };
  const factory = new Function('t', 'escapeHtml', 'formatDate', 'formatTime', 'user', 'moderator', 'state', 'renderMarkdown', 'attachmentsMarkup', 'ATTACHMENT_ACCEPT', 'renderPendingAttachments', 'formatButtons', 'editsMarkup', '$', `
    ${helpers}
    ${bodies}
    return renderDetail;
  `);
  const render = factory(
    t,
    (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
    () => '15.11.2026',
    () => '18:51',
    () => ({ id: 1, login: 'creator', privileges: 'GOD' }),
    () => true,
    {
      detail: {
        question: {
          id: 'q1', title: 'Это тестовый вопрос!', body: '**Жирный** текст', tags: ['redox', 'acid'],
          score: 0, views: 3, answers_count: 1, has_accepted: true, closed: false, closed_reason: '', duplicate_of: null,
          author_id: 1, author_login: 'creator', author_reputation: 2801,
          created_at: '2026-11-15T18:51:00.000Z', updated_at: '2026-11-15T18:51:00.000Z',
          comments: [], edits: []
        },
        answers: [{
          id: 'a1', body: 'Ответ', score: 1, accepted: true, author_id: 2, author_login: 'bob', author_reputation: 10,
          created_at: '2026-11-15T18:51:00.000Z', comments: [], edits: [], viewer_vote: 0
        }]
      },
      commentDrafts: new Map(),
      answerDrafts: new Map([['q1', 'Черновик ответа']]),
      openComments: new Set()
    },
    (text) => `<p>${text}</p>`,
    () => '',
    'image/png',
    () => {},
    () => '',
    () => '',
    () => container
  );
  render();
  const html = container.innerHTML;
  assert.equal(maxButtonDepth(html), 1);
  assert.match(html, /qa-detail-top/);
  assert.match(html, /data-qa-list/);
  assert.match(html, /qa-detail-grid/);
  assert.match(html, /qa-detail-body/);
  assert.match(html, /qa-actions/);
  assert.match(html, /qa-detail-footer/);
  assert.match(html, /qa-comment-editor/);
  assert.match(html, /qa-answer/);
  assert.match(html, /qa-answer-body/);
  assert.match(html, /data-qa-edit-question/);
  assert.match(html, /data-qa-delete-question/);
  assert.match(html, /data-qa-close/);
  assert.match(html, /data-qa-accept="a1"/);
  assert.match(html, /Черновик ответа/);
});
