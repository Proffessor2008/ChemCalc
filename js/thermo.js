import thermoData from '../data/thermo.json' with { type: 'json' };
import thermoExtraData from '../data/thermo-extra.json' with { type: 'json' };
import solubilityData from '../data/solubility.json' with { type: 'json' };
import { balanceEquation } from './balancer.js';
import { buildIonicEquations } from './ionic.js';
import { t } from './i18n.js';
import { parseEquation } from './parser.js';
import { GAS_CONSTANT } from './physical-constants.js';

export const THERMO_RECORDS = [...thermoData.records, ...thermoExtraData.records];
export const THERMO_SOURCE = `${thermoData.source}; ${thermoExtraData.source}`;
const ALIASES = { CH3COOH: 'C2H4O2', HCOOH: 'CH2O2', C2H5OH: 'C2H6O', CH3CH2OH: 'C2H6O', CH3OH: 'CH4O', CH3CHO: 'C2H4O', CH3OCH3: 'C2H6O', CH3NH2: 'C2H7N', '(CH3)2NH': 'C2H7N', C3H8: 'C3H8' };
const PREFERRED_CAS = { C2H5OH: '64-17-5', CH3CH2OH: '64-17-5', CH3OCH3: '115-10-6', CH3CHO: '75-07-0', CH3NH2: '75-04-7', '(CH3)2NH': '124-40-3' };
const DEFAULT_PHASES = {
  H2O: 'l', H2O2: 'l', H2SO4: 'l', C2H6O: 'l', CH4O: 'l', C2H4O2: 'l', CH2O2: 'l', C6H6: 'l',
  C: 's', S: 's', Fe: 's', Cu: 's', Zn: 's', Mg: 's', Cr: 's', W: 's', NaCl: 's', Na2SO4: 's', K2SO4: 's',
  CaCO3: 's', CaO: 's', 'Ca(OH)2': 's', Na2CO3: 's', K2CO3: 's', MnO2: 's', SiO2: 's', CuCl2: 's', ZnCl2: 's',
  ZnSO4: 's', BaSO4: 's', NH4Cl: 's', 'Fe(OH)3': 's', 'Fe(OH)2': 's', AgNO3: 's', AgCl: 's', CuO: 's', Fe3O4: 's',
  'Al2(SO4)3': 's', Na2O: 's', Cr2O3: 's', BeO: 's', NaBr: 's', CaSO4: 's', C6H12O6: 's', ZnS: 's', WO3: 's',
  HgO: 's', 'Mg(OH)2': 's', FeCl2: 's', FeCl3: 's', CrCl3: 's', FeS2: 's', FeS: 's', NaNO3: 's',
  NH3: 'g', SO3: 'g', C2H2: 'g', HF: 'g', HBr: 'g'
};
const PHASE_FROM_STATE = { s: 's', 'тв': 's', l: 'l', 'ж': 'l', g: 'g', 'г': 'g', aq: 'aq', 'р-р': 'aq' };

export function findThermoRecord(formula, phase = null) {
  const normalized = ALIASES[formula] || formula;
  const matches = THERMO_RECORDS.filter((record) => record.formula === normalized && (!phase || record.phase === phase));
  if (phase === 's' && normalized === 'C') return matches.find((record) => record.cas === '7782-42-5') || null;
  const preferredCas = PREFERRED_CAS[formula];
  if (preferredCas) return matches.find((record) => record.cas === preferredCas) || null;
  return matches[0] || null;
}

export function recordForSpecies(species, options = {}) {
  let phase = PHASE_FROM_STATE[species.state] || (species.annotation === '↑' ? 'g' : species.annotation === '↓' ? 's' : species.charge !== 0 ? 'aq' : null);
  if (!phase && options.solvent === 'aqueous') {
    const solubility = solubilityData.substances[species.formula];
    if (solubility && ['Р', 'М'].includes(solubility.solubility)) phase = 'aq';
    else if (findThermoRecord(species.formula, 'aq')) phase = 'aq';
  }
  phase ||= DEFAULT_PHASES[species.formula] || null;
  return findThermoRecord(species.formula, phase);
}

function round(value, digits = 6) {
  return Number(value.toPrecision(digits));
}

export function gibbsAtTemperature(deltaH, deltaS, temperature) {
  return deltaH - temperature * deltaS / 1000;
}

export function calculateReactionThermo(input, options = {}) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  if (options.ionic) {
    const ionic = buildIonicEquations(equation);
    if (ionic.status !== 'ok') return { status: ionic.status, message: t('ionicThermoUnavailable', { message: ionic.message }) };
    const result = calculateReactionThermo(ionic.netEquation, { ...options, ionic: false, solvent: 'aqueous' });
    return {
      ...result,
      ionic,
      note: result.status === 'ok' ? `${result.note} ${t('ionicThermoNote')}` : result.note
    };
  }
  const balanced = balanceEquation(equation);
  if (balanced.status !== 'balanced') return { status: balanced.status, message: balanced.message };
  const species = [...equation.left, ...equation.right];
  const coefficients = balanced.coefficients;
  const selected = species.map((item, index) => ({ species: item, coefficient: coefficients[index], record: recordForSpecies(item, options) }));
  const missing = selected.filter((entry) => !entry.record);
  if (missing.length) {
    return {
      status: 'missing-data',
      missing: missing.map((entry) => entry.species.formula),
      message: t('missingThermo', { formulas: missing.map((entry) => entry.species.formula).join(', ') })
    };
  }
  const deltaH = selected.reduce((sum, entry) => sum + (entry.species && equation.left.includes(entry.species) ? -1 : 1) * entry.coefficient * entry.record.Hf_kJ_mol, 0);
  const deltaG = selected.reduce((sum, entry) => sum + (equation.left.includes(entry.species) ? -1 : 1) * entry.coefficient * entry.record.Gf_kJ_mol, 0);
  const deltaS = selected.reduce((sum, entry) => sum + (equation.left.includes(entry.species) ? -1 : 1) * entry.coefficient * entry.record.S_J_mol_K, 0);
  const temperature = Number(options.temperatureK || 298.15);
  if (!Number.isFinite(temperature) || temperature <= 0) throw new RangeError('Температура должна быть положительной, в K');
  const deltaG_T = gibbsAtTemperature(deltaH, deltaS, temperature);
  const logK = -deltaG * 1000 / (GAS_CONSTANT * 298.15) / Math.LN10;
  const transition = deltaS !== 0 ? deltaH * 1000 / deltaS : null;
  const termLines = selected.map((entry) => `${equation.left.includes(entry.species) ? '−' : '+'} ${entry.coefficient} × ${entry.species.formula} (${entry.record.phase}): ΔfH° = ${entry.record.Hf_kJ_mol} кДж/моль, S° = ${entry.record.S_J_mol_K} Дж/(моль·K)`);
  const curve = Array.from({ length: 25 }, (_, index) => {
    const T = 200 + index * 50;
    return { temperature: T, deltaG: gibbsAtTemperature(deltaH, deltaS, T) };
  });
  return {
    status: 'ok', equation, coefficients, selected, deltaH: round(deltaH), deltaG: round(deltaG), deltaS: round(deltaS), deltaG_T: round(deltaG_T), temperature,
    logK, K: logK < 308 ? 10 ** logK : Infinity,
    effect: deltaH < 0 ? 'Экзотермическая реакция' : deltaH > 0 ? 'Эндотермическая реакция' : 'ΔH° = 0',
    spontaneous: deltaG_T < 0 ? 'Термодинамически самопроизвольна в стандартном приближении' : deltaG_T > 0 ? 'В стандартном приближении несамопроизвольна' : 'Система в равновесии при выбранном приближении',
    transitionK: transition !== null && transition > 0 ? round(transition) : null,
    curve,
    steps: ['ΔH°р = Σν·ΔfH°(продукты) − Σν·ΔfH°(реагенты)', ...termLines, `ΔH° = ${round(deltaH)} кДж; ΔS° = ${round(deltaS)} Дж/K; ΔG°(298) = ${round(deltaG)} кДж.`, `ΔG(${temperature} K) ≈ ΔH° − TΔS° = ${round(deltaG_T)} кДж.`, `ln K = −ΔG°/(RT); lg K = ${round(logK)}.`],
    note: 'Для ΔG(T) использовано приближение независимости ΔH° и ΔS° от температуры. Оно не учитывает фазовые переходы и теплоёмкости. Небольшие различия ΔG° и ΔH°−TΔS° при 298 K связаны с округлением табличных данных.'
  };
}

export function calculateIonicReactionThermo(input, options = {}) {
  return calculateReactionThermo(input, { ...options, ionic: true });
}
