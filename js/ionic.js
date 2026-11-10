import { electrolyteRecord, isStrongElectrolyte } from './electrolytes.js';
import { balanceEquation, inspectBalance } from './balancer.js';
import { equationDissociationSteps } from './dissociation.js';
import { t } from './i18n.js';
import { isNonAqueousSolvent } from './reaction-conditions.js';
import { equationToUnicode, formatEquation, parseEquation, parseSpecies } from './parser.js';

function expandSide(side) {
  const expanded = [];
  for (const species of side) {
    const record = electrolyteRecord(species.formula);
    if (record?.strong && ['Р', 'М'].includes(record.solubility) && record.ions && !species.isElectron) {
      for (const ion of record.ions) {
        expanded.push({ ...parseSpecies(ion.formula), coefficient: species.coefficient * ion.coefficient, source: species.formula });
      }
    } else {
      expanded.push({ ...species });
    }
  }
  return expanded;
}

function combineSide(side) {
  const species = new Map();
  for (const item of side) {
    if (species.has(item.formula)) {
      const existing = species.get(item.formula);
      existing.coefficient += item.coefficient;
    } else {
      species.set(item.formula, { ...item });
    }
  }
  return [...species.values()];
}

function greatestDivisor(values) {
  let result = 0;
  for (const value of values) {
    let next = value;
    while (next) [result, next] = [next, result % next];
  }
  return result || 1;
}

function cancelSpectators(left, right) {
  const leftMap = new Map(left.map((item) => [item.formula, item]));
  const rightMap = new Map(right.map((item) => [item.formula, item]));
  const spectators = [];
  const netLeft = [];
  const netRight = [];
  for (const [formula, leftItem] of leftMap) {
    const rightItem = rightMap.get(formula);
    const cancelled = rightItem ? Math.min(leftItem.coefficient, rightItem.coefficient) : 0;
    if (cancelled) spectators.push({ formula, coefficient: cancelled });
    if (leftItem.coefficient > cancelled) netLeft.push({ ...leftItem, coefficient: leftItem.coefficient - cancelled });
    if (rightItem && rightItem.coefficient > cancelled) netRight.push({ ...rightItem, coefficient: rightItem.coefficient - cancelled });
  }
  for (const [formula, rightItem] of rightMap) {
    if (!leftMap.has(formula)) netRight.push({ ...rightItem });
  }
  return { netLeft, netRight, spectators };
}

export function buildIonicEquations(input, options = {}) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  if (isNonAqueousSolvent(options.solvent)) return { status: 'unavailable', message: t('nonAqueousIonic') };
  if (!equation.left.length || !equation.right.length) return { status: 'unavailable', message: 'Нужны обе стороны уравнения.' };
  const inspection = inspectBalance(equation);
  if (!inspection.isBalanced) return { status: 'unbalanced', message: 'Сначала уравняйте молекулярное уравнение.' };
  const fullLeft = expandSide(equation.left);
  const fullRight = expandSide(equation.right);
  const dissolved = [...equation.left, ...equation.right].some((species) => isStrongElectrolyte(species.formula));
  const hasChargedSpecies = [...equation.left, ...equation.right].some((species) => species.charge !== 0 || species.isElectron);
  if (!dissolved && !hasChargedSpecies) return { status: 'unavailable', message: 'В уравнении нет растворимых сильных электролитов из локальной базы.' };
  const alreadyIonic = !dissolved && hasChargedSpecies;
  const { netLeft, netRight, spectators } = cancelSpectators(combineSide(fullLeft), combineSide(fullRight));
  const divisor = greatestDivisor([...netLeft, ...netRight].map((item) => item.coefficient));
  if (divisor > 1) {
    for (const item of [...netLeft, ...netRight]) item.coefficient /= divisor;
  }
  if (netLeft.length === 2 && netLeft.every((item) => ['H^+', 'OH^-'].includes(item.formula))) {
    netLeft.sort((a, b) => a.formula === 'H^+' ? -1 : b.formula === 'H^+' ? 1 : 0);
  }
  const fullEquation = { left: fullLeft, right: fullRight, separator: equation.separator || '→' };
  const netEquation = { left: netLeft, right: netRight, separator: equation.separator || '→' };
  const netFormatted = formatEquation(netEquation);
  const netBalance = netLeft.length && netRight.length ? inspectBalance(netEquation) : null;
  const notes = [alreadyIonic ? t('alreadyIonic') : 'Растворимые сильные электролиты записаны ионами; вода, осадки, газы и слабые электролиты — молекулами.'];
  const dissociation = equationDissociationSteps(equation);
  if ([...equation.left, ...equation.right].some((species) => species.formula === 'H2SO4')) notes.push('Для H2SO4 использовано школьное приближение полной двухступенчатой диссоциации.');
  if (dissociation.some((step) => step.strength === 'weak' && step.from.includes('PO4'))) notes.push(t('weakPolyprotic'));
  if (netBalance && !netBalance.isBalanced) return { status: 'error', message: 'Внутренняя проверка ионного баланса не прошла.', fullEquation };
  return {
    status: netLeft.length && netRight.length ? 'ok' : 'no-net-reaction',
    full: formatEquation(fullEquation),
    net: netFormatted,
    fullUnicode: equationToUnicode(fullEquation),
    netUnicode: netLeft.length && netRight.length ? equationToUnicode(netEquation) : '',
    fullEquation,
    netEquation,
    spectators,
    dissociation,
    notes,
    message: netLeft.length && netRight.length ? 'Ионы-наблюдатели сокращены.' : 'Все ионы сокращаются: суммарной реакции нет.'
  };
}

export function ionicForUnbalanced(input, options = {}) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  const balanced = balanceEquation(equation);
  if (balanced.status !== 'balanced') return { status: balanced.status, message: balanced.message };
  const withCoefficients = {
    ...equation,
    left: equation.left.map((item, index) => ({ ...item, coefficient: balanced.coefficients[index] })),
    right: equation.right.map((item, index) => ({ ...item, coefficient: balanced.coefficients[equation.left.length + index] }))
  };
  return buildIonicEquations(withCoefficients, options);
}
