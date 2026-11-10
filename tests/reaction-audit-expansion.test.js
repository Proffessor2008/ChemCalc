import test from 'node:test';
import assert from 'node:assert/strict';
import { predictReaction } from '../js/predictor.js';
import { buildIonicEquations } from '../js/ionic.js';
import { inspectBalance } from '../js/balancer.js';
import { analyzeRedox } from '../js/redox.js';
import { parseEquation, parseSpecies } from '../js/parser.js';

function predicted(reactants, conditions, expected, net = null) {
  const result = predictReaction(reactants, conditions);
  assert.equal(result.status, 'predicted', `${reactants}: ${result.message}`);
  assert.equal(result.formatted, expected, reactants);
  const equation = {
    ...result.equation,
    left: result.equation.left.map((item, index) => ({ ...item, coefficient: result.coefficients[index] })),
    right: result.equation.right.map((item, index) => ({ ...item, coefficient: result.coefficients[result.equation.left.length + index] }))
  };
  assert.ok(inspectBalance(equation).isBalanced, reactants);
  const ionic = buildIonicEquations(equation, { solvent: conditions.solvent });
  if (net) assert.equal(ionic.netUnicode, net, reactants);
  return { result, ionic };
}

for (const item of [
  ['BaCl2 + Na2SO4', 'BaCl2 + Na2SO4 → BaSO4↓ + 2NaCl', 'Ba²⁺ + SO₄²⁻ → BaSO₄↓'],
  ['K2CO3 + 2HNO3', 'K2CO3 + 2HNO3 → 2KNO3 + H2O + CO2↑', 'CO₃²⁻ + 2H⁺ → H₂O + CO₂↑'],
  ['FeS + 2HCl', 'FeS + 2HCl → FeCl2 + H2S↑', 'FeS + 2H⁺ → Fe²⁺ + H₂S↑'],
  ['CuSO4 + 2NaOH', 'CuSO4 + 2NaOH → Cu(OH)2↓ + Na2SO4', 'Cu²⁺ + 2OH⁻ → Cu(OH)₂↓']
]) {
  test(`Аудит ионного обмена: ${item[0]}`, () => predicted(item[0], { solvent: 'aqueous' }, item[1], item[2]));
}

for (const item of [
  ['Cu + 4HNO3', { medium: 'acidic', acidConcentration: 'concentrated', solvent: 'aqueous' }, 'Cu + 4HNO3 → Cu(NO3)2 + 2NO2↑ + 2H2O', 'Cu + 4H⁺ + 2NO₃⁻ → Cu²⁺ + 2NO₂↑ + 2H₂O'],
  ['3Cu + 8HNO3', { medium: 'acidic', acidConcentration: 'dilute', solvent: 'aqueous' }, '3Cu + 8HNO3 → 3Cu(NO3)2 + 2NO↑ + 4H2O', '3Cu + 8H⁺ + 2NO₃⁻ → 3Cu²⁺ + 2NO↑ + 4H₂O'],
  ['Mg + 2HCl', { medium: 'acidic', acidConcentration: 'dilute', solvent: 'aqueous' }, 'Mg + 2HCl → MgCl2 + H2↑', 'Mg + 2H⁺ → Mg²⁺ + H₂↑']
]) {
  test(`Аудит металла и кислоты: ${item[0]}`, () => predicted(...item));
}

test('NH3 восстанавливает CuO в газовой фазе, ионный модуль отключён', () => {
  const { ionic } = predicted('2NH3 + 3CuO', { solvent: 'gas', heating: true }, '2NH3 + 3CuO → 3Cu + N2↑ + 3H2O');
  assert.equal(ionic.status, 'unavailable');
  assert.equal(ionic.message, 'Ионные уравнения не составляются для безводных сред.');
});

test('исходная схема NH4I + 2HNO3 = N2O + I2 + 3H2O неуравновешенна', () => {
  const equation = parseEquation('NH4I + 2HNO3 = N2O + I2 + 3H2O');
  const balance = inspectBalance(equation);
  assert.equal(balance.isBalanced, false);
  assert.ok(balance.atomRows.some((row) => ['N', 'I'].includes(row.symbol) && row.left !== row.right));
});

test('NH4I + HNO3 использует согласованную схему NO2, а не неверный эталон N2O', () => {
  const { result, ionic } = predicted('NH4I + 2HNO3', { medium: 'acidic', acidConcentration: 'concentrated', solvent: 'aqueous', heating: true }, '2NH4I + 4HNO3 → 2NH4NO3 + I2↓ + 2NO2↑ + 2H2O', '2I⁻ + 4H⁺ + 2NO₃⁻ → I₂↓ + 2NO₂↑ + 2H₂O');
  const redox = analyzeRedox(result.equation, result.coefficients);
  assert.equal(redox.electronBalance, true);
  assert.equal(redox.electronsLost.toNumber(), 2);
  assert.ok(ionic.spectators.some((ion) => ion.formula === 'NH4^+' && ion.coefficient === 2));
});

for (const item of [
  ['H2SO4 + KOH', 'H2SO4 + KOH → KHSO4 + H2O', 'H⁺ + OH⁻ → H₂O'],
  ['H3PO4 + KOH', 'H3PO4 + KOH → KH2PO4 + H2O', 'H₃PO₄ + OH⁻ → H₂PO₄⁻ + H₂O'],
  ['2H3PO4 + 3Ca(OH)2', '2H3PO4 + 3Ca(OH)2 → Ca3(PO4)2↓ + 6H2O', '2H₃PO₄ + 3Ca²⁺ + 6OH⁻ → Ca₃(PO₄)₂↓ + 6H₂O'],
  ['H2S + NaOH', 'H2S + NaOH → NaHS + H2O', 'H₂S + OH⁻ → HS⁻ + H₂O']
]) {
  test(`Аудит ступенчатой нейтрализации: ${item[0]}`, () => predicted(item[0], { solvent: 'aqueous', ratio: 'deficit' }, item[1], item[2]));
}

for (const item of [
  ['5CH3CHO + 2KMnO4 + 3H2SO4', { medium: 'acidic', solvent: 'aqueous' }, '5CH3CHO + 2KMnO4 + 3H2SO4 → 5CH3COOH + 2MnSO4 + K2SO4 + 3H2O'],
  ['3CH2=CH2 + 2KMnO4 + 4H2O', { medium: 'neutral', solvent: 'aqueous' }, '3C2H4 + 2KMnO4 + 4H2O → 3HOCH2CH2OH + 2MnO2↓ + 2KOH'],
  ['5CH3-CH2-OH + 4KMnO4 + 6H2SO4', { medium: 'acidic', solvent: 'aqueous', heating: true }, '5CH3CH2OH + 4KMnO4 + 6H2SO4 → 5CH3COOH + 4MnSO4 + 2K2SO4 + 11H2O'],
  ['C6H12O6 + 6O2', { solvent: 'gas', heating: true }, 'C6H12O6 + 6O2 → 6CO2 + 6H2O']
]) {
  test(`Аудит органической реакции: ${item[0]}`, () => predicted(...item));
}

test('альдегид имеет согласованный перенос электронов при окислении до кислоты', () => {
  const redox = analyzeRedox(parseEquation('5CH3CHO + 2KMnO4 + 3H2SO4 = 5CH3COOH + 2MnSO4 + K2SO4 + 3H2O'));
  assert.equal(redox.complete, true);
  assert.equal(redox.electronBalance, true);
  assert.equal(redox.electronsLost.toNumber(), 10);
  assert.equal(redox.electronsGained.toNumber(), 10);
  assert.ok(redox.transitions.includes('C: +1 → +3'));
  assert.equal(redox.oxidations.find((event) => event.symbol === 'C').electronCount.div(5).toNumber(), 2);
});

test('метильная группа этанола не участвует в фиктивном переносе электронов', () => {
  const redox = analyzeRedox(parseEquation('CH3CH2OH + CuO = CH3CHO + Cu + H2O'));
  assert.equal(redox.electronBalance, true);
  assert.ok(redox.transitions.includes('C: −1 → +1'));
  assert.equal(redox.electronsLost.toNumber(), 2);
  assert.equal(redox.electronsGained.toNumber(), 2);
});

for (const item of [
  ['PCl5 + 4H2O', 'PCl5 + 4H2O → H3PO4 + 5HCl', 'PCl₅ + 4H₂O → H₃PO₄ + 5H⁺ + 5Cl⁻'],
  ['SiCl4 + 2H2O', 'SiCl4 + 2H2O → SiO2↓ + 4HCl', 'SiCl₄ + 2H₂O → SiO₂↓ + 4H⁺ + 4Cl⁻'],
  ['Al4C3 + 12H2O', 'Al4C3 + 12H2O → 4Al(OH)3↓ + 3CH4↑', null],
  ['Ca3P2 + 6H2O', 'Ca3P2 + 6H2O → 3Ca(OH)2 + 2PH3↑', null]
]) {
  test(`Аудит гидролиза: ${item[0]}`, () => predicted(item[0], { solvent: 'aqueous' }, item[1], item[2]));
}

for (const [alias, canonical, water, expected] of [
  ['CuSO45H2O', 'CuSO4·5H2O', 5, 'CuSO4·5H2O → CuSO4 + 5H2O'],
  ['FeSO47H2O', 'FeSO4·7H2O', 7, 'FeSO4·7H2O → FeSO4 + 7H2O'],
  ['Na2CO310H2O', 'Na2CO3·10H2O', 10, 'Na2CO3·10H2O → Na2CO3 + 10H2O']
]) {
  test(`Дегидратация и молярная масса: ${alias}`, () => {
    const species = parseSpecies(alias);
    assert.equal(species.baseFormula, canonical);
    assert.equal(species.molarMass, parseSpecies(canonical).molarMass);
    assert.equal(species.atoms.get('H'), water * 2);
    predicted(alias, { solvent: 'melt', heating: true }, expected);
  });
}

test('коэффициент кристаллогидрата сохраняется при дегидратации', () => {
  predicted('2Na2CO310H2O', { solvent: 'melt', heating: true }, '2Na2CO3·10H2O → 2Na2CO3 + 20H2O');
});

test('структурные обозначения нормализуются только по поддержанному списку', () => {
  assert.equal(parseSpecies('CH2=CH2').formula, 'C2H4');
  assert.equal(parseSpecies('CH2(OH)-CH2(OH)').formula, 'HOCH2CH2OH');
  assert.equal(parseSpecies('CH3-CH2-OH').formula, 'CH3CH2OH');
  assert.throws(() => parseSpecies('CH3-CH2-NH2'), /Недопустимый символ/);
});
