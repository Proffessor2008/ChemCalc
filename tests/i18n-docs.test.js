import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLocale, setLocale, t } from '../js/i18n.js';

test('словарь переводит новые сообщения и подставляет параметры', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: '' }, querySelectorAll: () => [] };
  try {
    setLocale('en');
    assert.equal(t('latex'), 'Copy LaTeX');
    assert.equal(t('tryIonicThermo'), 'Try the net ionic equation');
    assert.match(t('inputValid', { count: 3 }), /Reactants found: 3/);
    assert.match(t('yieldTarget', { product: 'H₂O' }), /H₂O/);
    assert.match(t('potentialNoReaction', { label: 'E°', value: '-0.337' }), /-0.337/);
    assert.match(t('nernstResult', { quotient: '0.000001', value: '0.810' }), /Nernst/);
    setLocale('ru');
    assert.match(t('inputValid', { count: 2 }), /реагентов: 2/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('переключение языка меняет lang и видимость разделов', () => {
  const ru = { dataset: { docLang: 'ru' }, hidden: false };
  const en = { dataset: { docLang: 'en' }, hidden: true };
  const previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: { lang: '' },
    querySelectorAll(selector) {
      if (selector === '[data-doc-lang]') return [ru, en];
      return [];
    }
  };
  try {
    setLocale('en');
    assert.equal(getLocale(), 'en');
    assert.equal(globalThis.document.documentElement.lang, 'en');
    assert.equal(ru.hidden, true);
    assert.equal(en.hidden, false);
    setLocale('ru');
    assert.equal(ru.hidden, false);
    assert.equal(en.hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('документация содержит полные английские и русские разделы', () => {
  const html = readFileSync('index.html', 'utf8');
  const englishSections = [...html.matchAll(/data-doc-lang="en" id="(docs-en-[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(englishSections, ['docs-en-start', 'docs-en-modes', 'docs-en-features', 'docs-en-logic', 'docs-en-table', 'docs-en-tools', 'docs-en-workflows', 'docs-en-pwa', 'docs-en-access', 'docs-en-limits', 'docs-en-tests']);
  assert.equal((html.match(/data-doc-lang="ru" id="docs-/g) || []).length, 11);
  assert.ok(html.includes('id="docs-workflows"'));
  for (const text of ['Quick start', 'Calculator modes', 'Calculation logic', 'Scientific limits and safety', 'Testing and source data', 'Try the net ionic equation']) {
    if (text !== 'Try the net ionic equation') assert.ok(html.includes(text), text);
  }
  assert.ok(html.includes('data-doc-lang="en" aria-label="Documentation sections"'));
});
