import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/build-elements.mjs /path/to/PeriodicTableJSON.json');
const sourceText = readFileSync(resolve(sourcePath), 'utf8');
const source = JSON.parse(sourceText.slice(sourceText.indexOf('{')));
const current = JSON.parse(readFileSync(new URL('../data/elements.json', import.meta.url), 'utf8'));
const overrides = JSON.parse(readFileSync(new URL('../data/element-overrides.json', import.meta.url), 'utf8'));
const russian = new Map(current.elements.map((element) => [element.symbol, element]));
const radioactive = new Set([43, 61]);
const halogens = new Set(['F', 'Cl', 'Br', 'I', 'At', 'Ts']);

function category(value, symbol) {
  if (halogens.has(symbol)) return ['halogen', 'Галоген'];
  const text = String(value || '').toLowerCase();
  if (text.includes('post-transition')) return ['post-transition', 'Постпереходный металл'];
  if (text.includes('transition metal')) return ['transition-metal', 'Переходный металл'];
  if (text.includes('alkaline earth')) return ['alkaline-earth', 'Щёлочноземельный металл'];
  if (text.includes('alkali metal')) return ['alkali-metal', 'Щелочной металл'];
  if (text.includes('lanthanide')) return ['lanthanide', 'Лантаноид'];
  if (text.includes('actinide')) return ['actinide', 'Актиноид'];
  if (text.includes('noble gas')) return ['noble-gas', 'Благородный газ'];
  if (text.includes('metalloid')) return ['metalloid', 'Металлоид'];
  if (text.includes('halogen')) return ['halogen', 'Галоген'];
  if (text.includes('nonmetal')) return ['nonmetal', 'Неметалл'];
  return ['unknown', 'Свойства не определены'];
}

function phase(value) {
  return { Gas: 'gas', Liquid: 'liquid', Solid: 'solid' }[value] || 'unknown';
}

const elements = source.elements.filter((item) => item.number <= 118).map((item) => {
  const base = russian.get(item.symbol);
  if (!base) throw new Error(`Missing Russian name for ${item.symbol}`);
  const extra = overrides[item.symbol] || {};
  const [categoryCode, categoryRu] = category(item.category, item.symbol);
  const isRadioactive = radioactive.has(item.number) || item.number >= 84;
  return {
    number: item.number,
    symbol: item.symbol,
    name_ru: base.name_ru,
    name_en: item.name,
    name_lat: extra.name_lat || null,
    atomic_mass: base.atomic_mass,
    category: categoryCode,
    category_ru: categoryRu,
    group: item.group || null,
    period: item.period,
    block: item.block || null,
    xpos: item.xpos,
    ypos: item.ypos,
    electron_configuration: item.electron_configuration || null,
    electron_configuration_short: item.electron_configuration_semantic || null,
    configuration_confirmed: !String(item.electron_configuration_semantic || '').startsWith('*'),
    shells: item.shells || [],
    oxidation_states: extra.oxidation_states || [],
    typical_oxidation_states: extra.typical_oxidation_states || [],
    electronegativity: item.electronegativity_pauling ?? null,
    atomic_radius: item.atomic_radii?.empirical?.[0] ?? item.atomic_radii?.calculated?.[0] ?? null,
    atomic_radii: item.atomic_radii || null,
    ionic_radius: null,
    ionization_energies: item.ionization_energies || [],
    electron_affinity: item.electron_affinity ?? null,
    density: item.density_g_cm3 ?? null,
    density_unit: 'g/cm³',
    density_note: item.phase === 'Gas' ? '0 °C, 1 atm' : 'Условия указаны исходным набором',
    melt_K: item.melt ?? null,
    boil_K: item.boil ?? null,
    phase_stp: phase(item.phase),
    color: extra.color || null,
    appearance_en: item.appearance || null,
    crystal_structure: null,
    molar_heat: item.molar_heat ?? null,
    fusion_heat: null,
    vaporization_heat: null,
    thermal_conductivity: null,
    electrical_resistivity: null,
    hardness: null,
    magnetic_properties: null,
    standard_electrode_potential: null,
    chemical_relations: null,
    characteristic_compounds: [],
    reactions: extra.reactions || [],
    isotopes: [],
    longest_radioisotope: null,
    discovery_context: /BC|BCE|Ancient|Bronze Age|Middle East|unknown/i.test(item.discovered_by || '') ? item.discovered_by : null,
    discovered_by: extra.discovered_by || (/BC|BCE|Ancient|Bronze Age|Middle East|unknown/i.test(item.discovered_by || '') ? null : item.discovered_by || null),
    discovery_year: extra.discovery_year ?? null,
    named_by: item.named_by || null,
    etymology: null,
    occurrence: null,
    abundance: { earth_crust: null, seawater: null, human_body: null },
    minerals: [],
    production: null,
    applications: extra.applications || [],
    biological_role: extra.biological_role || null,
    hazards: extra.hazards || (isRadioactive ? 'Радиоактивен. Требуются специализированные методы радиационной защиты.' : null),
    radioactive: isRadioactive,
    facts: extra.facts || [],
    sources: [
      { label: `Сведения: ${item.name}`, url: item.source },
      { label: 'Periodic-Table-JSON, структура и физические свойства', url: 'https://github.com/Bowserinator/Periodic-Table-JSON' },
      { label: 'CIAAW 2021, стандартная атомная масса', url: 'https://ciaaw.org/atomic-weights.htm' }
    ]
  };
});

const output = {
  source: 'CIAAW Standard Atomic Weights 2021; Bowserinator Periodic-Table-JSON',
  sources: [
    { label: 'CIAAW — Standard Atomic Weights 2021', url: 'https://ciaaw.org/atomic-weights.htm' },
    { label: 'Periodic-Table-JSON — данные и условия', url: 'https://github.com/Bowserinator/Periodic-Table-JSON' }
  ],
  license: 'Periodic-Table-JSON README: “Feel free to use it in your projects”; SPDX NOASSERTION. Wikipedia links retained per element; text summaries are not redistributed.',
  notes: ['Null означает отсутствие значения в выбранном источнике.', 'Температуры в K, радиусы в pm, энергии ионизации и сродство в kJ/mol, плотность приведена к g/cm³.'],
  elements
};

writeFileSync(new URL('../data/elements.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${elements.length} elements`);
