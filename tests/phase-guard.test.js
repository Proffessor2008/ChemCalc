import test from 'node:test';
import assert from 'node:assert/strict';
import { predictReaction } from '../js/predictor.js';
import { buildIonicEquations, ionicForUnbalanced } from '../js/ionic.js';
import { inspectBalance } from '../js/balancer.js';

const aqueousCases = [
  ['NaCl + AgNO3', 'NaCl + AgNO3 → AgCl↓ + NaNO3'],
  ['BaCl2 + Na2SO4', 'BaCl2 + Na2SO4 → BaSO4↓ + 2NaCl'],
  ['KI + Pb(NO3)2', '2KI + Pb(NO3)2 → 2KNO3 + PbI2↓'],
  ['CuSO4 + 2KOH', 'CuSO4 + 2KOH → Cu(OH)2↓ + K2SO4'],
  ['HCl + NaOH', 'HCl + NaOH → NaCl + H2O'],
  ['HNO3 + KOH', 'HNO3 + KOH → KNO3 + H2O'],
  ['CH3COONa + HCl', 'CH3COONa + HCl → CH3COOH + NaCl'],
  ['CH3COOK + HNO3', 'CH3COOK + HNO3 → CH3COOH + KNO3'],
  ['HCOONa + HCl', 'HCOONa + HCl → HCOOH + NaCl'],
  ['HCOOK + HNO3', 'HCOOK + HNO3 → HCOOH + KNO3'],
  ['Na2CO3 + 2HCl', 'Na2CO3 + 2HCl → 2NaCl + H2O + CO2↑'],
  ['NaHCO3 + NaOH', 'NaHCO3 + NaOH → Na2CO3 + H2O'],
  ['NH4Cl + NaOH', 'NH4Cl + NaOH → NaCl + NH3↑ + H2O', { heating: true }],
  ['AlCl3 + NaOH', 'AlCl3 + 4NaOH → Na[Al(OH)4] + 3NaCl'],
  ['Al(OH)3 + KOH', 'Al(OH)3 + KOH → K[Al(OH)4]'],
  ['CO2 + 2NaOH', 'CO2 + 2NaOH → Na2CO3 + H2O'],
  ['SO2 + 2NaOH', 'SO2 + 2NaOH → Na2SO3 + H2O'],
  ['PCl5 + 4H2O', 'PCl5 + 4H2O → H3PO4 + 5HCl'],
  ['Na2SiO3 + 2HCl', 'Na2SiO3 + 2HCl → 2NaCl + H2SiO3↓'],
  ['Na2S + 2HCl', 'Na2S + 2HCl → 2NaCl + H2S↑'],
  ['K2S + 2HCl', 'K2S + 2HCl → 2KCl + H2S↑'],
  ['Na2SO3 + H2SO4', 'Na2SO3 + H2SO4 → Na2SO4 + SO2↑ + H2O'],
  ['K2SO3 + H2SO4', 'K2SO3 + H2SO4 → K2SO4 + SO2↑ + H2O'],
  ['FeS + 2HCl', 'FeS + 2HCl → FeCl2 + H2S↑'],
  ['CaCO3 + 2HCl', 'CaCO3 + 2HCl → CaCl2 + H2O + CO2↑'],
  ['K2Cr2O7 + 6FeSO4 + 7H2SO4', 'K2Cr2O7 + 6FeSO4 + 7H2SO4 → Cr2(SO4)3 + 3Fe2(SO4)3 + K2SO4 + 7H2O', { medium: 'acidic' }],
  ['2KMnO4 + 10KBr + 8H2SO4', '2KMnO4 + 10KBr + 8H2SO4 → 2MnSO4 + 5Br2 + 6K2SO4 + 8H2O', { medium: 'acidic' }],
  ['CrCl3 + H2O2 + KOH', '2CrCl3 + 3H2O2 + 10KOH → 2K2CrO4 + 6KCl + 8H2O', { heating: true }],
  ['Fe + CuSO4', 'Fe + CuSO4 → FeSO4 + Cu'],
  ['Zn + 2HCl', 'Zn + 2HCl → ZnCl2 + H2↑'],
  ['Na2S2O3 + H2SO4', 'Na2S2O3 + H2SO4 → S↓ + SO2↑ + H2O + Na2SO4']
];

for (const [reactants, expected, extra = {}] of aqueousCases) {
  test(`водный контроль: ${reactants}`, () => {
    const result = predictReaction(reactants, { solvent: 'aqueous', ...extra });
    assert.equal(result.status, 'predicted', result.message);
    assert.equal(result.formatted, expected);
    assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  });
  for (const solvent of ['organic', 'melt', 'gas']) {
    test(`фаза ${solvent} блокирует водный механизм: ${reactants}`, () => {
      const result = predictReaction(reactants, { solvent, ...extra });
      assert.equal(result.status, 'no-reaction', result.message);
      assert.equal(result.ruleId, 'non-aqueous-solvent');
      assert.equal(result.conditions.solvent, solvent);
      assert.equal(result.formatted, undefined);
      assert.match(result.message, /водный ионный механизм/);
    });
    test(`ионный модуль запрещён для ${solvent}: ${reactants}`, () => {
      const ionic = buildIonicEquations(expected.replace('→', '='), { solvent });
      assert.equal(ionic.status, 'unavailable');
      assert.equal(ionic.message, 'Ионные уравнения не составляются для безводных сред.');
    });
  }
}

const phaseSpecificCases = [
  ['2NH3 + 3CuO', { solvent: 'gas', heating: true }, '2NH3 + 3CuO → 3Cu + N2↑ + 3H2O'],
  ['CaCO3', { solvent: 'melt', heating: true }, 'CaCO3 → CaO + CO2↑'],
  ['CuSO45H2O', { solvent: 'melt', heating: true }, 'CuSO4·5H2O → CuSO4 + 5H2O'],
  ['FeSO47H2O', { solvent: 'melt', heating: true }, 'FeSO4·7H2O → FeSO4 + 7H2O'],
  ['Na2CO310H2O', { solvent: 'melt', heating: true }, 'Na2CO3·10H2O → Na2CO3 + 10H2O'],
  ['KClO3', { solvent: 'melt', heating: true, catalyst: 'MnO2' }, '2KClO3 → 2KCl + 3O2↑'],
  ['NH4NO3', { solvent: 'melt', heating: true }, 'NH4NO3 → N2O↑ + 2H2O'],
  ['NaCl', { solvent: 'melt', current: true }, '2NaCl → 2Na + Cl2↑'],
  ['2Na + Cl2', { solvent: 'gas', heating: true }, '2Na + Cl2 → 2NaCl'],
  ['C + O2', { solvent: 'gas', heating: true }, 'C + O2 → CO2'],
  ['H2 + Cl2', { solvent: 'gas', heating: true }, 'H2 + Cl2 → 2HCl'],
  ['Fe + S', { solvent: 'gas', heating: true }, 'Fe + S → FeS'],
  ['2K + Br2', { solvent: 'gas', heating: true }, '2K + Br2 → 2KBr'],
  ['Ca + Cl2', { solvent: 'gas', heating: true }, 'Ca + Cl2 → CaCl2'],
  ['Mg + Br2', { solvent: 'gas', heating: true }, 'Mg + Br2 → MgBr2'],
  ['2Al + 3Cl2', { solvent: 'gas', heating: true }, '2Al + 3Cl2 → 2AlCl3'],
  ['Zn + Br2', { solvent: 'gas', heating: true }, 'Zn + Br2 → ZnBr2'],
  ['2Na + I2', { solvent: 'gas', heating: true }, '2Na + I2 → 2NaI'],
  ['2K + I2', { solvent: 'gas', heating: true }, '2K + I2 → 2KI'],
  ['2Al + 3S', { solvent: 'gas', heating: true }, '2Al + 3S → Al2S3'],
  ['Mg + S', { solvent: 'gas', heating: true }, 'Mg + S → MgS'],
  ['Ca + S', { solvent: 'gas', heating: true }, 'Ca + S → CaS'],
  ['Zn + S', { solvent: 'gas', heating: true }, 'Zn + S → ZnS'],
  ['Cu + Cl2', { solvent: 'gas', heating: true }, 'Cu + Cl2 → CuCl2'],
  ['2Fe + 3Cl2', { solvent: 'gas', heating: true }, '2Fe + 3Cl2 → 2FeCl3'],
  ['NaCl', { solvent: 'aqueous', current: true }, '2NaCl + 2H2O → 2NaOH + H2↑ + Cl2↑']
];

for (const [reactants, conditions, expected] of phaseSpecificCases) {
  test(`явное фазовое правило разрешено: ${reactants}`, () => {
    const result = predictReaction(reactants, conditions);
    assert.equal(result.status, 'predicted', result.message);
    assert.equal(result.formatted, expected);
    assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
  });
}

for (const solvent of ['organic', 'melt', 'gas']) {
  test(`ionicForUnbalanced также получает фазу ${solvent}`, () => {
    const result = ionicForUnbalanced('NaCl + AgNO3 = AgCl + NaNO3', { solvent });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.message, 'Ионные уравнения не составляются для безводных сред.');
  });
}

const conditionCases = [
  ['разбавленная и концентрированная HNO3', 'Cu + HNO3', { acidConcentration: 'dilute' }, { acidConcentration: 'concentrated' }, 'NO↑', 'NO2↑'],
  ['холодная и горячая щёлочь', 'Cl2 + NaOH', { heating: false }, { heating: true }, 'NaClO', 'NaClO3'],
  ['пассивация и нагревание', 'Fe + HNO3', { acidConcentration: 'concentrated', heating: false }, { acidConcentration: 'concentrated', heating: true }, 'пассивация', 'Fe(NO3)3'],
  ['соотношение AlCl3 : NaOH', 'AlCl3 + NaOH', { ratio: 'deficit' }, { ratio: 'normal' }, 'Al(OH)3', 'Na[Al(OH)4]'],
  ['соотношение H3PO4 : KOH', 'H3PO4 + KOH', { ratio: 'deficit' }, { ratio: 'normal' }, 'KH2PO4', 'K3PO4']
];

for (const [name, reactants, first, second, firstText, secondText] of conditionCases) {
  test(`условия действительно меняют продукты: ${name}`, () => {
    const a = predictReaction(reactants, { solvent: 'aqueous', ...first });
    const b = predictReaction(reactants, { solvent: 'aqueous', ...second });
    assert.equal(a.status === 'predicted' || a.status === 'no-reaction', true);
    assert.equal(b.status, 'predicted', b.message);
    assert.notEqual(a.formatted || a.message, b.formatted);
    assert.ok((a.formatted || a.message).includes(firstText));
    assert.ok(b.formatted.includes(secondText));
    for (const solvent of ['organic', 'melt', 'gas']) {
      assert.equal(predictReaction(reactants, { solvent, ...first }).status, 'no-reaction');
      assert.equal(predictReaction(reactants, { solvent, ...second }).status, 'no-reaction');
    }
  });
}

for (const medium of ['acidic', 'neutral', 'alkaline']) {
  test(`среда ${medium} меняет продукты перманганата, но не разрешает органику`, () => {
    const aqueous = predictReaction('KMnO4 + K2SO3', { solvent: 'aqueous', medium });
    assert.equal(aqueous.status, 'predicted', aqueous.message);
    assert.equal(predictReaction('KMnO4 + K2SO3', { solvent: 'organic', medium }).status, 'no-reaction');
    assert.equal(predictReaction('KMnO4 + K2SO3', { solvent: 'gas', medium }).status, 'no-reaction');
  });
}

test('нагревание и катализатор не включают обмен в органической среде', () => {
  for (const options of [
    { heating: true }, { current: true }, { catalyst: 'MnO2', heating: true }, { catalyst: 'V2O5', current: true, heating: true, medium: 'alkaline', acidConcentration: 'concentrated' }
  ]) {
    const result = predictReaction('NaCl + AgNO3', { solvent: 'organic', ...options });
    assert.equal(result.status, 'no-reaction');
  }
});

test('электролиз различает воду, расплав и органическую среду', () => {
  assert.equal(predictReaction('NaCl', { solvent: 'aqueous', current: true }).formatted, '2NaCl + 2H2O → 2NaOH + H2↑ + Cl2↑');
  assert.equal(predictReaction('NaCl', { solvent: 'melt', current: true }).formatted, '2NaCl → 2Na + Cl2↑');
  assert.notEqual(predictReaction('NaCl', { solvent: 'organic', current: true }).status, 'predicted');
  assert.notEqual(predictReaction('NaCl', { solvent: 'gas', current: true }).status, 'predicted');
});

test('термические правила проверяют нагревание и катализатор без влияния на обмен', () => {
  assert.notEqual(predictReaction('CaCO3', { solvent: 'melt', heating: false }).status, 'predicted');
  assert.equal(predictReaction('CaCO3', { solvent: 'melt', heating: true }).status, 'predicted');
  assert.equal(predictReaction('KClO3', { solvent: 'melt', heating: true, catalyst: 'MnO2' }).status, 'predicted');
  assert.notEqual(predictReaction('KClO3', { solvent: 'melt', heating: true, catalyst: '' }).status, 'predicted');
  assert.equal(predictReaction('H2 + Cl2', { solvent: 'gas', heating: true }).status, 'predicted');
  assert.notEqual(predictReaction('H2 + Cl2', { solvent: 'gas', heating: false }).status, 'predicted');
});

const analogies = [
  ['NaCl + AgNO3', 'KCl + AgNO3', 'AgCl↓'],
  ['BaCl2 + Na2SO4', 'BaCl2 + K2SO4', 'BaSO4↓'],
  ['CuSO4 + 2NaOH', 'CuSO4 + 2KOH', 'Cu(OH)2↓'],
  ['CrCl3 + H2O2 + NaOH', 'CrCl3 + H2O2 + KOH', 'CrO4'],
  ['Na2CO3 + 2HCl', 'K2CO3 + 2HNO3', 'CO2↑'],
  ['CH3COONa + HCl', 'CH3COOK + HCl', 'CH3COOH'],
  ['HCOONa + HCl', 'HCOOK + HCl', 'HCOOH'],
  ['KMnO4 + 10KBr + 8H2SO4', 'KMnO4 + 10KI + 8H2SO4', 'MnSO4'],
  ['Na2S + 2HCl', 'K2S + 2HCl', 'H2S↑'],
  ['Na2SO3 + H2SO4', 'K2SO3 + H2SO4', 'SO2↑'],
  ['FeCl3 + 3NaOH', 'FeCl3 + 3KOH', 'Fe(OH)3↓'],
  ['NH4Cl + NaOH', 'NH4Cl + KOH', 'NH3↑'],
  ['NaHCO3 + NaOH', 'KHCO3 + KOH', 'H2O'],
  ['CO2 + 2NaOH', 'CO2 + 2KOH', 'H2O'],
  ['AlCl3 + NaOH', 'AlCl3 + KOH', '[Al(OH)4]'],
  ['Fe + CuSO4', 'Zn + CuSO4', 'Cu']
];

for (const [first, second, product] of analogies) {
  test(`аналогичная химическая схема: ${first} и ${second}`, () => {
    for (const reactants of [first, second]) {
      const options = { solvent: 'aqueous', ...(reactants.includes('H2O2') || reactants.includes('NH4') ? { heating: true } : {}), ...(reactants.includes('KMnO4') ? { medium: 'acidic' } : {}) };
      const result = predictReaction(reactants, options);
      assert.equal(result.status, 'predicted', `${reactants}: ${result.message}`);
      assert.ok(result.formatted.includes(product), result.formatted);
      assert.ok(inspectBalance(result.equation, result.coefficients).isBalanced);
      assert.equal(predictReaction(reactants, { ...options, solvent: 'organic' }).status, 'no-reaction');
    }
  });
}
