import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('полноэкранная таблица имеет явную кнопку выхода и обработчик', () => {
  const html = readFileSync('index.html', 'utf8');
  const script = readFileSync('js/periodic-table.js', 'utf8');
  const styles = readFileSync('styles.css', 'utf8');
  assert.ok(html.includes('id="periodic-exit-fullscreen"'));
  assert.ok(html.includes('Выйти из полноэкранного режима'));
  assert.ok(script.includes("addEventListener('click', () => setExpanded(false))"));
  assert.ok(styles.includes('.periodic-dialog.periodic-expanded .fullscreen-exit'));
});

test('документация является отдельной сохраняемой вкладкой', () => {
  const html = readFileSync('index.html', 'utf8');
  const ui = readFileSync('js/ui.js', 'utf8');
  assert.ok(html.includes('data-panel="documentation"'));
  assert.ok(html.includes('id="docs-logic"'));
  assert.ok(html.includes('id="docs-features"'));
  assert.ok(html.includes('id="docs-start"'));
  assert.ok(ui.includes("'documentation'"));
});

test('логотип возвращает в режим Проверка', () => {
  const html = readFileSync('index.html', 'utf8');
  const ui = readFileSync('js/ui.js', 'utf8');
  assert.ok(html.includes('id="brand-home"'));
  assert.ok(ui.includes("$('#brand-home').addEventListener('click'"));
  assert.ok(ui.includes("setMode('check')"));
});

test('мобильная навигация содержит шесть колонок, включая сообщество', () => {
  const html = readFileSync('index.html', 'utf8');
  const styles = readFileSync('styles.css', 'utf8');
  assert.equal(html.match(/class="mobile-nav"[\s\S]*?<\/nav>/)[0].match(/data-tab=/g).length, 6);
  assert.ok(styles.includes('grid-template-columns: repeat(6, minmax(0, 1fr))'));
});
