import activityData from '../data/activity-series.json' with { type: 'json' };
import substanceData from '../data/substances.json' with { type: 'json' };
import communityData from '../data/reaction-rules-community.json' with { type: 'json' };
import { balanceEquation, inspectBalance } from './balancer.js';
import { FormulaSyntaxError, formatEquation, parseEquation } from './parser.js';
import { analyzeRedox } from './redox.js';

const SUBSTANCES = new Map(substanceData.items.map((item) => [item.formula, item]));
const ACTIVITY_INDEX = new Map(activityData.order.map((symbol, index) => [symbol, index]));

export function findSubstance(formula) {
  return SUBSTANCES.get(formula) || communityData.substances.find((item) => item.formula === formula) || null;
}

function checkMetalAcid(equation) {
  if (equation.left.length !== 2) return null;
  const records = equation.left.map((species) => ({ species, substance: findSubstance(species.formula) }));
  const metal = records.find((entry) => entry.substance?.class === 'metal');
  const acid = records.find((entry) => entry.substance?.nonOxidizingAcid);
  if (!metal || !acid || !equation.right.some((species) => species.formula === 'H2')) return null;
  const symbol = metal.species.atoms.keys().next().value;
  const metalRank = ACTIVITY_INDEX.get(symbol);
  const hydrogenRank = ACTIVITY_INDEX.get('H');
  if (metalRank === undefined || metalRank < hydrogenRank) return null;
  return {
    code: 'metal-after-hydrogen',
    reference: 'activity-series',
    message: `Возможна ошибка в продуктах: ${symbol} стоит после водорода в ряду активности и не вытесняет H₂ из ${acid.species.baseFormula}.`
  };
}

function checkNewElements(balance) {
  const leftSymbols = new Set(balance.equation.left.flatMap((species) => [...species.atoms.keys()]));
  const extra = balance.equation.right.flatMap((species) => [...species.atoms.keys()])
    .filter((symbol, index, symbols) => !leftSymbols.has(symbol) && symbols.indexOf(symbol) === index);
  return extra.length ? [{
    code: 'new-elements',
    message: `В продуктах появились элементы, которых нет в реагентах: ${extra.join(', ')}. Проверьте состав продуктов.`
  }] : [];
}

export function checkEquation(input) {
  let equation;
  try {
    equation = typeof input === 'string' ? parseEquation(input) : input;
  } catch (error) {
    if (!(error instanceof FormulaSyntaxError)) throw error;
    return {
      status: 'syntax-error',
      title: 'Ошибка в записи формулы',
      message: error.message,
      error,
      equation: null
    };
  }
  let balance;
  try {
    balance = inspectBalance(equation);
  } catch (error) {
    return { status: 'syntax-error', title: 'Ошибка в коэффициентах', message: error.message, error, equation };
  }
  const warnings = [...checkNewElements(balance)];
  const metalAcidWarning = checkMetalAcid(equation);
  if (metalAcidWarning) warnings.push(metalAcidWarning);
  const unknownSubstances = [...equation.left, ...equation.right]
    .filter((species) => !species.isElectron && !findSubstance(species.formula));
  const redox = analyzeRedox(equation, balance.coefficients);
  let status;
  let title;
  let message;
  if (warnings.some((warning) => warning.code === 'metal-after-hydrogen')) {
    status = 'product-warning';
    title = 'Возможна ошибка в продуктах';
    message = metalAcidWarning.message;
  } else if (!balance.isBalanced) {
    status = 'not-balanced';
    title = 'Баланс не сошёлся';
    message = 'Измените коэффициенты так, чтобы число атомов каждого элемента и суммарный заряд совпали.';
  } else if (!balance.isMinimal) {
    status = 'nonminimal';
    title = 'Баланс верный, коэффициенты не минимальные';
    message = `Все коэффициенты можно сократить на ${balance.coefficientGcd}.`;
  } else if (unknownSubstances.length > 0) {
    status = 'partial';
    title = 'Не удалось полностью проверить';
    message = `Математический баланс проверен. Химическая правдоподобность не проверена для: ${unknownSubstances.map((species) => species.formula).join(', ')}.`;
  } else if (redox.isRedox && !redox.complete) {
    status = 'partial';
    title = 'Баланс проверен частично';
    message = 'Атомы и заряды сходятся, но для части веществ степени окисления требуют сведений о структуре.';
  } else {
    status = 'correct';
    title = 'Верно';
    message = 'Атомы, заряды и коэффициенты проверены. Известные правила не выявили замечаний к продуктам.';
  }
  return { status, title, message, equation, balance, warnings, unknownSubstances, redox };
}

export function getHint(result, level) {
  if (!result?.equation || result.status === 'syntax-error') return 'Сначала исправьте запись уравнения.';
  if (result.balance.isBalanced && !result.balance.isMinimal) {
    return `Разделите все коэффициенты на их общий делитель ${result.balance.coefficientGcd}.`;
  }
  const unmatched = result.balance.atomRows.filter((row) => !row.balanced);
  if (!result.balance.charge.balanced) unmatched.push({ symbol: 'заряд', ...result.balance.charge });
  if (level === 1) {
    return unmatched.length
      ? `Проверьте: ${unmatched.map((row) => `${row.symbol} (слева ${row.left}, справа ${row.right})`).join('; ')}.`
      : 'Атомы и заряд уже сбалансированы. Проверьте минимальность коэффициентов и продукты.';
  }
  if (level === 2) {
    const row = unmatched[0];
    if (!row) return 'Математический баланс уже сошёлся.';
    const deficientSide = row.left < row.right ? 'левой' : 'правой';
    const candidates = (deficientSide === 'левой' ? result.equation.left : result.equation.right)
      .filter((species) => row.symbol === 'заряд' || species.atoms.has(row.symbol));
    return `У ${deficientSide} стороны не хватает: ${row.symbol}. Попробуйте изменить коэффициент перед ${candidates.map((species) => species.baseFormula).join(' или ')}.`;
  }
  const solution = balanceEquation(result.equation);
  return solution.status === 'balanced'
    ? `Полная подсказка: ${solution.formatted}`
    : solution.message;
}

export function revealAnswer(result) {
  if (!result?.equation) return null;
  const solution = balanceEquation(result.equation);
  if (solution.status !== 'balanced') return solution;
  return {
    ...solution,
    steps: [
      'Составьте по одному уравнению для каждого элемента и, при наличии ионов, для заряда.',
      'Решите однородную систему в рациональных числах и выберите ненулевой вектор из ядра матрицы.',
      `Приведите решение к наименьшим положительным целым: ${solution.coefficients.join(' : ')}.`,
      `Проверка: ${formatEquation(solution.equation, solution.coefficients)}.`
    ]
  };
}
