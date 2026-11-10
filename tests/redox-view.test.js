import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRedoxPanel } from '../js/redox-view.js';
import { checkEquation } from '../js/checker.js';
import { checkIonPair } from '../js/reference-tables.js';

function panelModel() {
  return {
    panel: { hidden: true },
    steps: {
      children: [],
      replaceChildren(...items) { this.children = items; },
      append(...items) { this.children.push(...items); },
      text() { return this.children.map((item) => item.textContent).join(' | '); }
    }
  };
}

test('новая ОВР полностью заменяет предыдущие строки панели', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ textContent: '' }) };
  try {
    const { panel, steps } = panelModel();
    renderRedoxPanel(panel, steps, checkEquation('P + 5HNO3 = H3PO4 + 5NO2 + H2O').redox);
    assert.equal(panel.hidden, false);
    assert.match(steps.text(), /P: 0 → \+5/);
    renderRedoxPanel(panel, steps, checkEquation('2H2 + O2 = 2H2O').redox);
    assert.equal(panel.hidden, false);
    assert.match(steps.text(), /O: 0 → −2/);
    assert.doesNotMatch(steps.text(), /P: 0|HNO₃|H₃PO₄/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('не-ОВР очищает и скрывает панель, включая прежние DOM-узлы', () => {
  const { panel, steps } = panelModel();
  steps.children.push({ textContent: 'Старая строка' });
  renderRedoxPanel(panel, steps, checkEquation('NaCl + AgNO3 = AgCl + NaNO3').redox);
  assert.equal(panel.hidden, true);
  assert.deepEqual(steps.children, []);
});

test('последовательные вызовы ядра не переносят состояние между реакциями', () => {
  for (let index = 0; index < 8; index += 1) {
    const phosphorus = checkEquation('P + 5HNO3 = H3PO4 + 5NO2 + H2O').redox;
    assert.equal(phosphorus.transitions.includes('N: +5 → +4'), true);
    const water = checkEquation('2H2 + O2 = 2H2O').redox;
    assert.equal(water.transitions.includes('O: 0 → −2'), true);
    assert.equal(water.transitions.some((text) => text.includes('P:') || text.includes('N:')), false);
    assert.equal(water.electronsLost.toNumber(), 4);
  }
});

test('справочник использует общий распознаватель электролитов', () => {
  assert.equal(checkIonPair('K^+', 'CrO4^2-').status, 'Р');
  assert.equal(checkIonPair('Li^+', 'CrO4^2-').status, 'Р');
  assert.equal(checkIonPair('Li^+', 'PO4^3-').status, 'Н');
});
