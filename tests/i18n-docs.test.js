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

test('документация удалена, настройки содержат темы, размер и обучение', () => {
  const html = readFileSync('index.html', 'utf8');
  const i18n = readFileSync('js/i18n.js', 'utf8');
  assert.ok(!html.includes('data-doc-lang="en"'));
  assert.ok(!html.includes('id="docs-workflows"'));
  assert.ok(html.includes('id="settings-dialog"'));
  for (const option of ['light', 'classic', 'dark']) assert.ok(html.includes(`data-theme-option="${option}"`));
  for (const size of ['compact', 'normal', 'large']) assert.ok(html.includes(`data-size-option="${size}"`));
  assert.ok(html.includes('id="restart-onboarding"'));
  assert.ok(i18n.includes("settings: 'Настройки'"));
  assert.ok(i18n.includes("profileSettings: 'Настройки профиля'"));
});

test('пользовательский интерфейс не содержит инструкций локального запуска', () => {
  const readme = readFileSync('README.md', 'utf8');
  for (const path of ['index.html', 'js/i18n.js']) {
    const content = readFileSync(path, 'utf8');
    for (const text of ['npm start', 'npm run start:static', '127.0.0.1:8080', 'file://', 'Запуск локально', 'Run locally']) {
      assert.ok(!content.includes(text), `${path}: ${text}`);
    }
  }
  assert.ok(readme.includes('## Дорожная карта'));
  assert.ok(readme.includes('npm start'));
});
