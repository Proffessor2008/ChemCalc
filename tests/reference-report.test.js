import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceReport } from '../js/report-builders.js';

class FakeElement {
  constructor(tagName, { text = '', className = '', children = [] } = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.className = className;
    this.childNodes = children;
    this.classList = { contains: (name) => className.split(/\s+/).filter(Boolean).includes(name) };
  }

  querySelectorAll(selector) {
    if (selector === ':scope > section.card') {
      return this.childNodes.filter((node) => node.tagName === 'SECTION' && node.classList.contains('card'));
    }
    if (selector === ':scope > li') {
      return this.childNodes.filter((node) => node.tagName === 'LI');
    }
    if (selector === 'button') {
      return descendants(this).filter((node) => node.tagName === 'BUTTON');
    }
    if (selector === 'strong' || selector === 'span') {
      return descendants(this).filter((node) => node.tagName === selector.toUpperCase()).slice(0, 1);
    }
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function descendants(node) {
  const found = [];
  for (const child of node.childNodes || []) {
    if (child.nodeType !== 1) continue;
    found.push(child, ...descendants(child));
  }
  return found;
}

const table = {
  tHead: { rows: [{ cells: [{ textContent: 'Катион' }, { textContent: 'Cl⁻' }] }] },
  tBodies: [{ rows: [{ cells: [{ textContent: 'Na⁺' }, { textContent: 'Р' }] }] }],
  rows: []
};

const root = new FakeElement('div', {
  children: [
    new FakeElement('section', {
      className: 'card',
      children: [
        new FakeElement('h2', { text: 'Матрица растворимости' }),
        new FakeElement('p', { text: 'Р — растворимо, Н — нерастворимо.' }),
        new FakeElement('div', {
          className: 'table-scroll',
          children: [Object.assign(new FakeElement('table'), table)]
        }),
        new FakeElement('form', { className: 'tool-card', text: 'Проверить пару ионов' })
      ]
    }),
    new FakeElement('section', {
      className: 'card',
      children: [
        new FakeElement('h2', { text: 'Ряд активности' }),
        new FakeElement('div', {
          className: 'activity-series',
          children: [
            new FakeElement('button', {
              text: 'Mn 0.00 В',
              children: [
                new FakeElement('strong', { text: 'Mn' }),
                new FakeElement('span', { text: '0.00 В' })
              ]
            }),
            new FakeElement('button', {
              text: 'Zn −0.76 В',
              children: [
                new FakeElement('strong', { text: 'Zn' }),
                new FakeElement('span', { text: '−0.76 В' })
              ]
            })
          ]
        })
      ]
    }),
    new FakeElement('section', {
      className: 'card',
      children: [
        new FakeElement('h2', { text: 'Тепловая карта' }),
        new FakeElement('div', { className: 'en-grid', text: 'Mn 1.55' }),
        new FakeElement('p', { text: 'Значения по Полингу.' })
      ]
    })
  ]
});

test('отчёт справочника собирает таблицы, ряд активности и пропускает формы и тепловую карту', () => {
  const report = buildReferenceReport({
    root,
    id: 'solubility',
    label: 'Растворимость',
    source: 'CRC',
    filter: 'Na'
  });
  assert.equal(report.orientation, 'landscape');
  assert.equal(report.subtitle, 'Растворимость');
  assert.deepEqual(report.meta.map((entry) => entry.label), ['Сформировано', 'Источник', 'Фильтр']);
  assert.deepEqual(report.sections.map((section) => section.heading), ['Матрица растворимости', 'Ряд активности', 'Тепловая карта']);
  const matrix = report.sections[0].blocks;
  assert.ok(matrix.some((block) => block.type === 'paragraph' && block.text.includes('Р — растворимо')));
  assert.deepEqual(matrix.find((block) => block.type === 'table'), { type: 'table', headers: ['Катион', 'Cl⁻'], rows: [['Na⁺', 'Р']] });
  assert.ok(!matrix.some((block) => block.text?.includes('Проверить пару')));
  assert.deepEqual(report.sections[1].blocks[0], { type: 'table', headers: ['Элемент', 'E°, В'], rows: [['Mn', '0.00 В'], ['Zn', '−0.76 В']] });
  assert.deepEqual(report.sections[2].blocks.map((block) => block.text), ['Значения по Полингу.']);
});
