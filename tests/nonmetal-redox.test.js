import test from 'node:test';
import assert from 'node:assert/strict';
import { predictReaction } from '../js/predictor.js';
import { oxidationStates, analyzeRedox } from '../js/redox.js';
import { parseEquation, parseFormula } from '../js/parser.js';

const conditions = { medium: 'acidic', acidConcentration: 'concentrated', heating: true };

test('бинарные оксиды вычисляют степень окисления по электронейтральности', () => {
  const cases = [['NO2', 'N', 4], ['NO', 'N', 2], ['N2O', 'N', 1], ['N2O3', 'N', 3], ['N2O5', 'N', 5], ['SO2', 'S', 4], ['CO2', 'C', 4], ['P2O5', 'P', 5]];
  for (const [formula, symbol, expected] of cases) {
    const result = oxidationStates(parseFormula(formula));
    assert.equal(result.complete, true, formula);
    assert.equal(result.states.get(symbol).toNumber(), expected, formula);
  }
  assert.equal(oxidationStates(parseFormula('NO2^-')).states.get('N').toNumber(), 3);
});

test('электронный баланс фосфора и углерода согласован для NO2 и SO2', () => {
  for (const equation of ['P + 5HNO3 = H3PO4 + 5NO2 + H2O', 'C + 2H2SO4 = CO2 + 2SO2 + 2H2O']) {
    const result = analyzeRedox(parseEquation(equation));
    assert.equal(result.complete, true);
    assert.equal(result.electronBalance, true);
    assert.equal(result.electronsLost.toNumber(), equation.startsWith('P') ? 5 : 4);
    assert.equal(result.electronsGained.toNumber(), result.electronsLost.toNumber());
  }
});

for (const [reactants, expected] of [
  ['P + HNO3', 'P + 5HNO3 → H3PO4 + 5NO2↑ + H2O'],
  ['S + 6HNO3', 'S + 6HNO3 → H2SO4 + 6NO2↑ + 2H2O'],
  ['C + 4HNO3', 'C + 4HNO3 → CO2↑ + 4NO2↑ + 2H2O'],
  ['C + 2H2SO4', 'C + 2H2SO4 → CO2↑ + 2SO2↑ + 2H2O'],
  ['P + H2SO4', '2P + 5H2SO4 → 2H3PO4 + 5SO2↑ + 2H2O']
]) {
  test(`Неметалл с кислотой-окислителем: ${reactants}`, () => {
    const prediction = predictReaction(reactants, conditions);
    assert.equal(prediction.status, 'predicted', prediction.message);
    assert.equal(prediction.formatted, expected);
    assert.equal(prediction.ruleId, 'generic-nonmetal-oxidizing-acid');
  });
}
