import potentialsData from '../data/electrode-potentials.json' with { type: 'json' };
import { inspectBalance } from './balancer.js';
import { equationToUnicode, parseSpecies } from './parser.js';
import { nernst } from './physical-constants.js';
import { t } from './i18n.js';

const MEDIUM_SPECIES = new Set(['H2O', 'H^+', 'OH^-']);

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function lcm(a, b) {
  return a / gcd(a, b) * b;
}

function addSpecies(map, formula, coefficient) {
  if (!coefficient) return;
  map.set(formula, (map.get(formula) || 0) + coefficient);
  if (!map.get(formula)) map.delete(formula);
}

function cancelSpecies(left, right) {
  for (const [formula, coefficient] of left) {
    const cancelled = Math.min(coefficient, right.get(formula) || 0);
    addSpecies(left, formula, -cancelled);
    addSpecies(right, formula, -cancelled);
  }
}

function supportsMedium(record, medium) {
  if (record.id === 'permanganate-neutral') return medium === 'neutral';
  if (record.id === 'permanganate-alkaline') return medium === 'alkaline';
  if (record.medium === medium) return true;
  if (record.medium === 'alkaline' && medium === 'neutral') return true;
  if (record.medium !== 'acidic') return false;
  return [record.oxidized, record.reduced].every((formula) => {
    const species = parseSpecies(formula);
    return !species.atoms.has('H') && !species.atoms.has('O');
  });
}

function supportsConditions(record, medium, conditions) {
  if (!supportsMedium(record, medium)) return false;
  return !record.acidConcentration || record.acidConcentration === conditions.acidConcentration;
}

function mapToEquation(left, right) {
  return {
    left: [...left].map(([formula, coefficient]) => ({ ...parseSpecies(formula), coefficient })),
    right: [...right].map(([formula, coefficient]) => ({ ...parseSpecies(formula), coefficient })),
    separator: '→'
  };
}

function formatHalfReaction(left, right) {
  return equationToUnicode(mapToEquation(left, right));
}

function balanceHalfReaction(record, direction, medium) {
  const reduction = direction === 'reduction';
  const fromFormula = reduction ? record.oxidized : record.reduced;
  const toFormula = reduction ? record.reduced : record.oxidized;
  const from = parseSpecies(fromFormula);
  const to = parseSpecies(toFormula);
  const fromCount = from.atoms.get(record.element) || 0;
  const toCount = to.atoms.get(record.element) || 0;
  if (!fromCount || !toCount) return null;
  const multiplier = lcm(fromCount, toCount);
  const fromCoefficient = multiplier / fromCount;
  const toCoefficient = multiplier / toCount;
  for (const symbol of new Set([...from.atoms.keys(), ...to.atoms.keys()])) {
    if ([record.element, 'H', 'O'].includes(symbol)) continue;
    if ((from.atoms.get(symbol) || 0) * fromCoefficient !== (to.atoms.get(symbol) || 0) * toCoefficient) return null;
  }
  const signedAtoms = (symbol) => (to.atoms.get(symbol) || 0) * toCoefficient - (from.atoms.get(symbol) || 0) * fromCoefficient;
  const oxygen = signedAtoms('O');
  const hydrogen = signedAtoms('H');
  const basic = medium !== 'acidic';
  const water = basic ? oxygen - hydrogen : -oxygen;
  const mediumIon = basic ? hydrogen - 2 * oxygen : -hydrogen - 2 * water;
  const left = new Map([[fromFormula, fromCoefficient]]);
  const right = new Map([[toFormula, toCoefficient]]);
  addSpecies(water > 0 ? right : left, 'H2O', Math.abs(water));
  const ionFormula = basic ? 'OH^-' : 'H^+';
  addSpecies(mediumIon > 0 ? right : left, ionFormula, Math.abs(mediumIon));
  const charge = to.charge * toCoefficient - from.charge * fromCoefficient + (basic ? -mediumIon : mediumIon);
  addSpecies(charge > 0 ? right : left, 'e^-', Math.abs(charge));
  cancelSpecies(left, right);
  const equation = mapToEquation(left, right);
  if (!inspectBalance(equation).isBalanced) return null;
  const electrons = [...(reduction ? left : right)].find(([formula]) => formula === 'e^-')?.[1] || 0;
  if (!electrons || [...(reduction ? right : left)].some(([formula]) => formula === 'e^-')) return null;
  return { left, right, electrons, record, direction };
}

function scaleHalfReaction(halfReaction, factor) {
  return {
    left: new Map([...halfReaction.left].map(([formula, coefficient]) => [formula, coefficient * factor])),
    right: new Map([...halfReaction.right].map(([formula, coefficient]) => [formula, coefficient * factor]))
  };
}

function combineHalfReactions(reduction, oxidation) {
  const electronMultiple = lcm(reduction.electrons, oxidation.electrons);
  const reductionScale = electronMultiple / reduction.electrons;
  const oxidationScale = electronMultiple / oxidation.electrons;
  const scaledReduction = scaleHalfReaction(reduction, reductionScale);
  const scaledOxidation = scaleHalfReaction(oxidation, oxidationScale);
  const left = new Map();
  const right = new Map();
  for (const halfReaction of [scaledReduction, scaledOxidation]) {
    for (const [formula, coefficient] of halfReaction.left) if (formula !== 'e^-') addSpecies(left, formula, coefficient);
    for (const [formula, coefficient] of halfReaction.right) if (formula !== 'e^-') addSpecies(right, formula, coefficient);
  }
  cancelSpecies(left, right);
  if (!left.size || !right.size) return null;
  const divisor = [...left, ...right].map(([, coefficient]) => coefficient).reduce(gcd);
  if (divisor > 1) {
    for (const [formula, coefficient] of left) left.set(formula, coefficient / divisor);
    for (const [formula, coefficient] of right) right.set(formula, coefficient / divisor);
  }
  const equation = mapToEquation(left, right);
  if (!inspectBalance(equation).isBalanced) return null;
  return {
    left: [...left].map(([formula, coefficient]) => ({ formula, coefficient })),
    right: [...right].map(([formula, coefficient]) => ({ formula, coefficient })),
    halfReactions: [
      `${t('reductionHalf')}: ${formatHalfReaction(scaledReduction.left, scaledReduction.right)}`,
      `${t('oxidationHalf')}: ${formatHalfReaction(scaledOxidation.left, scaledOxidation.right)}`
    ],
    electrons: electronMultiple / divisor
  };
}

const PURE_FORMULAS = new Set(['H2O', 'S', 'I2', 'AgCl', 'PbO2', 'MnO2', 'Cu', 'Zn', 'Fe', 'Pb', 'Ag', 'Na', 'K', 'Al', 'Mn', 'Co', 'Ni', 'Mg', 'Ca', 'Ba', 'W', 'Hg', 'Pt', 'Au', 'Si']);

function reactionQuotient(combined, activities) {
  const multiply = (items) => items.reduce((product, item) => {
    const species = parseSpecies(item.formula);
    if (PURE_FORMULAS.has(item.formula) || species.state === 's' || species.state === 'l' || species.annotation === '↓') return product;
    const value = Number(activities[item.formula] ?? 1);
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(t('activityPositive', { formula: item.formula }));
    return product * value ** item.coefficient;
  }, 1);
  const numerator = multiply(combined.right);
  const denominator = multiply(combined.left);
  const quotient = numerator / denominator;
  if (!Number.isFinite(quotient) || quotient <= 0) throw new RangeError(t('quotientPositive'));
  return quotient;
}

export function predictIonicRedox(input, conditions = {}) {
  if (!Array.isArray(input) || !input.length || conditions.solvent !== 'aqueous') return null;
  const medium = input.some((item) => item.formula === 'H^+')
    ? 'acidic'
    : input.some((item) => item.formula === 'OH^-') ? 'alkaline' : conditions.medium || 'neutral';
  const records = potentialsData.records.filter((record) => supportsConditions(record, medium, conditions));
  const candidates = [];
  for (const reduction of input) {
    for (const oxidation of input) {
      for (const reductionRecord of records.filter((record) => record.oxidized === reduction.formula)) {
        for (const oxidationRecord of records.filter((record) => record.reduced === oxidation.formula)) {
          if (reductionRecord.id === oxidationRecord.id) continue;
          if (reduction === oxidation && !oxidationRecord.allowDisproportionation) continue;
          const unused = input.filter((item) => item !== reduction && item !== oxidation && !MEDIUM_SPECIES.has(item.formula));
          if (unused.length) continue;
          candidates.push({ reduction, oxidation, reductionRecord, oxidationRecord, E0_V: reductionRecord.E0_V - oxidationRecord.E0_V, selectPriority: Math.max(reductionRecord.selectPriority || 0, oxidationRecord.selectPriority || 0) });
        }
      }
    }
  }
  if (!candidates.length) {
    if ((conditions.acidConcentration || 'unspecified') === 'unspecified' && input.some((item) => ['NO3^-', 'SO4^2-'].includes(item.formula))) {
      return { status: 'needs-conditions', message: t('nitrateConcentrationRequired') };
    }
    return null;
  }
  const activities = conditions.activities || {};
  const evaluated = [];
  try {
    for (const candidate of candidates) {
      const reduction = balanceHalfReaction(candidate.reductionRecord, 'reduction', medium);
      const oxidation = balanceHalfReaction(candidate.oxidationRecord, 'oxidation', medium);
      if (!reduction || !oxidation) continue;
      const combined = combineHalfReactions(reduction, oxidation);
      if (!combined) continue;
      const quotient = reactionQuotient(combined, activities);
      const E_V = nernst(candidate.E0_V, combined.electrons, quotient, conditions.temperatureK || 298.15).E;
      evaluated.push({ ...candidate, combined, E_V, quotient });
    }
  } catch (error) {
    return { status: 'needs-conditions', message: error.message };
  }
  if (!evaluated.length) return null;
  evaluated.sort((a, b) => b.selectPriority - a.selectPriority || b.E_V - a.E_V);
  const best = evaluated[0];
  if (best.E_V <= 0) return { status: 'no-reaction', E0_V: best.E0_V, E_V: best.E_V, quotient: best.quotient, medium };
  return {
    status: 'predicted',
    ...best.combined,
    coefficients: [...best.combined.left, ...best.combined.right].map((item) => item.coefficient),
    E0_V: best.E0_V,
    E_V: best.E_V,
    quotient: best.quotient,
    medium,
    source: [...new Set([best.reductionRecord.source, best.oxidationRecord.source])].join('; ')
  };
}
