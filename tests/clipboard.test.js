import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../js/clipboard.js';

function setGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test('Clipboard API используется при успешном доступе', async () => {
  let copied = '';
  const restoreNavigator = setGlobal('navigator', { clipboard: { writeText: async (text) => { copied = text; } } });
  const restoreDocument = setGlobal('document', undefined);
  try {
    await copyText('2H2 + O2 = 2H2O');
    assert.equal(copied, '2H2 + O2 = 2H2O');
  } finally {
    restoreNavigator();
    restoreDocument();
  }
});

test('резервный способ выделяет текст и удаляет временное поле', async () => {
  const textarea = {
    style: {},
    value: '',
    selected: false,
    removed: false,
    setAttribute() {},
    select() { this.selected = true; },
    setSelectionRange() {},
    remove() { this.removed = true; }
  };
  const restoreNavigator = setGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  const restoreDocument = setGlobal('document', {
    createElement: (tag) => {
      assert.equal(tag, 'textarea');
      return textarea;
    },
    body: { append() {} },
    execCommand: (command) => command === 'copy'
  });
  try {
    await copyText('MnO4^-');
    assert.equal(textarea.value, 'MnO4^-');
    assert.equal(textarea.selected, true);
    assert.equal(textarea.removed, true);
  } finally {
    restoreNavigator();
    restoreDocument();
  }
});
