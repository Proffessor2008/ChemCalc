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

test('вместо документации открываются настройки, а не вкладка', () => {
  const html = readFileSync('index.html', 'utf8');
  const ui = readFileSync('js/ui.js', 'utf8');
  assert.ok(!html.includes('data-panel="documentation"'));
  assert.ok(!html.includes('panel-documentation'));
  assert.ok(html.includes('id="settings-dialog"'));
  assert.ok(html.includes('id="settings-toggle"'));
  assert.ok(!html.includes('id="theme-toggle"'));
  for (const option of ['light', 'dark', 'system']) assert.ok(html.includes(`data-theme-option="${option}"`));
  for (const size of ['compact', 'normal', 'large']) assert.ok(html.includes(`data-size-option="${size}"`));
  assert.ok(html.includes('id="restart-onboarding"'));
  assert.ok(ui.includes("$('#settings-toggle')"));
  assert.ok(ui.includes('data-theme-option'));
  assert.ok(ui.includes('data-size-option'));
  assert.ok(!ui.includes("'documentation'"));
});

test('вход и профиль находятся в личном кабинете, а профиль имеет режим просмотра', () => {
  const html = readFileSync('index.html', 'utf8');
  const account = html.slice(html.indexOf('id="panel-account"'), html.indexOf('</main>'));
  const community = html.slice(html.indexOf('id="panel-community"'), html.indexOf('id="panel-account"'));
  assert.ok(account.includes('id="community-login-form"'));
  assert.ok(account.includes('id="community-register-form"'));
  assert.ok(!community.includes('id="community-login-form"'));
  assert.ok(!community.includes('id="community-register-form"'));
  assert.ok(account.includes('id="profile-edit"'));
  assert.ok(account.includes('id="profile-view"'));
  assert.ok(account.includes('id="profile-editor"'));
  assert.ok(account.includes('id="profile-nickname"'));
  assert.ok(account.includes('id="profile-login-readonly"'));
  assert.ok(account.includes('id="profile-login-view"'));
  assert.ok(!account.includes('id="profile-save-login"'));
  const communityUi = readFileSync('js/community-ui.js', 'utf8');
  assert.ok(communityUi.includes('profileEditing'));
  assert.ok(communityUi.includes("$('#profile-edit')"));
  assert.ok(communityUi.includes("$('#profile-save')"));
  assert.ok(communityUi.includes("$('#profile-cancel')"));
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
