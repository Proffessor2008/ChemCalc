import test from 'node:test';
import assert from 'node:assert/strict';
import { bondType, bufferPH, calculatePH, checkIonPair, galvanicCell, nernst, willDisplace } from '../js/reference-tables.js';

test('растворимость: AgCl и BaSO4 — Н, NaCl — Р', () => {
  assert.equal(checkIonPair('Ag^+', 'Cl^-').status, 'Н');
  assert.ok(checkIonPair('Ag^+', 'Cl^-').record.ksp > 0);
  assert.equal(checkIonPair('Ba^2+', 'SO4^2-').status, 'Н');
  assert.equal(checkIonPair('Na^+', 'Cl^-').status, 'Р');
});

test('ряд активности: Zn вытесняет Cu, Cu не вытесняет Zn', () => {
  assert.equal(willDisplace('Zn', 'Cu').possible, true);
  assert.equal(willDisplace('Cu', 'Zn').possible, false);
  assert.equal(willDisplace('Na', 'Cu').possible, false);
});

test('Δχ: HCl полярная, NaCl ионная ориентировочно, F максимальна', () => {
  assert.equal(bondType('H', 'Cl').type, 'Ковалентная полярная');
  assert.equal(bondType('Na', 'Cl').type, 'Ионная (ориентировочно)');
  assert.equal(bondType('F', 'F').delta, 0);
});

test('pH 0,1 М уксусной кислоты и HCl', () => {
  assert.ok(Math.abs(calculatePH('acetic', 0.1).pH - 2.8829) < 0.001);
  assert.equal(calculatePH('hcl', 0.1).pH, 1);
  assert.ok(Math.abs(calculatePH('ammonia', 0.1).pH - 11.13) < 0.02);
  assert.throws(() => calculatePH('acetic', 0), /положительным/);
});

test('буфер и Нернст', () => {
  assert.equal(bufferPH(4.76, 0.1, 0.1).pH, 4.76);
  assert.ok(Math.abs(bufferPH(4.76, 0.1, 0.2).pH - 5.06103) < 0.0001);
  const result = nernst(0, 2, 100, 298.15);
  assert.ok(Math.abs(result.E + 0.059159) < 0.0001);
});

test('элемент Даниэля: E°, ΔG°, K и суммарное уравнение', () => {
  const result = galvanicCell('zinc', 'copper');
  assert.ok(Math.abs(result.E0 - 1.0998) < 1e-9);
  assert.ok(Math.abs(result.deltaG + 212.229) < 0.001);
  assert.ok(Math.abs(result.logK - 37.17) < 0.02);
  assert.equal(result.equation, 'Zn + Cu^2+ = Zn^2+ + Cu');
  assert.equal(result.possible, true);
});
