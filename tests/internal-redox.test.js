import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation } from '../js/parser.js';
import { predictReaction } from '../js/predictor.js';
import { analyzeRedox } from '../js/redox.js';
import { setLocale } from '../js/i18n.js';

const cases = [
  { reactants: 'NH4NO3', molecular: 'NH4NO3 = N2O↑ + 2H2O', electrons: 4, symbols: ['аммоний', 'нитрат'] },
  { reactants: 'NH4NO2', molecular: 'NH4NO2 = N2↑ + 2H2O', electrons: 3, symbols: ['аммоний', 'нитрит'] },
  { reactants: '(NH4)2Cr2O7', molecular: '(NH4)2Cr2O7 = N2↑ + Cr2O3 + 4H2O', electrons: 6, symbols: ['аммоний', 'дихромат'] },
  { reactants: 'KClO3', molecular: '2KClO3 = 2KCl + 3O2↑', electrons: 12, symbols: ['хлорат', 'оксид'], conditions: { catalyst: 'MnO2' } }
];

for (const item of cases) {
  test(`Внутримолекулярная ОВР: ${item.reactants}`, () => {
    const prediction = predictReaction(item.reactants, { solvent: 'melt', heating: true, ...(item.conditions || {}) });
    assert.equal(prediction.status, 'predicted', prediction.message);
    assert.equal(prediction.formatted, item.molecular.replace(' = ', ' → '));
    const redox = analyzeRedox(parseEquation(item.molecular));
    assert.equal(redox.isRedox, true);
    assert.equal(redox.internal, true);
    assert.equal(redox.complete, true);
    assert.equal(redox.electronsLost.toString(), String(item.electrons));
    assert.equal(redox.electronsGained.toString(), String(item.electrons));
    assert.equal(redox.electronBalance, true);
    assert.ok(redox.oxidizers.some((species) => species.formula === item.reactants));
    assert.ok(redox.reducers.some((species) => species.formula === item.reactants));
    for (const label of item.symbols) assert.ok(redox.transitions.some((transition) => transition.includes(label)));
    assert.ok(redox.halfReactions.length >= 2);
  });
}

test('объяснение внутримолекулярной ОВР переводится на английский', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: '' }, querySelectorAll: () => [] };
  try {
    setLocale('en');
    const redox = analyzeRedox(parseEquation('NH4NO3 = N2O↑ + 2H2O'));
    for (const text of [...redox.summary, ...redox.transitions, ...redox.halfReactions, ...redox.notes, redox.source]) {
      assert.doesNotMatch(text, /[А-Яа-яЁё]/, text);
    }
    assert.ok(redox.summary.some((text) => text.includes('4e⁻ lost, 4e⁻ gained — balanced')));
    assert.ok(redox.transitions.some((text) => text.includes('ammonium')));
    assert.ok(redox.halfReactions.some((text) => text.includes('is oxidized')));
  } finally {
    setLocale('ru');
    globalThis.document = previousDocument;
  }
});
