import substanceData from '../data/substances.json' with { type: 'json' };
import communityData from '../data/reaction-rules-community.json' with { type: 'json' };
import { balanceEquation } from './balancer.js';
import { equationToUnicode, parseEquation } from './parser.js';

const SUBSTANCES = new Map([...substanceData.items, ...communityData.substances].map((item) => [item.formula, item]));
// Чистые галогенводороды и другие вещества из списка при н. у. — газы.
// Явно указанная фаза (aq/l/s/р-р) имеет приоритет: HBr(aq) — это раствор, а не газ.
const GASES = new Set(['H2', 'O2', 'Cl2', 'N2', 'F2', 'CO2', 'CO', 'NO', 'NO2', 'SO2', 'H2S', 'NH3', 'CH4', 'C2H6', 'C3H8', 'HCl', 'HBr', 'HI', 'HF']);
const NON_GAS_STATES = new Set(['aq', 'l', 's', 'р-р', 'тв', 'ж']);
export const GAS_MOLAR_VOLUMES = Object.freeze({ normal: 22.4, satp: 24.5 });

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} должно быть положительным числом`);
  return number;
}

export function amountFromInput(species, { kind, value, gasConditions = 'normal', concentrationMolL = 1 }) {
  const amount = positiveNumber(value, 'Исходное значение');
  if (kind === 'amount') return amount;
  if (kind === 'mass') return amount / species.molarMass;
  if (kind === 'gas') {
    if (!isGas(species)) throw new RangeError(`${species.formula} не отмечено как газ в локальной базе`);
    const molarVolume = GAS_MOLAR_VOLUMES[gasConditions];
    return amount / molarVolume;
  }
  if (kind === 'solution') return amount * positiveNumber(concentrationMolL, 'Концентрация');
  throw new RangeError('Неизвестный тип исходной величины');
}

export function isGas(species) {
  if (species.annotation === '↑' || species.state === 'g' || species.state === 'г') return true;
  if (species.annotation === '↓' || NON_GAS_STATES.has(species.state)) return false;
  return GASES.has(species.formula);
}

function rounded(value) {
  return Number(value.toPrecision(7));
}

export function calculateStoichiometry(input, options) {
  const parsed = typeof input === 'string' ? parseEquation(input) : input;
  const balanced = balanceEquation(parsed);
  if (balanced.status !== 'balanced') return { status: balanced.status, message: balanced.message };
  const equation = balanced.equation;
  const species = [...equation.left, ...equation.right];
  const knownIndex = Number(options?.known?.index);
  if (!Number.isInteger(knownIndex) || knownIndex < 0 || knownIndex >= species.length) throw new RangeError('Выберите известное вещество');
  const gasConditions = options.gasConditions === 'satp' ? 'satp' : 'normal';
  const available = new Map();
  for (const [key, value] of Object.entries(options.availableReactants || {})) {
    const index = Number(key);
    if (index >= 0 && index < equation.left.length && value !== '' && value !== null && value !== undefined) {
      available.set(index, positiveNumber(value, `Количество реагента ${species[index].formula}`));
    }
  }
  let limitingIndex = null;
  if (available.size >= 2) {
    let minimum = Infinity;
    for (const [index, moles] of available) {
      const ratio = moles / balanced.coefficients[index];
      if (ratio < minimum) {
        minimum = ratio;
        limitingIndex = index;
      }
    }
  }
  const knownMoles = limitingIndex === null ? amountFromInput(species[knownIndex], { ...options.known, gasConditions }) : null;
  const basisIndex = limitingIndex ?? knownIndex;
  const basis = species[basisIndex];
  const basisMoles = limitingIndex === null ? knownMoles : available.get(limitingIndex);
  const scale = basisMoles / balanced.coefficients[basisIndex];
  const yieldPercent = options.yieldPercent === undefined || options.yieldPercent === '' ? 100 : Number(options.yieldPercent);
  if (!Number.isFinite(yieldPercent) || yieldPercent <= 0 || yieldPercent > 100) throw new RangeError('Выход продукта должен быть в интервале (0; 100] %');
  const yieldProductIndex = options.yieldProductIndex === undefined || options.yieldProductIndex === '' ? null : Number(options.yieldProductIndex);
  if (yieldProductIndex !== null && (!Number.isInteger(yieldProductIndex) || yieldProductIndex < equation.left.length || yieldProductIndex >= species.length)) {
    throw new RangeError('Выход можно применить только к веществу из правой части уравнения');
  }
  const molarVolume = GAS_MOLAR_VOLUMES[gasConditions];
  const rows = species.map((item, index) => {
    const moles = balanced.coefficients[index] * scale;
    const isProduct = index >= equation.left.length;
    const applyYield = isProduct && (yieldProductIndex === null || yieldProductIndex === index);
    const actualMoles = applyYield ? moles * yieldPercent / 100 : moles;
    const itemIsGas = isGas(item);
    const remaining = available.has(index) ? available.get(index) - moles : null;
    return {
      index,
      side: isProduct ? 'right' : 'left',
      formula: item.formula,
      name: SUBSTANCES.get(item.formula)?.name_ru || 'Нет данных',
      coefficient: balanced.coefficients[index],
      molarMass: item.molarMass,
      isGas: itemIsGas,
      moles: rounded(moles),
      massG: rounded(moles * item.molarMass),
      gasVolumeL: itemIsGas ? rounded(moles * molarVolume) : null,
      actualMoles: applyYield ? rounded(actualMoles) : null,
      actualMassG: applyYield ? rounded(actualMoles * item.molarMass) : null,
      actualGasVolumeL: applyYield && itemIsGas ? rounded(actualMoles * molarVolume) : null,
      availableMoles: available.get(index) ?? null,
      remainingMoles: remaining === null ? null : rounded(Math.abs(remaining) < 1e-9 ? 0 : remaining)
    };
  });
  const hasGasProduct = rows.some((row) => row.side === 'right' && row.gasVolumeL !== null);
  const practicalProducts = rows
    .filter((row) => row.side === 'right' && row.actualMoles !== null)
    .map((row) => ({
      index: row.index,
      formula: row.formula,
      moles: row.actualMoles,
      massG: row.actualMassG,
      gasVolumeL: row.actualGasVolumeL,
      isGas: row.isGas
    }));
  const targetProduct = yieldProductIndex === null ? null : practicalProducts.find((row) => row.index === yieldProductIndex) ?? null;
  const availableFormula = available.size === 1 ? species[[...available.keys()][0]].formula : null;
  const conditionsLabel = gasConditions === 'normal' ? 'н. у.' : 'САТП';
  const steps = [];
  if (limitingIndex !== null) {
    steps.push(`Расчёт по лимитирующему реагенту ${basis.formula}: n = ${rounded(basisMoles)} моль (наименьшее отношение n/ν). Верхние поля «Известное вещество» и «Значение» не используются; остальные вещества пересчитаны по ${basis.formula}.`);
  } else if (options.known.kind === 'mass') {
    const mass = positiveNumber(options.known.value, 'Исходное значение');
    steps.push(`Молярная масса ${basis.formula}: M = ${basis.molarMass.toFixed(3)} г/моль.`);
    steps.push(`Количество известного вещества: n = m / M = ${mass} / ${basis.molarMass.toFixed(3)} = ${rounded(knownMoles)} моль.`);
  } else if (options.known.kind === 'gas') {
    steps.push(`Для газов V = n × ${molarVolume} л/моль; количество известного вещества: n = V / ${molarVolume} = ${rounded(knownMoles)} моль.`);
  } else if (options.known.kind === 'solution') {
    const volume = positiveNumber(options.known.value, 'Исходное значение');
    const concentration = positiveNumber(options.known.concentrationMolL, 'Концентрация');
    steps.push(`Количество вещества в растворе: n = C × V = ${concentration} × ${volume} = ${rounded(knownMoles)} моль.`);
  } else {
    steps.push(`Количество известного вещества: n = ${rounded(knownMoles)} моль.`);
  }
  steps.push(`По коэффициентам уравнения базовый масштаб: n / ν = ${rounded(basisMoles)} / ${balanced.coefficients[basisIndex]} = ${rounded(scale)} моль.`);
  steps.push('Для каждого вещества nᵢ = νᵢ × масштаб; mᵢ = nᵢ × Mᵢ.');
  if (hasGasProduct) steps.push(`Для газов V = n × ${molarVolume} л/моль (${conditionsLabel}).`);
  if (yieldPercent !== 100) {
    const values = practicalProducts.map((row) => {
      const parts = [`n = ${row.moles} моль`, `m = ${row.massG} г`];
      if (row.gasVolumeL !== null) parts.push(`V = ${row.gasVolumeL} л (${conditionsLabel})`);
      return `${row.formula}: ${parts.join('; ')}`;
    });
    steps.push(practicalProducts.length === 1 ? `Практические значения: ${values[0]}.` : `Практические значения продуктов: ${values.join('; ')}.`);
  }
  return {
    status: 'ok',
    equation,
    coefficients: balanced.coefficients,
    equationUnicode: equationToUnicode(equation, balanced.coefficients),
    rows,
    knownIndex,
    knownMoles: knownMoles === null ? null : rounded(knownMoles),
    basisIndex,
    basisMoles: rounded(basisMoles),
    basisSource: limitingIndex === null ? 'known' : 'limiting',
    availableCount: available.size,
    availableFormula,
    limitingIndex,
    limitingFormula: limitingIndex === null ? null : species[limitingIndex].formula,
    yieldPercent,
    gasConditions,
    conditionsLabel,
    molarVolume,
    hasGasProduct,
    practicalProducts,
    targetProduct,
    steps
  };
}
