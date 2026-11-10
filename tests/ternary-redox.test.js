import test from 'node:test';
import assert from 'node:assert/strict';
import { predictReaction } from '../js/predictor.js';
import { buildIonicEquations } from '../js/ionic.js';
import { electrolyteRecord } from '../js/electrolytes.js';
import { inspectBalance } from '../js/balancer.js';
import { parseFormula } from '../js/parser.js';

function ionicFor(prediction) {
  return buildIonicEquations({
    ...prediction.equation,
    left: prediction.equation.left.map((item, index) => ({ ...item, coefficient: prediction.coefficients[index] })),
    right: prediction.equation.right.map((item, index) => ({ ...item, coefficient: prediction.coefficients[prediction.equation.left.length + index] }))
  });
}

for (const [base, cation] of [['KOH', 'K'], ['NaOH', 'Na']]) {
  test(`Cr(III) окисляется пероксидом в ${base}`, () => {
    const prediction = predictReaction(`CrCl3 + H2O2 + ${base}`, { medium: 'alkaline', solvent: 'aqueous', heating: true });
    assert.equal(prediction.status, 'predicted', prediction.message);
    assert.equal(prediction.formatted, `2CrCl3 + 3H2O2 + 10${base} → 2${cation}2CrO4 + 6${cation}Cl + 8H2O`);
    const ionic = ionicFor(prediction);
    assert.equal(ionic.fullUnicode, `2Cr³⁺ + 6Cl⁻ + 3H₂O₂ + 10${cation}⁺ + 10OH⁻ → 4${cation}⁺ + 2CrO₄²⁻ + 6${cation}⁺ + 6Cl⁻ + 8H₂O`);
    assert.equal(ionic.netUnicode, '2Cr³⁺ + 3H₂O₂ + 10OH⁻ → 2CrO₄²⁻ + 8H₂O');
    assert.ok(ionic.spectators.some((ion) => ion.formula === `${cation}^+` && ion.coefficient === 10));
    assert.ok(inspectBalance(ionic.netEquation).isBalanced);
  });
}

test('Cr2(SO4)3 использует тот же трёхкомпонентный механизм', () => {
  const prediction = predictReaction('Cr2(SO4)3 + H2O2 + KOH', { solvent: 'aqueous', heating: true });
  assert.equal(prediction.formatted, 'Cr2(SO4)3 + 3H2O2 + 10KOH → 2K2CrO4 + 3K2SO4 + 8H2O');
  assert.equal(ionicFor(prediction).netUnicode, '2Cr³⁺ + 3H₂O₂ + 10OH⁻ → 2CrO₄²⁻ + 8H₂O');
});

test('Mn(II) в щёлочи окисляется до MnO2 без фиктивных ионных остатков', () => {
  const prediction = predictReaction('MnSO4 + H2O2 + KOH', { medium: 'alkaline', solvent: 'aqueous', heating: true });
  assert.equal(prediction.formatted, 'MnSO4 + H2O2 + 2KOH → MnO2↓ + K2SO4 + 2H2O');
  assert.equal(ionicFor(prediction).netUnicode, 'Mn²⁺ + H₂O₂ + 2OH⁻ → MnO₂↓ + 2H₂O');
});

test('перманганат окисляет бромид в трёхкомпонентной кислой системе', () => {
  const prediction = predictReaction('2KMnO4 + 10KBr + 8H2SO4', { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(prediction.formatted, '2KMnO4 + 10KBr + 8H2SO4 → 2MnSO4 + 5Br2 + 6K2SO4 + 8H2O');
  assert.equal(ionicFor(prediction).netUnicode, '2MnO₄⁻ + 10Br⁻ + 16H⁺ → 2Mn²⁺ + 5Br₂ + 8H₂O');
});

test('дихромат окисляет FeSO4 с автоматическим выводом сульфатов', () => {
  const prediction = predictReaction('K2Cr2O7 + 6FeSO4 + 7H2SO4', { medium: 'acidic', solvent: 'aqueous' });
  assert.equal(prediction.formatted, 'K2Cr2O7 + 6FeSO4 + 7H2SO4 → Cr2(SO4)3 + 3Fe2(SO4)3 + K2SO4 + 7H2O');
  assert.equal(ionicFor(prediction).netUnicode, 'Cr₂O₇²⁻ + 6Fe²⁺ + 14H⁺ → 2Cr³⁺ + 6Fe³⁺ + 7H₂O');
});

test('типовые соли щелочных металлов и аммония распознаются по ионному составу', () => {
  for (const [formula, cation, anion] of [
    ['K2CrO4', 'K^+', 'CrO4^2-'], ['Li2CrO4', 'Li^+', 'CrO4^2-'], ['RbNO3', 'Rb^+', 'NO3^-'],
    ['CsI', 'Cs^+', 'I^-'], ['Na2MnO4', 'Na^+', 'MnO4^2-'], ['NaMnO4', 'Na^+', 'MnO4^-'],
    ['(NH4)2CrO4', 'NH4^+', 'CrO4^2-'], ['NH4I', 'NH4^+', 'I^-']
  ]) {
    const record = electrolyteRecord(formula);
    assert.ok(record?.strong, formula);
    assert.ok(record.ions.some((ion) => ion.formula === cation), formula);
    assert.ok(record.ions.some((ion) => ion.formula === anion), formula);
    let charge = 0;
    for (const ion of record.ions) charge += parseFormula(ion.formula).charge * ion.coefficient;
    assert.equal(charge, 0, formula);
  }
  assert.equal(electrolyteRecord('K3[Fe(CN)6]'), null);
  assert.equal(electrolyteRecord('Na2Cl'), null);
  for (const formula of ['LiF', 'Li2CO3', 'Li3PO4']) assert.equal(electrolyteRecord(formula).strong, false, formula);
});
