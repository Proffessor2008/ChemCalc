import solubilityData from '../data/solubility.json' with { type: 'json' };
import communityData from '../data/reaction-rules-community.json' with { type: 'json' };
import { parseFormula } from './parser.js';

const ANIONS = new Map([
  ['Cl', -1], ['Br', -1], ['I', -1], ['NO3', -1], ['NO2', -1], ['ClO', -1], ['ClO3', -1], ['ClO4', -1], ['HSO4', -1],
  ['SO4', -2], ['SO3', -2], ['CO3', -2], ['S', -2], ['CrO4', -2], ['Cr2O7', -2], ['MnO4', [-1, -2]], ['FeO4', -2],
  ['PO4', -3], ['HPO4', -2], ['H2PO4', -1], ['HCO3', -1], ['HSO3', -1], ['HS', -1], ['CH3COO', -1], ['HCOO', -1]
].map(([base, charges]) => [base, (Array.isArray(charges) ? charges : [charges]).map((charge) => ({
  formula: `${base}^${Math.abs(charge) === 1 ? '' : Math.abs(charge)}-`,
  coefficient: 1
}))]));

function inferredSalt(formula) {
  if (formula.includes('[') || formula.includes('·') || formula.includes('^')) return null;
  const match = formula.match(/^(?:\(NH4\)(\d+)|NH4|(Li|Na|K|Rb|Cs))(\d*)(.*)$/);
  if (!match || !match[4] || match[4].includes('(')) return null;
  const [, ammoniumCount, alkali, countText, anionBase] = match;
  const candidates = ANIONS.get(anionBase);
  if (!candidates) return null;
  const cationCount = Number(ammoniumCount || countText || 1);
  for (const anion of candidates) {
    const anionCount = 1;
    const ions = [
      { formula: alkali ? `${alkali}^+` : 'NH4^+', coefficient: cationCount },
      { formula: anion.formula, coefficient: anionCount }
    ];
    const expectedAtoms = new Map();
    let charge = 0;
    for (const ion of ions) {
      const parsed = parseFormula(ion.formula);
      charge += parsed.charge * ion.coefficient;
      for (const [symbol, count] of parsed.atoms) expectedAtoms.set(symbol, (expectedAtoms.get(symbol) || 0) + count * ion.coefficient);
    }
    const parentAtoms = parseFormula(formula).atoms;
    if (charge !== 0 || expectedAtoms.size !== parentAtoms.size || [...expectedAtoms].some(([symbol, count]) => parentAtoms.get(symbol) !== count)) continue;
    return {
      source: 'Глинка, Общая химия: типовые соли щелочных металлов и аммония; ионный состав проверен по формуле',
      solubility: 'Р',
      strong: true,
      inferred: true,
      ions,
      note: 'Правило ограничено известными неорганическими анионами; специфические малорастворимые и комплексные соли не выводятся автоматически'
    };
  }
  return null;
}

export function electrolyteRecord(formula) {
  return solubilityData.substances[formula] || communityData.solubility.substances[formula] || inferredSalt(formula);
}

export function isStrongElectrolyte(formula) {
  const record = electrolyteRecord(formula);
  return Boolean(record?.strong && ['Р', 'М'].includes(record.solubility) && record.ions);
}
