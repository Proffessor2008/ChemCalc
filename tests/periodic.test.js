import test from 'node:test';
import assert from 'node:assert/strict';
import elementData from '../data/elements.json' with { type: 'json' };
import { ELEMENT_BY_NUMBER, PERIODIC_ELEMENTS, elementMetric, filterElements, phaseAt } from '../js/periodic-table.js';

const requiredFields = ['number', 'symbol', 'name_ru', 'name_en', 'name_lat', 'atomic_mass', 'category', 'group', 'period', 'block', 'electron_configuration', 'shells', 'oxidation_states', 'electronegativity', 'atomic_radius', 'ionization_energies', 'electron_affinity', 'density', 'melt_K', 'boil_K', 'phase_stp', 'color', 'crystal_structure', 'isotopes', 'discovered_by', 'discovery_year', 'named_by', 'etymology', 'occurrence', 'production', 'applications', 'biological_role', 'hazards', 'facts', 'sources'];

test('данные содержат ровно 118 последовательных элементов', () => {
  assert.equal(PERIODIC_ELEMENTS.length, 118);
  assert.deepEqual(PERIODIC_ELEMENTS.map((element) => element.number), Array.from({ length: 118 }, (_, index) => index + 1));
  assert.equal(new Set(PERIODIC_ELEMENTS.map((element) => element.symbol)).size, 118);
  assert.equal(new Set(PERIODIC_ELEMENTS.map((element) => `${element.xpos}:${element.ypos}`)).size, 118);
});

test('каждая запись имеет поля схемы, русское имя и источники', () => {
  for (const element of PERIODIC_ELEMENTS) {
    for (const field of requiredFields) assert.ok(Object.hasOwn(element, field), `${element.symbol}: ${field}`);
    assert.ok(element.name_ru.length > 0, element.symbol);
    assert.ok(element.name_en.length > 0, element.symbol);
    assert.ok(element.atomic_mass > 0, element.symbol);
    assert.ok(element.sources.length >= 2, element.symbol);
    assert.ok(element.sources.every((source) => source.label && source.url.startsWith('https://')));
    assert.ok(element.period >= 1 && element.period <= 7);
    assert.ok(element.group === null || element.group >= 1 && element.group <= 18);
    assert.equal(element.shells.reduce((sum, count) => sum + count, 0), element.number, element.symbol);
  }
});

test('лантаноиды и актиноиды находятся отдельными рядами', () => {
  const lanthanides = PERIODIC_ELEMENTS.filter((element) => element.category === 'lanthanide');
  const actinides = PERIODIC_ELEMENTS.filter((element) => element.category === 'actinide');
  assert.equal(lanthanides.length, 15);
  assert.equal(actinides.length, 15);
  assert.ok(lanthanides.every((element) => element.ypos === 9));
  assert.ok(actinides.every((element) => element.ypos === 10));
});

test('галогены выделены отдельно, F имеет максимальную электроотрицательность', () => {
  assert.deepEqual(PERIODIC_ELEMENTS.filter((element) => element.category === 'halogen').map((element) => element.symbol), ['F', 'Cl', 'Br', 'I', 'At', 'Ts']);
  const maximum = Math.max(...PERIODIC_ELEMENTS.map((element) => element.electronegativity ?? -Infinity));
  assert.equal(maximum, 3.98);
  assert.equal(ELEMENT_BY_NUMBER.get(9).electronegativity, maximum);
});

test('поиск работает по символу, русскому и английскому имени и номеру', () => {
  for (const query of ['Fe', 'железо', 'Iron', '26']) {
    const result = filterElements(PERIODIC_ELEMENTS, query);
    assert.ok(result.some((element) => element.symbol === 'Fe'), query);
  }
  assert.deepEqual(filterElements(PERIODIC_ELEMENTS, 'Fe', { period: '4' }).map((element) => element.symbol), ['Fe']);
  assert.equal(filterElements(PERIODIC_ELEMENTS, '', { group: '2' }).length, 6);
});

test('фильтры типа и радиоактивности работают', () => {
  const metals = filterElements(PERIODIC_ELEMENTS, '', { type: 'metal' });
  const nonmetals = filterElements(PERIODIC_ELEMENTS, '', { type: 'nonmetal' });
  const radioactive = filterElements(PERIODIC_ELEMENTS, '', { radioactive: true });
  assert.ok(metals.some((element) => element.symbol === 'Fe'));
  assert.ok(!metals.some((element) => element.symbol === 'O'));
  assert.ok(nonmetals.some((element) => element.symbol === 'O'));
  assert.ok(radioactive.some((element) => element.symbol === 'Tc'));
  assert.ok(radioactive.some((element) => element.symbol === 'U'));
  assert.ok(!radioactive.some((element) => element.symbol === 'Fe'));
});

test('агрегатное состояние вычисляется по температуре без выдумывания неизвестных значений', () => {
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(1), 298), 'gas');
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(1), 0), 'solid');
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(26), 298), 'solid');
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(80), 298), 'liquid');
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(118), 298), 'unknown');
  assert.equal(phaseAt(ELEMENT_BY_NUMBER.get(1), -1), 'unknown');
});

test('ионные радиусы содержат ион, координацию и источник, а неподтверждённые значения остаются null', () => {
  const enriched = PERIODIC_ELEMENTS.filter((element) => element.ionic_radius !== null);
  assert.equal(enriched.length, 31);
  for (const element of enriched) {
    assert.match(element.ionic_radius_note, /, CN=[46]$/);
    assert.equal(element.ionic_radius_source, 'https://winter.group.shef.ac.uk/webelements/periodicity/ionic_radius/');
    assert.ok(element.sources.some((source) => source.url === element.ionic_radius_source), element.symbol);
  }
  assert.equal(ELEMENT_BY_NUMBER.get(6).ionic_radius_note, 'C⁴⁺, CN=4');
  assert.equal(ELEMENT_BY_NUMBER.get(26).ionic_radius_note, 'Fe²⁺, high spin, CN=6');
  for (const symbol of ['H', 'He', 'Ne', 'Ar', 'Kr']) assert.equal(PERIODIC_ELEMENTS.find((element) => element.symbol === symbol).ionic_radius, null);
  const magnesium = ELEMENT_BY_NUMBER.get(12);
  assert.equal(magnesium.discovery_year, 1755);
  assert.ok(magnesium.sources.some((source) => source.url === 'https://www.rsc.org/periodic-table/element/12/magnesium'));
});

test('метрики возвращают null при отсутствии данных', () => {
  assert.equal(elementMetric(ELEMENT_BY_NUMBER.get(9), 'electronegativity'), 3.98);
  assert.equal(elementMetric(ELEMENT_BY_NUMBER.get(1), 'discovery'), 1766);
  assert.equal(elementMetric(ELEMENT_BY_NUMBER.get(118), 'discovery'), null);
});
