import { inspectBalance } from '../js/balancer.js';
import { buildIonicEquations } from '../js/ionic.js';
import { formatEquation, parseEquation, parseFormula, parseSide } from '../js/parser.js';
import { phasePredictionBlock } from '../js/reaction-conditions.js';

const MEDIA = new Set(['neutral', 'acidic', 'alkaline']);
const SOLVENTS = new Set(['aqueous', 'melt', 'gas', 'organic']);
const CONCENTRATIONS = new Set(['unspecified', 'dilute', 'concentrated']);
const RATIOS = new Set(['normal', 'deficit']);
const CATALYSTS = new Set(['', 'MnO2', 'Pt', 'Ni', 'Fe', 'V2O5']);
const SOURCE_TYPES = new Set(['glinka', 'lidine', 'textbook', 'lab', 'personal']);
const ISSUES = new Set(['products', 'conditions', 'coefficients', 'ionic', 'substance', 'thermo', 'code', 'balance_engine']);
const CLASSES = new Set(['salt', 'acid', 'base', 'oxide', 'acidic_oxide', 'basic_oxide', 'amphoteric_oxide', 'simple', 'metal', 'organic', 'binary', 'gas', 'complex', 'acidic_salt', 'basic_salt', 'organic_salt', 'peroxide', 'hydride', 'carbide', 'nitride', 'phosphide', 'sulfide', 'mineral', 'intermetallic', 'covalent_halide']);

function fail(message, code = 'invalid_proposal', details = undefined) {
  throw Object.assign(new Error(message), { status: 422, code, details });
}

function text(value, name, max, required = true) {
  if (typeof value !== 'string') fail(`Поле ${name} должно быть строкой`, 'invalid_field');
  const result = value.trim();
  if (required && !result) fail(`Заполните поле ${name}`, 'required_field');
  if (result.length > max) fail(`Поле ${name} превышает ${max} символов`, 'field_too_long');
  return result;
}

export function normalizeConditions(value = {}) {
  const medium = value.medium ?? 'neutral';
  const solvent = value.solvent ?? 'aqueous';
  const acidConcentration = value.acidConcentration === 'diluted' ? 'dilute' : value.acidConcentration ?? 'unspecified';
  const ratio = value.ratio ?? 'normal';
  const catalyst = value.catalyst ?? '';
  if (!MEDIA.has(medium) || !SOLVENTS.has(solvent) || !CONCENTRATIONS.has(acidConcentration) || !RATIOS.has(ratio) || !CATALYSTS.has(catalyst)) fail('Недопустимые условия реакции', 'invalid_conditions');
  for (const key of ['heating', 'current']) if (typeof value[key] !== 'boolean') fail(`Флаг ${key} должен быть булевым`, 'invalid_conditions');
  return { medium, solvent, acidConcentration, ratio, catalyst, heating: value.heating ?? false, current: value.current ?? false };
}

export function reactionKey(reactants, conditions) {
  const formulas = reactants.map((item) => item.formula).sort();
  return JSON.stringify([formulas, conditions]);
}

function validateSubstance(item, source) {
  const formula = text(item.formula, 'formula', 160);
  const parsed = parseFormula(formula);
  if (parsed.charge !== 0) fail(`Вещество ${formula} должно быть нейтральной формулой, а не ионом`, 'invalid_substance');
  const name_ru = text(item.name_ru, 'name_ru', 180);
  if (!CLASSES.has(item.class)) fail(`Неизвестный класс вещества ${formula}`, 'invalid_substance');
  const solubility = item.solubility ?? '—';
  if (!['Р', 'М', 'Н', '—'].includes(solubility)) fail(`Неизвестная растворимость ${formula}`, 'invalid_substance');
  const strong = item.strong === true;
  const ions = Array.isArray(item.ions) ? item.ions : [];
  const normalizedIons = ions.map((ion) => ({
    formula: text(ion.formula, 'ion formula', 100),
    coefficient: Number.isSafeInteger(ion.coefficient) && ion.coefficient > 0 ? ion.coefficient : fail('Коэффициент иона должен быть положительным целым', 'invalid_ion')
  }));
  if (strong && ['Р', 'М'].includes(solubility)) {
    if (!normalizedIons.length) fail(`Для ${formula} нужен ионный состав`, 'invalid_ion');
    const atoms = new Map();
    let charge = 0;
    for (const ion of normalizedIons) {
      const part = parseFormula(ion.formula);
      if (part.charge === 0) fail(`Ион ${ion.formula} должен иметь заряд`, 'invalid_ion');
      charge += part.charge * ion.coefficient;
      for (const [symbol, count] of part.atoms) atoms.set(symbol, (atoms.get(symbol) || 0) + count * ion.coefficient);
    }
    if (charge !== 0 || atoms.size !== parsed.atoms.size || [...parsed.atoms].some(([symbol, count]) => atoms.get(symbol) !== count)) {
      fail(`Ионный состав ${formula} не совпадает с формулой`, 'invalid_ion');
    }
  }
  return { formula, name_ru, class: item.class, source: source.details, solubility, strong, ions: normalizedIons };
}

function validateManualIonic(payload, allowReviewWarnings) {
  const full = text(payload.manualIonicFull ?? '', 'manual ionic full', 1500, false);
  const net = text(payload.manualIonicNet ?? '', 'manual ionic net', 1500, false);
  if (!full && !net) return null;
  const warnings = [];
  for (const [label, value] of [['Полное', full], ['Краткое', net]]) {
    if (!value) continue;
    const balance = inspectBalance(parseEquation(value));
    if (!balance.isBalanced) {
      const message = `${label} ионное уравнение не сбалансировано по атомам или заряду`;
      if (!allowReviewWarnings) fail(message, 'invalid_ionic', balance);
      warnings.push(message);
    }
  }
  return { ionicOverride: { ...(full ? { full: formatEquation(parseEquation(full)) } : {}), ...(net ? { net: formatEquation(parseEquation(net)) } : {}) }, warnings };
}

export function validateProposal(payload, { privileges = 'basic' } = {}) {
  const source = {
    type: text(payload.sourceType, 'source type', 30),
    details: text(payload.sourceDetails, 'source details', 2000)
  };
  if (!SOURCE_TYPES.has(source.type)) fail('Выберите источник из списка', 'invalid_source');
  const conditions = normalizeConditions(payload.conditions);
  const issueTypes = Array.isArray(payload.issueTypes) ? payload.issueTypes.filter((item) => ISSUES.has(item)) : [];
  const comment = text(payload.comment ?? '', 'comment', 2000, false);
  const baseRuleId = text(payload.baseRuleId ?? '', 'base rule', 100, false);
  const specialCase = payload.specialCase === true;
  const allowReviewWarnings = specialCase || ['admin+', 'GOD'].includes(privileges);
  const outcome = payload.outcome === 'no-reaction' ? 'no-reaction' : 'products';
  const equationText = text(payload.equation, 'equation', 1500);
  const equation = outcome === 'no-reaction' ? null : parseEquation(equationText);
  const reactants = equation ? equation.left : parseSide(equationText);
  if (outcome === 'no-reaction' && !reactants.length) fail('Добавьте реагенты', 'invalid_reactants');
  const balance = equation ? inspectBalance(equation) : null;
  if (balance && !balance.isBalanced && !allowReviewWarnings) fail('Атомы и заряд не уравнены. Проверьте коэффициенты или отметьте частный случай', 'unbalanced', balance);
  if (balance && !balance.isBalanced && !issueTypes.includes('balance_engine')) issueTypes.push('balance_engine');
  if (balance?.isBalanced && issueTypes.includes('balance_engine')) issueTypes.splice(issueTypes.indexOf('balance_engine'), 1);
  const phaseBlock = phasePredictionBlock(reactants, conditions);
  if (phaseBlock && outcome !== 'no-reaction' && (payload.phaseSpecific !== true || source.type === 'personal')) fail(phaseBlock.message, 'invalid_medium');
  const substances = (Array.isArray(payload.substances) ? payload.substances : []).map((item) => validateSubstance(item, source));
  const warnings = [];
  if (balance && !balance.isBalanced) warnings.push('Заявка содержит несбалансированное уравнение и требует исправления до публикации');
  if (balance && !balance.isMinimal) warnings.push('Коэффициенты не минимальные');
  const ionic = equation ? buildIonicEquations(equation, { solvent: conditions.solvent }) : null;
  if (ionic?.status === 'error' && !allowReviewWarnings) fail(ionic.message, 'invalid_ionic');
  if (outcome === 'no-reaction' && (payload.manualIonicFull || payload.manualIonicNet)) fail('Для ответа «Реакция не идёт» ионные формы не задаются', 'invalid_ionic');
  const manual = validateManualIonic(payload, allowReviewWarnings);
  warnings.push(...(manual?.warnings || []));
  const proposedRule = {
    kind: 'exact',
    reactants: reactants.map((item) => item.formula),
    addReactants: [],
    when: conditions,
    products: equation ? equation.right.map((item) => item.formula) : [],
    coefficients: balance?.coefficients || reactants.map((item) => item.coefficient),
    type: text(payload.reactionType || 'Правило сообщества', 'reaction type', 160),
    confidence: 'medium',
    why: [comment || source.details],
    assumptions: ['Правило предложено сообществом и проверено модератором.'],
    source: `Сообщество: ${source.details}`,
    sourceType: source.type,
    issueTypes,
    baseRuleId: baseRuleId || undefined,
    substances,
    ...(specialCase ? { specialCase: true } : {}),
    ...(manual?.ionicOverride ? { ionicOverride: manual.ionicOverride } : {}),
    ...(payload.phaseSpecific === true ? { phaseSpecific: true } : {}),
    ...(outcome === 'no-reaction' ? { outcome, message: comment || 'Реакция не идёт в выбранных условиях' } : {})
  };
  return {
    reactionKey: reactionKey(reactants, conditions),
    reactantsText: reactants.map((item) => item.formula).join(' + '),
    equationText: equation ? formatEquation(equation) : equationText,
    originalRule: payload.originalRule || null,
    proposedRule,
    source,
    issueTypes,
    comment,
    baseRuleId,
    warnings,
    ionic
  };
}
