import acidBaseData from '../data/acid-base-constants.json' with { type: 'json' };
import activityData from '../data/activity-series.json' with { type: 'json' };
import electrodeData from '../data/electrode-potentials.json' with { type: 'json' };
import electronegativityData from '../data/electronegativity.json' with { type: 'json' };
import solubilityData from '../data/solubility.json' with { type: 'json' };
import { electrolyteRecord } from './electrolytes.js';
import { FARADAY, GAS_CONSTANT, nernst } from './physical-constants.js';
import { formulaFromIons } from './predictor.js';

export { FARADAY, GAS_CONSTANT, nernst };
export const ACID_BASE_RECORDS = acidBaseData.records;
export const ELECTRODE_RECORDS = electrodeData.records;
export const ELECTRONEGATIVITY_RECORDS = electronegativityData.records;
export const REFERENCE_SOURCES = {
  solubility: solubilityData.source,
  activity: activityData.source,
  electronegativity: electronegativityData.source,
  'acid-base': acidBaseData.source,
  electrodes: electrodeData.source
};

export function checkIonPair(cation, anion) {
  const formula = formulaFromIons(cation, anion);
  const record = electrolyteRecord(formula);
  return {
    formula,
    status: record?.solubility || '?',
    record: record || null,
    explanation: record ? `${formula}: ${solubilityData.legend[record.solubility]}.` : 'В локальной таблице нет данных для этой пары.'
  };
}

export function willDisplace(first, second) {
  const order = activityData.order;
  const firstIndex = order.indexOf(first);
  const secondIndex = order.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0) return { possible: null, message: 'Нет данных о положении металла в ряду активности.' };
  if (['Li', 'K', 'Ba', 'Ca', 'Na'].includes(first)) return { possible: false, message: `${first} реагирует с водой раствора; простое правило вытеснения из соли неприменимо.` };
  if (firstIndex >= secondIndex) return { possible: false, message: `${first} стоит правее ${second} или совпадает с ним, поэтому не вытесняет его из раствора соли.` };
  return { possible: true, message: `${first} стоит левее ${second}: в типовом водном растворе вытеснение термодинамически разрешено правилом активности.` };
}

export function bondType(first, second) {
  const a = ELECTRONEGATIVITY_RECORDS.find((record) => record.symbol === first);
  const b = ELECTRONEGATIVITY_RECORDS.find((record) => record.symbol === second);
  if (!a || !b || a.pauling === null || b.pauling === null) return { delta: null, type: 'Нет данных', message: 'Для выбранной пары значение по Полингу отсутствует.' };
  const delta = Math.abs(a.pauling - b.pauling);
  const type = delta < 0.4 ? 'Ковалентная неполярная' : delta < 1.7 ? 'Ковалентная полярная' : 'Ионная (ориентировочно)';
  const more = a.pauling === b.pauling ? null : a.pauling > b.pauling ? a : b;
  return { delta, type, direction: more ? `δ− на ${more.symbol}; δ+ на ${more.symbol === first ? second : first}` : 'Смещения нет', message: 'Границы Δχ условны; реальный характер связи зависит от структуры вещества.' };
}

function validateConcentration(value) {
  const concentration = Number(value);
  if (!Number.isFinite(concentration) || concentration <= 0) throw new RangeError('Концентрация должна быть положительным числом');
  return concentration;
}

export function calculatePH(recordId, concentrationValue) {
  const record = ACID_BASE_RECORDS.find((item) => item.id === recordId);
  if (!record) throw new RangeError('Выберите кислоту или основание');
  const concentration = validateConcentration(concentrationValue);
  let h;
  let oh;
  let approximate;
  let alpha = null;
  const steps = [];
  if (record.strength === 'strong' && record.type === 'acid') {
    h = concentration;
    steps.push('Для сильной одноосновной кислоты в разбавленном растворе [H+] ≈ c.', `pH = −lg(${concentration})`);
  } else if (record.strength === 'strong' && record.type === 'base') {
    oh = concentration;
    steps.push('Для сильного одноосновного основания [OH−] ≈ c.', `pOH = −lg(${concentration}); pH = 14 − pOH`);
  } else if (record.type === 'acid') {
    const ka = 10 ** (-record.pKa);
    h = (-ka + Math.sqrt(ka ** 2 + 4 * ka * concentration)) / 2;
    approximate = Math.sqrt(ka * concentration);
    alpha = h / concentration;
    steps.push(`Ka = 10^(−${record.pKa}) = ${ka.toExponential(4)}.`, 'Ka = x² / (c − x); точное решение: x = (−Ka + √(Ka² + 4Ka·c)) / 2.', `Приближение x ≈ √(Ka·c) = ${approximate.toExponential(4)} моль/л.`);
  } else {
    const kb = 10 ** (-record.pKb);
    oh = (-kb + Math.sqrt(kb ** 2 + 4 * kb * concentration)) / 2;
    approximate = Math.sqrt(kb * concentration);
    alpha = oh / concentration;
    steps.push(`Kb = 10^(−${record.pKb}) = ${kb.toExponential(4)}.`, 'Точное решение квадратного уравнения даёт [OH−].', `Приближение [OH−] ≈ √(Kb·c) = ${approximate.toExponential(4)} моль/л; pH = 14 − pOH.`);
  }
  const pH = h ? -Math.log10(h) : 14 + Math.log10(oh);
  steps.push(`pH = ${pH.toFixed(4)}.`);
  if (record.step) steps.push('Расчёт ведётся только по выбранной ступени; последующие равновесия не учитываются.');
  if (pH < 0 || pH > 14) steps.push('Значение вне обычного диапазона 0–14: при высокой концентрации нужны активности, а не идеальное приближение.');
  return { pH, alpha, approximate, record, steps };
}

export function bufferPH(pKaValue, acidValue, baseValue) {
  const pKa = Number(pKaValue);
  const acid = validateConcentration(acidValue);
  const base = validateConcentration(baseValue);
  if (!Number.isFinite(pKa)) throw new RangeError('Введите корректный pKa');
  const ratio = base / acid;
  const pH = pKa + Math.log10(ratio);
  return { pH, applicable: ratio >= 0.1 && ratio <= 10, note: ratio >= 0.1 && ratio <= 10 ? 'Соотношение находится в типовой области применимости уравнения.' : 'Отношение вне 0,1–10: оценка менее надёжна; проверьте ионную силу и равновесия.', steps: [`pH = pKa + lg(c основания / c кислоты) = ${pKa} + lg(${base} / ${acid}) = ${pH.toFixed(4)}.`] };
}

function integerLcm(a, b) {
  const gcd = (x, y) => y ? gcd(y, x % y) : x;
  return Math.abs(a * b) / gcd(a, b);
}

export function galvanicCell(firstId, secondId, temperatureK = 298.15) {
  const first = ELECTRODE_RECORDS.find((record) => record.id === firstId);
  const second = ELECTRODE_RECORDS.find((record) => record.id === secondId);
  if (!first || !second || first.id === second.id) throw new RangeError('Выберите две разные полуреакции');
  const cathode = first.E0_V >= second.E0_V ? first : second;
  const anode = first.E0_V >= second.E0_V ? second : first;
  const electrons = integerLcm(cathode.electrons, anode.electrons);
  const E0 = cathode.E0_V - anode.E0_V;
  const deltaG = -electrons * FARADAY * E0 / 1000;
  const logK = electrons * FARADAY * E0 / (GAS_CONSTANT * temperatureK) / Math.LN10;
  const cathodeMultiplier = electrons / cathode.electrons;
  const anodeMultiplier = electrons / anode.electrons;
  const term = (coefficient, formula) => `${coefficient === 1 ? '' : coefficient}${formula}`;
  const equation = `${term(anodeMultiplier, anode.reduced)} + ${term(cathodeMultiplier, cathode.oxidized)} = ${term(anodeMultiplier, anode.oxidized)} + ${term(cathodeMultiplier, cathode.reduced)}`;
  return {
    cathode, anode, electrons, E0, deltaG, logK, K: logK < 308 ? 10 ** logK : Infinity,
    equation,
    notation: `${anode.reduced}(−) | ${anode.oxidized} || ${cathode.oxidized} | ${cathode.reduced}(+)`,
    possible: E0 > 0,
    note: 'Положительная ЭДС показывает термодинамическую возможность, но не гарантирует скорость процесса.'
  };
}
