import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LabError, bufferFromTarget, bufferPh, convertUnits, dilution, formulaMolarMass,
  prepareFromMassFraction, prepareFromSolid
} from '../js/lab.js';

const close = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('лаборатория: молярная масса и приготовление раствора', () => {
  close(formulaMolarMass('NaCl'), 58.44, 0.01);
  close(formulaMolarMass('CuSO4·5H2O'), 249.677, 0.01);

  const prepared = prepareFromSolid({ formula: 'NaCl', target: 0.5, targetUnit: 'mol/L', volume: 250, volumeUnit: 'mL', purity: 100 });
  close(prepared.moles, 0.125);
  close(prepared.pureMass, 7.305, 0.005);
  close(prepared.stockMass, 7.305, 0.005);

  const impure = prepareFromSolid({ formula: 'NaCl', target: 0.5, targetUnit: 'mol/L', volume: 250, volumeUnit: 'mL', purity: 90 });
  close(impure.stockMass, 7.305 / 0.9, 0.01);

  const grams = prepareFromSolid({ formula: 'NaCl', target: 9, targetUnit: 'g/L', volume: 100, volumeUnit: 'mL' });
  close(grams.pureMass, 0.9);
  close(grams.moles, 0.9 / 58.44, 0.001);
});

test('лаборатория: массовая доля и разбавление', () => {
  const percent = prepareFromMassFraction({ formula: 'NaCl', massPercent: 0.9, density: 1, volume: 100, volumeUnit: 'mL', purity: 100 });
  close(percent.solutionMass, 100);
  close(percent.pureMass, 0.9);
  close(percent.molarity, 0.9 / 58.44 / 0.1, 0.001);

  const diluted = dilution({ stockConcentration: 1, stockUnit: 'mol/L', finalConcentration: 0.1, finalUnit: 'mol/L', finalVolume: 100, finalVolumeUnit: 'mL' });
  close(diluted.stockVolumeL, 0.01);
  close(diluted.solventVolumeL, 0.09);

  const massUnits = dilution({ stockConcentration: 10, stockUnit: 'g/L', finalConcentration: 1, finalUnit: 'g/L', finalVolume: 100, finalVolumeUnit: 'mL' });
  close(massUnits.stockVolumeL, 0.01);

  assert.throws(
    () => dilution({ stockConcentration: 1, stockUnit: 'mol/L', finalConcentration: 1, finalUnit: 'g/L', finalVolume: 100 }),
    (error) => error instanceof LabError && error.code === 'labIncompatibleUnits'
  );
});

test('лаборатория: единицы и буферы', () => {
  close(convertUnits(1, 'g', 'mg'), 1000);
  close(convertUnits(1, 'L', 'mL'), 1000);
  close(convertUnits(1, 'mol/L', 'mmol/L'), 1000);
  assert.throws(() => convertUnits(1, 'g', 'mL'), (error) => error instanceof LabError && error.code === 'labIncompatibleUnits');

  const buffer = bufferFromTarget({ pKa: 7.2, targetPh: 7.4, totalConcentration: 0.1, volume: 100, volumeUnit: 'mL' });
  close(buffer.ratio, 1.584893, 0.0001);
  close(buffer.acidConcentration + buffer.baseConcentration, 0.1, 0.00001);
  close(buffer.acidMoles + buffer.baseMoles, 0.01, 0.00001);
  assert.equal(buffer.weakCapacity, false);
  assert.equal(bufferFromTarget({ pKa: 7.2, targetPh: 9.2, totalConcentration: 0.1, volume: 100 }).weakCapacity, true);
  close(bufferPh({ pKa: 7.2, acidConcentration: 1, baseConcentration: 1 }), 7.2);
});
