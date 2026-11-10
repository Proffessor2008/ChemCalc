import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIonicEquations, ionicForUnbalanced } from '../js/ionic.js';
import { equationToUnicode, parseEquation } from '../js/parser.js';

const cases = [
  { id: '1.1', input: 'AgNO3 + NaCl = AgCl + NaNO3', full: 'Ag^+ + NO3^- + Na^+ + Cl^- = AgCl + Na^+ + NO3^-', net: 'Ag^+ + Cl^- = AgCl' },
  { id: '1.2', input: '2KMnO4 + 10FeSO4 + 8H2SO4 = K2SO4 + 2MnSO4 + 5Fe2(SO4)3 + 8H2O', full: '2K^+ + 2MnO4^- + 10Fe^2+ + 10SO4^2- + 16H^+ + 8SO4^2- = 2K^+ + SO4^2- + 2Mn^2+ + 2SO4^2- + 10Fe^3+ + 15SO4^2- + 8H2O', net: 'MnO4^- + 5Fe^2+ + 8H^+ = Mn^2+ + 5Fe^3+ + 4H2O' },
  { id: '1.3', input: 'KOH + HCl = H2O + KCl', full: 'K^+ + OH^- + H^+ + Cl^- = H2O + K^+ + Cl^-', net: 'H^+ + OH^- = H2O' },
  { id: '1.4', input: 'CH3COOH + NaOH = CH3COONa + H2O', full: 'CH3COOH + Na^+ + OH^- = CH3COO^- + Na^+ + H2O', net: 'CH3COOH + OH^- = CH3COO^- + H2O' },
  { id: '1.5', input: 'Na2CO3 + 2HCl = CO2 + H2O + 2NaCl', full: '2Na^+ + CO3^2- + 2H^+ + 2Cl^- = CO2 + H2O + 2Na^+ + 2Cl^-', net: 'CO3^2- + 2H^+ = CO2 + H2O' },
  { id: '1.6', input: 'Cu(OH)2 + H2SO4 = CuSO4 + 2H2O', full: 'Cu(OH)2 + 2H^+ + SO4^2- = Cu^2+ + SO4^2- + 2H2O', net: 'Cu(OH)2 + 2H^+ = Cu^2+ + 2H2O' },
  { id: '1.7', input: 'K2S + 2HCl = H2S + 2KCl', full: '2K^+ + S^2- + 2H^+ + 2Cl^- = H2S + 2K^+ + 2Cl^-', net: 'S^2- + 2H^+ = H2S' },
  { id: '1.8', input: 'KHSO4 + KOH = K2SO4 + H2O', full: 'K^+ + H^+ + SO4^2- + K^+ + OH^- = 2K^+ + SO4^2- + H2O', net: 'H^+ + OH^- = H2O' }
];

for (const item of cases) {
  test(`Ионное уравнение ${item.id}: полное и краткое`, () => {
    const result = ionicForUnbalanced(item.input);
    assert.equal(result.status, 'ok');
    assert.equal(result.fullUnicode, equationToUnicode(parseEquation(item.full)));
    assert.equal(result.netUnicode, equationToUnicode(parseEquation(item.net)));
  });
}

test('2K2FeO4 диссоциирует в 4K+ и 2FeO4^2-', () => {
  const result = buildIonicEquations('2K2FeO4 = 2K2FeO4');
  assert.equal(result.fullUnicode, '4K⁺ + 2FeO₄²⁻ → 4K⁺ + 2FeO₄²⁻');
  assert.equal(result.status, 'no-net-reaction');
});
