import { parseFormula } from './parser.js';

export class LabError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'LabError';
    this.code = code;
    this.details = details;
  }
}

const VOLUME = { L: 1, mL: 0.001, µL: 0.000001 };
const CONCENTRATION = {
  'mol/L': { group: 'molar', factor: 1 },
  'mmol/L': { group: 'molar', factor: 0.001 },
  'µmol/L': { group: 'molar', factor: 0.000001 },
  'g/L': { group: 'mass', factor: 1 },
  'mg/L': { group: 'mass', factor: 0.001 },
  'mg/mL': { group: 'mass', factor: 1 }
};
const UNIT_GROUPS = {
  mass: { label: 'mass', units: { kg: 1000, g: 1, mg: 0.001, µg: 0.000001 } },
  volume: { label: 'volume', units: VOLUME },
  amount: { label: 'amount', units: { mol: 1, mmol: 0.001, µmol: 0.000001 } },
  molar: { label: 'molar', units: { 'mol/L': 1, 'mmol/L': 0.001, 'µmol/L': 0.000001 } },
  massConcentration: { label: 'massConcentration', units: { 'g/L': 1, 'mg/L': 0.001, 'mg/mL': 1 } }
};

function ensurePositive(value, code = 'labPositive') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new LabError(code);
  return number;
}

function ensureRange(value, min, max, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new LabError(code);
  return number;
}

export function formulaMolarMass(formula) {
  try {
    return parseFormula(formula).molarMass;
  } catch {
    throw new LabError('labInvalidFormula');
  }
}

export function unitGroup(unit) {
  for (const [group, value] of Object.entries(UNIT_GROUPS)) {
    if (Object.hasOwn(value.units, unit)) return group;
  }
  return null;
}

export function unitsForGroup(group) {
  return Object.keys(UNIT_GROUPS[group]?.units || {});
}

export function convertUnits(value, from, to) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new LabError('labInvalidNumber');
  if (from === to) return number;
  const group = unitGroup(from);
  if (!group || group !== unitGroup(to)) throw new LabError('labIncompatibleUnits');
  return number * UNIT_GROUPS[group].units[from] / UNIT_GROUPS[group].units[to];
}

function volumeToLiters(value, unit) {
  if (!Object.hasOwn(VOLUME, unit)) throw new LabError('labUnknownUnit');
  return ensurePositive(value) * VOLUME[unit];
}

export function prepareFromSolid({ formula, target, targetUnit = 'mol/L', volume, volumeUnit = 'mL', purity = 100 }) {
  const molarMass = formulaMolarMass(formula);
  const volumeL = volumeToLiters(volume, volumeUnit);
  const purityFactor = ensureRange(purity, 0.000001, 100, 'labPercentRange') / 100;
  const entry = CONCENTRATION[targetUnit];
  if (!entry) throw new LabError('labUnknownUnit');
  const targetValue = ensurePositive(target);
  let pureMass;
  let moles;
  let concentrationM;
  if (entry.group === 'molar') {
    concentrationM = targetValue * entry.factor;
    moles = concentrationM * volumeL;
    pureMass = moles * molarMass;
  } else {
    pureMass = targetValue * entry.factor * volumeL;
    moles = pureMass / molarMass;
    concentrationM = moles / volumeL;
  }
  return {
    formula,
    molarMass,
    volumeL,
    concentrationM,
    moles,
    pureMass,
    stockMass: pureMass / purityFactor,
    purity
  };
}

export function prepareFromMassFraction({ formula, massPercent, density, volume, volumeUnit = 'mL', purity = 100 }) {
  const molarMass = formulaMolarMass(formula);
  const volumeL = volumeToLiters(volume, volumeUnit);
  const percent = ensureRange(massPercent, 0.000001, 100, 'labPercentRange');
  const densityValue = ensurePositive(density, 'labPositive');
  const purityFactor = ensureRange(purity, 0.000001, 100, 'labPercentRange') / 100;
  const solutionMass = volumeL * 1000 * densityValue;
  const pureMass = solutionMass * percent / 100;
  const stockMass = pureMass / purityFactor;
  const moles = pureMass / molarMass;
  return {
    formula,
    molarMass,
    volumeL,
    solutionMass,
    pureMass,
    stockMass,
    moles,
    molarity: moles / volumeL,
    massPercent: percent,
    density: densityValue,
    purity
  };
}

export function massFractionToMolarity({ massPercent, density, molarMass }) {
  const percent = ensureRange(massPercent, 0, 100, 'labPercentRange');
  const densityValue = ensurePositive(density, 'labPositive');
  const molarMassValue = ensurePositive(molarMass, 'labPositive');
  return (percent * densityValue * 10) / molarMassValue;
}

export function dilution({ stockConcentration, stockUnit, finalConcentration, finalUnit, finalVolume, finalVolumeUnit = 'mL' }) {
  const stockEntry = CONCENTRATION[stockUnit];
  const finalEntry = CONCENTRATION[finalUnit];
  if (!stockEntry || !finalEntry) throw new LabError('labUnknownUnit');
  if (stockEntry.group !== finalEntry.group) throw new LabError('labIncompatibleUnits');
  const stock = ensurePositive(stockConcentration) * stockEntry.factor;
  const final = ensurePositive(finalConcentration) * finalEntry.factor;
  if (stock <= final) throw new LabError('labDilutionImpossible');
  const volumeL = volumeToLiters(finalVolume, finalVolumeUnit);
  const stockL = final * volumeL / stock;
  if (stockL > volumeL + 1e-12) throw new LabError('labDilutionImpossible');
  return {
    stockVolumeL: stockL,
    solventVolumeL: Math.max(0, volumeL - stockL),
    finalVolumeL: volumeL,
    stockConcentration: stock,
    finalConcentration: final
  };
}

export function bufferFromTarget({ pKa, targetPh, totalConcentration, volume, volumeUnit = 'mL' }) {
  const pkaValue = ensureRange(pKa, -2, 16, 'labInvalidPka');
  const phValue = ensureRange(targetPh, 0, 14, 'labInvalidPh');
  const total = ensurePositive(totalConcentration, 'labPositive');
  const volumeL = volumeToLiters(volume, volumeUnit);
  const ratio = 10 ** (phValue - pkaValue);
  const baseFraction = ratio / (1 + ratio);
  const acidFraction = 1 / (1 + ratio);
  const baseConcentration = total * baseFraction;
  const acidConcentration = total * acidFraction;
  return {
    pKa: pkaValue,
    targetPh: phValue,
    ratio,
    totalConcentration: total,
    volumeL,
    baseFraction,
    acidFraction,
    baseConcentration,
    acidConcentration,
    baseMoles: baseConcentration * volumeL,
    acidMoles: acidConcentration * volumeL,
    weakCapacity: Math.abs(phValue - pkaValue) > 1
  };
}

export function bufferPh({ pKa, acidConcentration, baseConcentration }) {
  const pkaValue = ensureRange(pKa, -2, 16, 'labInvalidPka');
  const acid = ensurePositive(acidConcentration, 'labPositive');
  const base = ensurePositive(baseConcentration, 'labPositive');
  return pkaValue + Math.log10(base / acid);
}
