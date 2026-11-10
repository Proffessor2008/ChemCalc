import substanceData from '../data/substances.json' with { type: 'json' };
import communityData from '../data/reaction-rules-community.json' with { type: 'json' };
import { balanceEquation } from './balancer.js';
import { equationToUnicode, parseEquation } from './parser.js';

const SUBSTANCES = new Map([...substanceData.items, ...communityData.substances].map((item) => [item.formula, item]));
const GASES = new Set(['H2', 'O2', 'Cl2', 'N2', 'F2', 'CO2', 'CO', 'NO', 'NO2', 'SO2', 'H2S', 'NH3', 'CH4', 'C2H6', 'C3H8', 'HCl']);
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
  return species.state === 'g' || species.annotation === '↑' || GASES.has(species.formula);
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
  const knownMoles = amountFromInput(species[knownIndex], { ...options.known, gasConditions });
  let scale = knownMoles / balanced.coefficients[knownIndex];
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
    scale = minimum;
  }
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
    return {
      index,
      side: isProduct ? 'right' : 'left',
      formula: item.formula,
      name: SUBSTANCES.get(item.formula)?.name_ru || 'Нет данных',
      coefficient: balanced.coefficients[index],
      molarMass: item.molarMass,
      moles: rounded(moles),
      massG: rounded(moles * item.molarMass),
      gasVolumeL: isGas(item) ? rounded(moles * molarVolume) : null,
      actualMoles: applyYield ? rounded(actualMoles) : null,
      actualMassG: applyYield ? rounded(actualMoles * item.molarMass) : null,
      actualGasVolumeL: applyYield && isGas(item) ? rounded(actualMoles * molarVolume) : null,
      availableMoles: available.get(index) ?? null,
      remainingMoles: available.has(index) ? rounded(available.get(index) - moles) : null
    };
  });
  const known = species[knownIndex];
  const steps = [
    `Молярная масса ${known.formula}: M = ${known.molarMass.toFixed(3)} г/моль.`,
    `Количество известного вещества: n = ${rounded(knownMoles)} моль.`,
    `По коэффициентам уравнения базовый масштаб: n / ν = ${rounded(knownMoles)} / ${balanced.coefficients[knownIndex]} = ${rounded(scale)} моль.`,
    'Для каждого вещества nᵢ = νᵢ × масштаб; mᵢ = nᵢ × Mᵢ.',
    `Для газов V = n × ${molarVolume} л/моль (${gasConditions === 'normal' ? 'н. у.' : 'САТП'}).`
  ];
  if (limitingIndex !== null) steps.push(`Лимитирующий реагент — ${species[limitingIndex].formula}: отношение n/ν у него наименьшее. Остальные вещества пересчитаны по нему.`);
  if (yieldPercent !== 100) steps.push(`Практическое количество и масса ${yieldProductIndex === null ? 'продуктов' : species[yieldProductIndex].formula}: теоретическое значение × ${yieldPercent} / 100.`);
  return {
    status: 'ok',
    equation,
    coefficients: balanced.coefficients,
    equationUnicode: equationToUnicode(equation, balanced.coefficients),
    rows,
    knownIndex,
    knownMoles: rounded(knownMoles),
    limitingIndex,
    limitingFormula: limitingIndex === null ? null : species[limitingIndex].formula,
    yieldPercent,
    gasConditions,
    molarVolume,
    steps
  };
}
