import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport } from '../js/report.js';
import { paginateReport } from '../js/report-pdf.js';

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.childNodes = [];
    this.parentNode = null;
    this._text = '';
    this.style = {};
    this.attributes = {};
    this.classList = {
      add: (name) => { if (!this.className.split(/\s+/).includes(name)) this.className = `${this.className} ${name}`.trim(); },
      contains: (name) => this.className.split(/\s+/).includes(name)
    };
  }

  set textContent(value) {
    this._text = value === null || value === undefined ? '' : String(value);
    this.childNodes = [];
  }

  get textContent() {
    return this._text + this.childNodes.map((child) => child.textContent).join('');
  }

  get children() {
    return this.childNodes;
  }

  get rows() {
    return this.childNodes.filter((child) => child.tagName === 'TR');
  }

  get height() {
    if (this.tagName === 'TABLE') return 26 + this.childNodes.reduce((sum, child) => sum + child.height, 0);
    if (this.tagName === 'THEAD' || this.tagName === 'TBODY') return this.childNodes.reduce((sum, child) => sum + child.height, 0);
    if (this.tagName === 'TR') return 22;
    if (this.tagName === 'UL' || this.tagName === 'OL') return this.childNodes.reduce((sum, child) => sum + child.height, 0) + 8;
    if (this.tagName === 'LI') return Math.max(18, Math.ceil(this.textContent.length / 60) * 18);
    if (this.tagName === 'H1') return 42;
    if (this.tagName === 'H2') return 32;
    if (this.tagName === 'H3') return 26;
    if (this.tagName === 'P') return Math.max(18, Math.ceil(this.textContent.length / 80) * 18);
    if (this.childNodes.length) return this.childNodes.reduce((sum, child) => sum + child.height, 0);
    return Math.max(18, Math.ceil(this.textContent.length / 80) * 18);
  }

  get scrollHeight() {
    return this.height;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  get innerHTML() {
    const children = this.childNodes.map((child) => child.outerHTML).join('');
    return children + escapeHtml(this._text);
  }

  get outerHTML() {
    const classes = this.className ? ` class="${this.className}"` : '';
    const style = Object.entries(this.style).map(([name, value]) => `${name}:${value}`).join(';');
    const styleAttribute = style ? ` style="${style}"` : '';
    return `<${this.tagName.toLowerCase()}${classes}${styleAttribute}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
}

function fakeDocument() {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  return {
    head,
    body,
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => {
      const node = new FakeElement('#text');
      node.textContent = text;
      return node;
    }
  };
}

test('пагинация учитывает альбомную ориентацию', () => {
  const report = createReport({
    title: 'ChemCalc',
    subtitle: 'Справочник',
    sections: [{ heading: 'Таблица', blocks: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }] }],
    orientation: 'landscape',
    filename: 'test'
  });
  const previous = globalThis.document;
  const document = fakeDocument();
  globalThis.document = document;
  try {
    const pages = paginateReport(report);
    assert.equal(pages[0].width, 1123);
    assert.equal(pages[0].height, 794);
    assert.ok(pages[0].html.includes('report-footer'));
  } finally {
    globalThis.document = previous;
  }
});

test('пагинация PDF разбивает таблицы и списки, повторяет шапку и нумерует страницы', () => {
  const rows = Array.from({ length: 90 }, (_, index) => [`Строка ${index + 1}`, `Значение ${index + 1}`, `Ещё ${index + 1}`]);
  const items = Array.from({ length: 40 }, (_, index) => `Пункт ${index + 1}`);
  const report = createReport({
    title: 'ChemCalc',
    subtitle: 'Большой справочник',
    meta: [{ label: 'Источник', value: 'CRC' }],
    sections: [
      { heading: 'Таблица', blocks: [{ type: 'table', headers: ['Формула', 'Название', 'Значение'], rows }] },
      { heading: 'Список', blocks: [{ type: 'list', ordered: true, items }] },
      { heading: 'Уравнение', blocks: [{ type: 'equation', text: 'H₂ + O₂ → H₂O' }, { type: 'paragraph', text: 'Комментарий' }] }
    ],
    orientation: 'portrait',
    filename: 'test'
  });
  const previous = globalThis.document;
  const document = fakeDocument();
  globalThis.document = document;
  try {
    const pages = paginateReport(report);
    assert.ok(pages.length >= 3, `ожидалось несколько страниц, получено ${pages.length}`);
    assert.ok(pages[0].html.includes('report-footer'));
    assert.ok(pages[0].html.includes(`1 / ${pages.length}`));
    assert.ok(pages[pages.length - 1].html.includes(`${pages.length} / ${pages.length}`));
    assert.ok(pages[0].html.includes('Строка 1'));
    assert.ok(pages.some((page) => page.html.includes('Строка 90')));
    assert.ok(pages.filter((page) => page.html.includes('Строка 1') || page.html.includes('Формула')).length >= 2, 'шапка таблицы должна повторяться');
    assert.ok(pages.some((page) => page.html.includes('Пункт 40')));
    assert.ok(pages.some((page) => page.html.includes('H₂ + O₂ → H₂O')));
    assert.equal(document.head.childNodes.length, 0);
    assert.equal(document.body.childNodes.length, 0);
  } finally {
    globalThis.document = previous;
  }
});
