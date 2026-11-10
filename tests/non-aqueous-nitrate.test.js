import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations } from '../js/ionic.js';
import { predictReaction } from '../js/predictor.js';

function withCoefficients(result) {
  return {
    ...result.equation,
    left: result.equation.left.map((item, index) => ({ ...item, coefficient: result.coefficients[index] })),
    right: result.equation.right.map((item, index) => ({ ...item, coefficient: result.coefficients[result.equation.left.length + index] }))
  };
}

for (const [source, solvent] of [['NH4NO3 = N2O + 2H2O', 'melt'], ['2Na + Cl2 = 2NaCl', 'gas'], ['CaCO3 = CaO + CO2', 'melt']]) {
  test(`Безводная среда блокирует ионную форму: ${source}`, () => {
    const result = buildIonicEquations(source, { solvent });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.message, 'Ионные уравнения не составляются для безводных сред.');
  });
}

const nitrateCases = [
  { reactants: 'Cu2S + HNO3', full: 'Cu₂S + 14H⁺ + 14NO₃⁻ → 2Cu²⁺ + 4NO₃⁻ + 2H⁺ + SO₄²⁻ + 10NO₂↑ + 6H₂O', spectators: 4 },
  { reactants: 'FeS2 + HNO3', full: 'FeS₂ + 18H⁺ + 18NO₃⁻ → Fe³⁺ + 3NO₃⁻ + 4H⁺ + 2SO₄²⁻ + 15NO₂↑ + 7H₂O', spectators: 3 },
  { reactants: 'Zn + 4HNO3', full: 'Zn + 4H⁺ + 4NO₃⁻ → Zn²⁺ + 2NO₃⁻ + 2NO₂↑ + 2H₂O', spectators: 2, heating: false }
];

for (const item of nitrateCases) {
  test(`Нитрат-ионы сохраняются в полной форме: ${item.reactants}`, () => {
    const prediction = predictReaction(item.reactants, { medium: 'acidic', acidConcentration: 'concentrated', solvent: 'aqueous', heating: item.heating ?? true });
    assert.equal(prediction.status, 'predicted', prediction.message);
    const ionic = buildIonicEquations(withCoefficients(prediction));
    assert.equal(ionic.status, 'ok', ionic.message);
    assert.equal(ionic.fullUnicode, item.full);
    assert.ok(inspectBalance(ionic.fullEquation).isBalanced);
    assert.ok(ionic.spectators.some((ion) => ion.formula === 'NO3^-' && ion.coefficient === item.spectators));
  });
}

test('интерфейс передаёт растворитель в ионный модуль', () => {
  const source = readFileSync('js/auto-ui.js', 'utf8');
  assert.ok(source.includes('buildIonicEquations(currentEquation, { solvent: getConditions().solvent })'));
});

test('проверка сохраняет фазу и не строит ионные формы для расплава', () => {
  const source = readFileSync('js/ui.js', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.ok(html.includes('id="check-solvent"'));
  assert.ok(source.includes('buildIonicEquations(result.equation, { solvent: state.checkSolvent })'));
  assert.ok(source.includes("renderThermoPanel('#check-thermo-panel', result.equation, { solvent: state.checkSolvent })"));
  assert.ok(source.includes('state.checkSolvent = autoController.getConditions().solvent'));
  assert.ok(source.includes('checkSolvent: state.checkSolvent'));
});
