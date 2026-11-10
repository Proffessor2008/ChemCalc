import reactionData from '../data/reaction-rules.json' with { type: 'json' };
import finalReactionData from '../data/reaction-rules-final.json' with { type: 'json' };
import communityData from '../data/reaction-rules-community.json' with { type: 'json' };
import solubilityData from '../data/solubility.json' with { type: 'json' };
import { electrolyteRecord } from './electrolytes.js';
import activityData from '../data/activity-series.json' with { type: 'json' };
import substanceData from '../data/substances.json' with { type: 'json' };
import { balanceEquation, inspectBalance } from './balancer.js';
import { FormulaSyntaxError, formatEquation, normalizeReactionNotation, parseEquation, parseFormula, parseSide, parseSpecies } from './parser.js';
import { predictIonicRedox } from './redox-predictor.js';
import { t } from './i18n.js';
import { isNonAqueousSolvent, phasePredictionBlock, requiresAqueousRule } from './reaction-conditions.js';

const RULES = [...finalReactionData.rules, ...reactionData.rules, ...communityData.rules].sort((a, b) => b.priority - a.priority);
const SUBSTANCES = new Map([...substanceData.items, ...communityData.substances].map((item) => [item.formula, item]));
const ACTIVITY = new Map(activityData.order.map((symbol, index) => [symbol, index]));
const WATER_REACTIVE = new Set(['Li', 'K', 'Ba', 'Ca', 'Na']);

export function updateCommunityData(data) {
  if (!data || !Array.isArray(data.rules) || !Array.isArray(data.substances) || !data.solubility?.substances) throw new TypeError('Некорректный пакет правил сообщества');
  for (const item of communityData.substances) SUBSTANCES.delete(item.formula);
  communityData.version = data.version;
  communityData.source = data.source || 'Проверенные правила сообщества';
  communityData.rules.splice(0, communityData.rules.length, ...data.rules);
  communityData.substances.splice(0, communityData.substances.length, ...data.substances);
  for (const key of Object.keys(communityData.solubility.substances)) delete communityData.solubility.substances[key];
  Object.assign(communityData.solubility.substances, data.solubility.substances);
  RULES.splice(0, RULES.length, ...[...finalReactionData.rules, ...reactionData.rules, ...communityData.rules].sort((a, b) => b.priority - a.priority));
  for (const item of communityData.substances) SUBSTANCES.set(item.formula, item);
}

export const DEFAULT_CONDITIONS = Object.freeze({
  medium: 'neutral',
  acidConcentration: 'unspecified',
  heating: false,
  current: false,
  solvent: 'aqueous',
  catalyst: '',
  ratio: 'normal'
});

function countFormulas(species) {
  const counts = new Map();
  for (const item of species) counts.set(item.formula, (counts.get(item.formula) || 0) + 1);
  return counts;
}

function matchesReactants(rule, species) {
  if (rule.inputCoefficients && (rule.inputCoefficients.length !== species.length || rule.inputCoefficients.some((value, index) => value !== species[index].coefficient))) return false;
  const required = new Map();
  for (const formula of rule.reactants) required.set(formula, (required.get(formula) || 0) + 1);
  const optional = new Set(rule.addReactants || []);
  const actual = countFormulas(species);
  for (const [formula, count] of actual) {
    if (required.has(formula)) {
      if (required.get(formula) !== count) return false;
    } else if (!optional.has(formula) || count !== 1) return false;
  }
  return [...required].every(([formula, count]) => actual.get(formula) === count);
}

function matchesConditions(rule, conditions) {
  if (isNonAqueousSolvent(conditions.solvent) && requiresAqueousRule(rule)) return false;
  return Object.entries(rule.when || {}).every(([key, value]) => conditions[key] === value);
}

function ionPart(ion, count) {
  if (count === 1) return ion.baseFormula;
  const atomCount = [...ion.atoms.values()].reduce((sum, value) => sum + value, 0);
  return ion.atoms.size > 1 || atomCount > 1 ? `(${ion.baseFormula})${count}` : `${ion.baseFormula}${count}`;
}

function gcd(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

const SALT_ALIASES = { KCH3COO: 'CH3COOK', NaCH3COO: 'CH3COONa', KHCOO: 'HCOOK', NaHCOO: 'HCOONa' };

export function formulaFromIons(cationFormula, anionFormula) {
  const cation = parseFormula(cationFormula);
  const anion = parseFormula(anionFormula);
  if (cation.charge <= 0 || anion.charge >= 0) throw new RangeError('Нужны формулы катиона и аниона');
  const divisor = gcd(cation.charge, anion.charge);
  const formula = `${ionPart(cation, Math.abs(anion.charge) / divisor)}${ionPart(anion, cation.charge / divisor)}`;
  return SALT_ALIASES[formula] || formula;
}

function saltParts(formula) {
  const record = electrolyteRecord(formula);
  if (!record?.ions || record.ions.length !== 2) return null;
  const cation = record.ions.find((ion) => parseFormula(ion.formula).charge > 0);
  const anion = record.ions.find((ion) => parseFormula(ion.formula).charge < 0);
  return cation && anion ? { cation: cation.formula, anion: anion.formula, record } : null;
}

function equationFromFormulas(input, leftFormulas, rightFormulas, separator = '→') {
  const left = leftFormulas.map((formula) => ({ ...parseSpecies(formula), coefficient: 1 }));
  const right = rightFormulas.map((formula) => parseSpecies(formula));
  return {
    source: `${formatEquation({ left, right: [], separator })} ${separator} ${rightFormulas.join(' + ')}`,
    separator,
    leftSource: leftFormulas.join(' + '),
    rightSource: rightFormulas.join(' + '),
    left,
    right
  };
}

function predictionFromRule(rule, input, conditions) {
  if (rule.outcome === 'no-reaction') return noReaction(rule, `${rule.message}${rule.why?.[0] ? `. ${rule.why[0]}` : ''}`);
  const leftFormulas = rule.left ? [...rule.left] : input.map((item) => item.formula);
  for (const formula of rule.addReactants || []) {
    if (!leftFormulas.includes(formula)) leftFormulas.push(formula);
  }
  const equation = equationFromFormulas(input, leftFormulas, rule.products, rule.separator || '→');
  const balanced = rule.coefficients
    ? inspectBalance(equation, rule.coefficients).isBalanced
      ? { status: 'balanced', coefficients: [...rule.coefficients], formatted: formatEquation(equation, rule.coefficients) }
      : { status: 'invalid-coefficients', message: 'Коэффициенты правила не прошли проверку атомов и заряда' }
    : balanceEquation(equation);
  if (balanced.status !== 'balanced') {
    return {
      status: 'balance-error',
      confidence: 'low',
      message: `Правило «${rule.id}» найдено, но набор веществ не удалось уравнять: ${balanced.message}`,
      ruleId: rule.id
    };
  }
  return {
    status: 'predicted',
    confidence: rule.confidence,
    ruleId: rule.id,
    type: rule.type,
    equation,
    coefficients: balanced.coefficients,
    formatted: balanced.formatted,
    why: [...(rule.why || [])],
    assumptions: [...(rule.assumptions || [])],
    conditions: { ...conditions },
    source: rule.source || reactionData.source,
    notice: t('predictionNotice'),
    ...(rule.ionicOverride ? { ionicOverride: { ...rule.ionicOverride } } : {})
  };
}

function noReaction(rule, message, extra = {}) {
  return {
    status: 'no-reaction',
    confidence: rule.confidence || 'high',
    ruleId: rule.id,
    message,
    why: [message],
    source: rule.source || reactionData.source,
    ...extra
  };
}

function findPair(species, className) {
  const found = species.find((item) => SUBSTANCES.get(item.formula)?.class === className);
  return found ? { species: found, substance: SUBSTANCES.get(found.formula) } : null;
}

function applyGeneric(rule, input, conditions) {
  if (rule.kind === 'passivation') {
    const metal = input.length === 2 ? findPair(input, 'metal') : null;
    const acid = input.find((item) => rule.acids.includes(item.formula));
    if (!metal || !acid) return null;
    const symbol = metal.species.atoms.keys().next().value;
    if (!rule.metals.includes(symbol)) return null;
    return noReaction(rule, `Реакция не идёт (пассивация): ${symbol} пассивируется в холодной концентрированной ${acid.formula}.`, { reference: 'activity-series' });
  }
  if (rule.kind === 'ionic-redox') {
    const redox = predictIonicRedox(input, conditions);
    if (!redox) return null;
    if (redox.status === 'needs-conditions') return redox;
    if (redox.status === 'no-reaction') {
      const label = Math.abs((redox.E_V ?? redox.E0_V) - redox.E0_V) < 1e-9 ? 'E°' : 'E';
      return noReaction(rule, t('potentialNoReaction', { label, value: (redox.E_V ?? redox.E0_V).toFixed(3) }));
    }
    const nernstLines = Math.abs(redox.E_V - redox.E0_V) > 1e-9
      ? [t('standardPotentialValue', { value: redox.E0_V.toFixed(3) }), t('nernstResult', { quotient: redox.quotient.toPrecision(4), value: redox.E_V.toFixed(3) })]
      : [t('standardPotential', { value: redox.E0_V.toFixed(3) })];
    const result = predictionFromRule({
      ...rule,
      left: redox.left.map((item) => item.formula),
      products: redox.right.map((item) => item.formula),
      coefficients: redox.coefficients,
      why: [t('ionicRedoxWhy'), ...redox.halfReactions, ...nernstLines],
      source: redox.source
    }, input, conditions);
    if (result.status === 'predicted') {
      result.halfReactions = redox.halfReactions;
      result.E0_V = redox.E0_V;
      result.E_V = redox.E_V;
      result.quotient = redox.quotient;
    }
    return result;
  }
  if (rule.kind === 'mutual-hydrolysis') {
    if (input.length !== 2) return null;
    const salts = input.map((item) => saltParts(item.formula));
    if (salts.some((parts) => !parts || !['Р', 'М'].includes(parts.record.solubility))) return null;
    const metalParts = salts.find((parts) => rule.cations[parseFormula(parts.cation).atoms.keys().next().value]);
    const weakParts = salts.find((parts) => rule.anions[parts.anion]);
    if (!metalParts || !weakParts || metalParts === weakParts) return null;
    const symbol = parseFormula(metalParts.cation).atoms.keys().next().value;
    const cationRule = rule.cations[symbol];
    if (cationRule.copperCarbonate && weakParts.anion !== 'CO3^2-') return null;
    const spectatorSalt = formulaFromIons(weakParts.cation, metalParts.anion);
    const result = predictionFromRule({
      ...rule,
      addReactants: ['H2O'],
      products: [cationRule.hydroxide, rule.anions[weakParts.anion].gas, spectatorSalt],
      why: [...rule.why, `${symbol} и ${weakParts.anion} образуют нерастворимый продукт и газ.`]
    }, input, conditions);
    if (result.status === 'predicted' && cationRule.copperCarbonate) {
      result.confidence = 'medium';
      result.assumptions.push('Показан основный карбонат меди(II); его состав зависит от условий осаждения.');
    }
    return result;
  }
  if (rule.kind === 'permanganate-halide-acid') {
    if (input.length !== 3 || conditions.acidConcentration === 'concentrated') return null;
    const oxidizer = input.find((item) => rule.oxidizers.includes(item.formula));
    const halide = input.find((item) => item !== oxidizer && rule.halogens[saltParts(item.formula)?.anion]);
    const acid = input.find((item) => item !== oxidizer && item !== halide && rule.acids.includes(item.formula));
    if (!oxidizer || !halide || !acid) return null;
    const oxidizerParts = saltParts(oxidizer.formula);
    const halideParts = saltParts(halide.formula);
    const acidParts = saltParts(acid.formula);
    if (!oxidizerParts || !halideParts || !acidParts) return null;
    const products = [formulaFromIons('Mn^2+', acidParts.anion), rule.halogens[halideParts.anion]];
    for (const cation of new Set([oxidizerParts.cation, halideParts.cation])) products.push(formulaFromIons(cation, acidParts.anion));
    products.push('H2O');
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'dichromate-iron-acid') {
    if (input.length !== 3) return null;
    const oxidizer = input.find((item) => rule.oxidizers.includes(item.formula));
    const reducer = input.find((item) => item !== oxidizer && rule.reducers.includes(item.formula));
    const acid = input.find((item) => item !== oxidizer && item !== reducer && rule.acids.includes(item.formula));
    if (!oxidizer || !reducer || !acid) return null;
    const oxidizerParts = saltParts(oxidizer.formula);
    const acidParts = saltParts(acid.formula);
    if (!oxidizerParts || !acidParts) return null;
    const products = [
      formulaFromIons('Cr^3+', acidParts.anion),
      formulaFromIons('Fe^3+', acidParts.anion),
      formulaFromIons(oxidizerParts.cation, acidParts.anion),
      'H2O'
    ];
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'salt-peroxide-alkali') {
    if (input.length !== 3 || conditions.medium === 'acidic') return null;
    const peroxide = input.find((item) => item.formula === 'H2O2');
    const base = input.find((item) => item !== peroxide && SUBSTANCES.get(item.formula)?.class === 'base' && saltParts(item.formula)?.anion === 'OH^-');
    const salt = input.find((item) => item !== peroxide && item !== base && rule.cations[saltParts(item.formula)?.cation]);
    if (!peroxide || !base || !salt) return null;
    const saltPartsData = saltParts(salt.formula);
    const baseParts = saltParts(base.formula);
    if (!saltPartsData.record.strong || !baseParts?.record.strong) return null;
    const cationRule = rule.cations[saltPartsData.cation];
    const products = [cationRule.anion ? formulaFromIons(baseParts.cation, cationRule.anion) : cationRule.product];
    products.push(formulaFromIons(baseParts.cation, saltPartsData.anion), 'H2O');
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'ammonia-metal-oxide') {
    if (input.length !== 2) return null;
    const oxide = input.find((item) => rule.oxides[item.formula]);
    if (!oxide || !input.some((item) => item !== oxide && item.formula === 'NH3')) return null;
    return predictionFromRule({ ...rule, products: [rule.oxides[oxide.formula], 'N2↑', 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'nonmetal-halide-hydrolysis') {
    if (input.length !== 2 || !input.some((item) => item.formula === 'H2O')) return null;
    const compound = input.find((item) => rule.compounds[item.formula]);
    if (!compound) return null;
    return predictionFromRule({ ...rule, products: rule.compounds[compound.formula] }, input, conditions);
  }
  if (rule.kind === 'acid-deficit-salt') {
    if (input.length !== 2) return null;
    const acid = input.find((item) => rule.acids[item.formula]);
    const base = input.find((item) => item !== acid && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!acid || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || !['Na^+', 'K^+'].includes(baseParts.cation)) return null;
    return predictionFromRule({ ...rule, products: [formulaFromIons(baseParts.cation, rule.acids[acid.formula]), 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'hydrate-dehydration') {
    if (input.length !== 1 || !['melt', 'gas'].includes(conditions.solvent)) return null;
    const hydrate = rule.hydrates[input[0].formula];
    if (!hydrate) return null;
    const coefficient = input[0].coefficient;
    return predictionFromRule({ ...rule, products: [hydrate.salt, 'H2O'], coefficients: [coefficient, coefficient, coefficient * hydrate.water] }, input, conditions);
  }
  if (rule.kind === 'nonmetal-oxidizing-acid') {
    if (input.length !== 2) return null;
    const nonmetal = input.find((item) => rule.elements[item.formula]);
    const acid = input.find((item) => item !== nonmetal && rule.acids.includes(item.formula));
    if (!nonmetal || !acid) return null;
    const products = rule.elements[nonmetal.formula][acid.formula];
    if (!products) return null;
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'ammonium-salt-base') {
    if (input.length !== 2 || !rule.media.includes(conditions.medium)) return null;
    const salts = input.map((item) => saltParts(item.formula));
    const ammoniumSalt = salts.find((parts) => parts?.cation === 'NH4^+' && ['Р', 'М'].includes(parts.record.solubility));
    const base = input.find((item) => SUBSTANCES.get(item.formula)?.class === 'base' && saltParts(item.formula) !== ammoniumSalt);
    if (!ammoniumSalt || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || baseParts.anion !== 'OH^-' || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const spectatorSalt = formulaFromIons(baseParts.cation, ammoniumSalt.anion);
    if (!solubilityData.substances[spectatorSalt]) return null;
    return predictionFromRule({ ...rule, products: [spectatorSalt, 'NH3↑', 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'amphoteric-salt-base') {
    if (input.length !== 2) return null;
    const salts = input.map((item) => saltParts(item.formula));
    const saltPartsData = salts.find((parts) => parts && rule.cations[parts.cation]);
    const base = input.find((item) => SUBSTANCES.get(item.formula)?.class === 'base' && saltParts(item.formula) !== saltPartsData);
    if (!saltPartsData || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const complexSalt = formulaFromIons(baseParts.cation, rule.cations[saltPartsData.cation]);
    const spectatorSalt = formulaFromIons(baseParts.cation, saltPartsData.anion);
    return predictionFromRule({ ...rule, products: [complexSalt, spectatorSalt] }, input, conditions);
  }
  if (rule.kind === 'basic-oxide-acid') {
    if (input.length !== 2 || conditions.acidConcentration === 'concentrated') return null;
    const oxide = input.find((item) => rule.oxides[item.formula]);
    const acid = input.find((item) => item !== oxide && SUBSTANCES.get(item.formula)?.class === 'acid');
    if (!oxide || !acid || (acid.formula === 'HNO3' && oxide.formula === 'FeO')) return null;
    const acidParts = saltParts(acid.formula);
    if (!acidParts) return null;
    const salt = formulaFromIons(rule.oxides[oxide.formula], acidParts.anion);
    return predictionFromRule({ ...rule, products: [salt, 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'acidic-oxide-base') {
    if (input.length !== 2) return null;
    const oxide = input.find((item) => rule.oxides[item.formula]);
    const base = input.find((item) => item !== oxide && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!oxide || !base) return null;
    const variant = rule.oxides[oxide.formula][conditions.ratio];
    const baseParts = saltParts(base.formula);
    if (!variant || !baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const products = [formulaFromIons(baseParts.cation, variant.anion)];
    if (variant.water === 'product') products.push('H2O');
    return predictionFromRule({
      ...rule,
      products,
      addReactants: variant.water === 'reactant' ? ['H2O'] : [],
      why: [...rule.why, conditions.ratio === 'deficit' ? 'При недостатке основания образуется кислая соль.' : 'При обычном соотношении или избытке основания образуется средняя соль.']
    }, input, conditions);
  }
  if (rule.kind === 'amphoteric-hydroxide-base') {
    if (input.length !== 2) return null;
    const hydroxide = input.find((item) => rule.hydroxides[item.formula]);
    const base = input.find((item) => item !== hydroxide && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!hydroxide || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const complexSalt = formulaFromIons(baseParts.cation, rule.hydroxides[hydroxide.formula]);
    return predictionFromRule({ ...rule, products: [complexSalt] }, input, conditions);
  }
  if (rule.kind === 'amphoteric-oxide-base') {
    if (input.length !== 2) return null;
    const oxide = input.find((item) => rule.oxides[item.formula]);
    const base = input.find((item) => item !== oxide && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!oxide || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const complexSalt = formulaFromIons(baseParts.cation, rule.oxides[oxide.formula]);
    return predictionFromRule({ ...rule, products: [complexSalt], addReactants: ['H2O'] }, input, conditions);
  }
  if (rule.kind === 'metal-nonmetal-combination') {
    if (input.length !== 2) return null;
    const metal = input.find((item) => rule.metals[item.formula]);
    const partner = input.find((item) => item !== metal && rule.partners[item.formula]);
    if (!metal || !partner) return null;
    const symbol = metal.atoms.keys().next().value;
    const partnerRule = rule.partners[partner.formula];
    if (!partnerRule.metals.includes(symbol)) return null;
    const cation = partnerRule.cations?.[symbol] || rule.metals[symbol];
    return predictionFromRule({ ...rule, products: [formulaFromIons(cation, partnerRule.anion)] }, input, conditions);
  }
  if (rule.kind === 'volatile-acid-salt') {
    if (input.length !== 2) return null;
    const salt = input.find((item) => rule.anions[saltParts(item.formula)?.anion]);
    const acid = input.find((item) => item !== salt && SUBSTANCES.get(item.formula)?.class === 'acid');
    if (!salt || !acid || (acid.formula === 'HNO3' && conditions.acidConcentration === 'concentrated')) return null;
    const saltPartsData = saltParts(salt.formula);
    const acidParts = saltParts(acid.formula);
    if (!saltPartsData || !acidParts?.record.strong) return null;
    const spectatorSalt = formulaFromIons(saltPartsData.cation, acidParts.anion);
    return predictionFromRule({ ...rule, products: [spectatorSalt, ...rule.anions[saltPartsData.anion].products] }, input, conditions);
  }
  if (rule.kind === 'weak-acid-salt-acid') {
    if (input.length !== 2) return null;
    const salt = input.find((item) => rule.anions[saltParts(item.formula)?.anion]);
    const acid = input.find((item) => item !== salt && SUBSTANCES.get(item.formula)?.class === 'acid');
    if (!salt || !acid || (acid.formula === 'HNO3' && conditions.acidConcentration === 'concentrated')) return null;
    const saltPartsData = saltParts(salt.formula);
    const acidParts = saltParts(acid.formula);
    if (!saltPartsData || !acidParts?.record.strong) return null;
    const spectatorSalt = formulaFromIons(saltPartsData.cation, acidParts.anion);
    return predictionFromRule({ ...rule, products: [rule.anions[saltPartsData.anion].acid, spectatorSalt] }, input, conditions);
  }
  if (rule.kind === 'acidic-salt-acid') {
    if (input.length !== 2 || conditions.acidConcentration === 'concentrated') return null;
    const salt = input.find((item) => rule.salts[item.formula]);
    const acid = input.find((item) => item !== salt && SUBSTANCES.get(item.formula)?.class === 'acid');
    if (!salt || !acid) return null;
    const saltPartsData = saltParts(salt.formula);
    const acidParts = saltParts(acid.formula);
    if (!saltPartsData || !acidParts) return null;
    const spectatorSalt = formulaFromIons(saltPartsData.cation, acidParts.anion);
    const products = [spectatorSalt, rule.salts[salt.formula].gas];
    if (rule.salts[salt.formula].water !== false) products.push('H2O');
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'acidic-salt-base') {
    if (input.length !== 2) return null;
    const salt = input.find((item) => rule.salts[item.formula]);
    const base = input.find((item) => item !== salt && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!salt || !base) return null;
    const baseParts = saltParts(base.formula);
    const saltPartsData = saltParts(salt.formula);
    if (!baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility) || !saltPartsData) return null;
    const products = [formulaFromIons(saltPartsData.cation, rule.salts[salt.formula]), 'H2O'];
    const assumptions = [];
    if (baseParts.cation !== saltPartsData.cation) {
      products.splice(1, 0, formulaFromIons(baseParts.cation, rule.salts[salt.formula]));
      assumptions.push('Катионы сохранены в виде двух отдельных солей в растворе; двойная соль не предполагается.');
    }
    return predictionFromRule({ ...rule, products, assumptions }, input, conditions);
  }
  if (rule.kind === 'complex-acid-ratio') {
    if (input.length !== 2 || conditions.acidConcentration === 'concentrated') return null;
    const complex = input.find((item) => rule.complexes[item.formula]);
    const acid = input.find((item) => item !== complex && SUBSTANCES.get(item.formula)?.class === 'acid');
    if (!complex || !acid) return null;
    const complexParts = saltParts(complex.formula);
    const acidParts = saltParts(acid.formula);
    if (!complexParts || !acidParts) return null;
    const spectatorSalt = formulaFromIons(complexParts.cation, acidParts.anion);
    const products = conditions.ratio === 'deficit'
      ? [rule.complexes[complex.formula].hydroxide, spectatorSalt, 'H2O']
      : [formulaFromIons(rule.complexes[complex.formula].metal, acidParts.anion), spectatorSalt, 'H2O'];
    return predictionFromRule({ ...rule, products }, input, conditions);
  }
  if (rule.kind === 'melt-electrolysis') {
    if (input.length !== 1) return null;
    const parts = saltParts(input[0].formula);
    if (!parts) return null;
    const cation = parseFormula(parts.cation);
    const anion = parseFormula(parts.anion);
    if (cation.atoms.size !== 1 || anion.atoms.size !== 1 || !['Cl', 'Br', 'I'].includes(anion.atoms.keys().next().value)) return null;
    return predictionFromRule({ ...rule, products: [cation.atoms.keys().next().value, `${anion.atoms.keys().next().value}2↑`] }, input, conditions);
  }
  if (rule.kind === 'weak-acid-base') {
    if (input.length !== 2) return null;
    const acid = input.find((item) => rule.acids[item.formula]);
    const base = input.find((item) => item !== acid && SUBSTANCES.get(item.formula)?.class === 'base');
    if (!acid || !base) return null;
    const baseParts = saltParts(base.formula);
    if (!baseParts?.record.strong || !['Р', 'М'].includes(baseParts.record.solubility)) return null;
    const salt = formulaFromIons(baseParts.cation, rule.acids[acid.formula]);
    return predictionFromRule({ ...rule, products: [salt, 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'neutralization') {
    if (input.length !== 2) return null;
    const acid = findPair(input, 'acid');
    const base = findPair(input, 'base');
    if (!acid || !base) return null;
    const acidParts = saltParts(acid.species.formula);
    const baseParts = saltParts(base.species.formula);
    if (!acidParts || !baseParts) return null;
    const salt = formulaFromIons(baseParts.cation, acidParts.anion);
    return predictionFromRule({ ...rule, products: [salt, 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'metal-acid') {
    if (input.length !== 2 || conditions.acidConcentration === 'concentrated') return null;
    const metal = findPair(input, 'metal');
    const acid = input.find((item) => SUBSTANCES.get(item.formula)?.nonOxidizingAcid);
    if (!metal || !acid) return null;
    const symbol = metal.species.atoms.keys().next().value;
    if ((ACTIVITY.get(symbol) ?? 999) > ACTIVITY.get('H')) {
      return noReaction(rule, `${symbol} стоит после H в ряду активности и не вытесняет водород из ${acid.formula}.`, { reference: 'activity-series' });
    }
    if (WATER_REACTIVE.has(symbol) && acid.species.state !== 'g') {
      return noReaction(rule, `${symbol} в водном растворе прежде всего реагирует с водой; схема простого вытеснения из кислоты не применяется.`);
    }
    const cation = activityData.commonIons[symbol];
    const acidParts = saltParts(acid.formula);
    if (!cation || !acidParts) return null;
    const salt = formulaFromIons(cation, acidParts.anion);
    return predictionFromRule({ ...rule, products: [salt, 'H2↑'] }, input, conditions);
  }
  if (rule.kind === 'metal-salt') {
    if (input.length !== 2) return null;
    const metal = findPair(input, 'metal');
    const saltEntry = input.find((item) => SUBSTANCES.get(item.formula)?.class === 'salt' && saltParts(item.formula));
    if (!metal || !saltEntry) return null;
    const symbol = metal.species.atoms.keys().next().value;
    const parts = saltParts(saltEntry.formula);
    const saltMetal = parseFormula(parts.cation).atoms.keys().next().value;
    if (!ACTIVITY.has(symbol) || !ACTIVITY.has(saltMetal)) return null;
    if (WATER_REACTIVE.has(symbol)) {
      return noReaction(rule, `${symbol} реагирует с водой раствора, а не просто вытесняет ${saltMetal} из соли.`, { reference: 'activity-series' });
    }
    if (ACTIVITY.get(symbol) >= ACTIVITY.get(saltMetal)) {
      return noReaction(rule, `${symbol} менее активен, чем ${saltMetal}, и не вытесняет его из ${saltEntry.formula}.`, { reference: 'activity-series' });
    }
    const cation = activityData.commonIons[symbol];
    if (!cation) return null;
    const newSalt = formulaFromIons(cation, parts.anion);
    if (solubilityData.substances[newSalt]?.solubility === 'Н') return null;
    return predictionFromRule({ ...rule, products: [newSalt, `${saltMetal}↓`] }, input, conditions);
  }
  if (rule.kind === 'acid-carbonate') {
    if (input.length !== 2) return null;
    const acid = findPair(input, 'acid');
    const carbonate = input.find((item) => saltParts(item.formula)?.anion === 'CO3^2-');
    if (!acid || !carbonate) return null;
    const acidParts = saltParts(acid.species.formula);
    const carbonateParts = saltParts(carbonate.formula);
    if (!acidParts || !carbonateParts) return null;
    const salt = formulaFromIons(carbonateParts.cation, acidParts.anion);
    return predictionFromRule({ ...rule, products: [salt, 'H2O', 'CO2↑'] }, input, conditions);
  }
  if (rule.kind === 'combustion') {
    if (input.length !== 2 || !input.some((item) => item.formula === 'O2')) return null;
    const organic = findPair(input, 'organic');
    if (!organic) return null;
    const symbols = new Set(organic.species.atoms.keys());
    if (!symbols.has('C') || !symbols.has('H') || [...symbols].some((symbol) => !['C', 'H', 'O'].includes(symbol))) return null;
    return predictionFromRule({ ...rule, products: ['CO2', 'H2O'] }, input, conditions);
  }
  if (rule.kind === 'double-displacement') {
    if (input.length !== 2) return null;
    const first = saltParts(input[0].formula);
    const second = saltParts(input[1].formula);
    if (!first || !second || !['Р', 'М'].includes(first.record.solubility) || !['Р', 'М'].includes(second.record.solubility)) return null;
    const formulas = [formulaFromIons(first.cation, second.anion), formulaFromIons(second.cation, first.anion)];
    const records = formulas.map((formula) => solubilityData.substances[formula]);
    if (records.some((record) => !record)) return null;
    const drivingForce = records.some((record) => ['Н', 'М'].includes(record.solubility));
    if (!drivingForce) {
      return noReaction(rule, 'Все возможные продукты растворимы: ионы остаются в растворе, осадок, газ или слабый электролит не образуются.', { reference: 'solubility' });
    }
    const products = formulas.map((formula, index) => `${formula}${['Н', 'М'].includes(records[index].solubility) ? '↓' : ''}`);
    const result = predictionFromRule({ ...rule, products }, input, conditions);
    if (records.some((record) => record.solubility === 'М')) {
      result.confidence = 'medium';
      result.assumptions.push('Малорастворимый продукт выпадет в осадок только при достаточной концентрации ионов.');
    }
    return result;
  }
  return null;
}

function conditionAlternatives(baseRules, input, conditions) {
  if (conditions.acidConcentration !== 'unspecified') return null;
  const variants = baseRules.filter((rule) => rule.when?.acidConcentration && rule.when.acidConcentration !== 'unspecified');
  if (!variants.length) return null;
  return {
    status: 'ambiguous',
    confidence: 'low',
    message: 'Продукты зависят от концентрации кислоты. Выберите условие.',
    variants: variants.map((rule) => predictionFromRule(rule, input, { ...conditions, acidConcentration: rule.when.acidConcentration }))
  };
}

function ruleSuggestion(rule, input) {
  const actual = new Set(input.map((item) => item.formula));
  const allowed = new Set([...rule.reactants, ...(rule.addReactants || [])]);
  const shared = [...allowed].filter((formula) => actual.has(formula));
  const missing = rule.reactants.filter((formula) => !actual.has(formula));
  const extra = [...actual].filter((formula) => !allowed.has(formula));
  const score = shared.length * 10 - missing.length * 2 - extra.length * 2 + (missing.length === 0 && extra.length === 0 ? 5 : 0);
  const reactants = rule.reactants.map((formula, index) => `${rule.inputCoefficients?.[index] > 1 ? rule.inputCoefficients[index] : ''}${formula}`);
  reactants.push(...(rule.addReactants || []));
  const conditionLabels = Object.entries(rule.when || {}).map(([key, value]) => {
    const labels = {
      medium: { acidic: 'acidic', neutral: 'neutral', alkaline: 'alkaline' },
      acidConcentration: { diluted: 'dilute', dilute: 'dilute', concentrated: 'concentrated' },
      solvent: { aqueous: 'aqueous', melt: 'melt', gas: 'gasPhase', organic: 'organicSolvent' },
      ratio: { normal: 'normalRatio', deficit: 'deficitRatio' }
    };
    if (key === 'heating' && value) return t('heating');
    if (key === 'current' && value) return t('electricCurrent');
    if (key === 'catalyst') return `${t('catalyst')} ${value}`;
    return labels[key]?.[value] ? t(labels[key][value]) : `${key}: ${value}`;
  });
  return {
    ruleId: rule.id,
    reactants: reactants.join(' + '),
    conditions: { ...(rule.when || {}) },
    hint: missing.length ? t('addReactants', { formulas: missing.join(', ') }) : conditionLabels.length ? t('conditionsLabel', { conditions: conditionLabels.join(', ') }) : t('similarRule'),
    score
  };
}

function reactionSuggestions(input) {
  const seen = new Set();
  return RULES.filter((rule) => rule.kind === 'exact' && rule.outcome !== 'no-reaction')
    .map((rule) => ({ rule, suggestion: ruleSuggestion(rule, input) }))
    .filter(({ suggestion }) => suggestion.score >= 6)
    .sort((a, b) => b.suggestion.score - a.suggestion.score || b.rule.priority - a.rule.priority)
    .filter(({ rule, suggestion }) => {
      const key = `${suggestion.reactants}|${JSON.stringify(rule.when || {})}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map(({ suggestion: { score, ...suggestion } }) => suggestion);
}

export function getReactionRule(id) {
  const rule = RULES.find((item) => item.id === id);
  return rule ? structuredClone(rule) : null;
}

export function predictReaction(source, options = {}) {
  source = normalizeReactionNotation(source);
  const conditions = { ...DEFAULT_CONDITIONS, ...options };
  if (/(?:->|→|⇄|↔|=)/.test(source)) {
    return { status: 'check-required', confidence: 'low', message: 'Введены не только реагенты. Переключитесь в режим «Проверка», чтобы проверить полное уравнение.' };
  }
  let input;
  try {
    input = parseSide(source);
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    return { status: 'syntax-error', confidence: 'low', message: error.message, error };
  }
  const exact = RULES.filter((rule) => rule.kind === 'exact' && matchesReactants(rule, input));
  const applicable = exact.filter((rule) => matchesConditions(rule, conditions));
  const phaseSpecific = applicable.find((rule) => rule.when?.solvent === conditions.solvent);
  if (phaseSpecific) return predictionFromRule(phaseSpecific, input, conditions);
  const phaseBlock = phasePredictionBlock(input, conditions);
  if (phaseBlock) return phaseBlock;
  if (applicable.length) return predictionFromRule(applicable[0], input, conditions);
  const alternatives = conditionAlternatives(exact, input, conditions);
  if (alternatives) return alternatives;
  for (const rule of RULES.filter((item) => item.kind !== 'exact' && matchesConditions(item, conditions))) {
    const result = applyGeneric(rule, input, conditions);
    if (result) return result;
  }
  if (exact.length) {
    const missing = [];
    if (exact.some((rule) => rule.when?.heating)) missing.push('нагревание');
    if (exact.some((rule) => rule.when?.current)) missing.push('электрический ток');
    if (exact.some((rule) => rule.when?.catalyst)) missing.push(`катализатор ${exact.find((rule) => rule.when?.catalyst).when.catalyst}`);
    if (missing.length) {
      return { status: 'needs-conditions', confidence: 'high', message: `Для типового правила укажите: ${[...new Set(missing)].join(', ')}.`, availableRules: exact.map((rule) => rule.id) };
    }
  }
  return {
    status: 'no-rule',
    confidence: 'low',
    message: 'Нет подходящего правила для этой пары веществ. Продукты не угадываются: переключитесь в «Проверку» и введите их самостоятельно.',
    why: ['Локальная база не содержит применимого правила при выбранных условиях.'],
    suggestions: reactionSuggestions(input)
  };
}

export function reactionRuleCount() {
  return RULES.length;
}
