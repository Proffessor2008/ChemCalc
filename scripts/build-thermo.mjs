import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [crcPath, ...identifierPaths] = process.argv.slice(2);
if (!crcPath || !identifierPaths.length) throw new Error('Usage: node scripts/build-thermo.mjs CRC.tsv identifiers.tsv [inorganic.tsv]');
const crcText = readFileSync(resolve(crcPath), 'utf8');
const crcLines = crcText.slice(crcText.indexOf('CAS\tChemical')).split(/\r?\n/);
const headers = crcLines[0].split('\t');
const identifiers = new Map(Object.entries({ '74-82-8': 'CH4', '74-98-6': 'C3H8', '7782-42-5': 'C' }));
const preferredFormulas = new Map(Object.entries({
  '3811-04-9': 'KClO3', '7447-40-7': 'KCl', '7664-38-2': 'H3PO4', '7681-11-0': 'KI', '7803-51-2': 'PH3', '7647-01-0': 'HCl',
  '7782-42-5': 'C', '7782-44-7': 'O2', '1333-74-0': 'H2', '7732-18-5': 'H2O'
}));
for (const identifierPath of identifierPaths) {
  for (const line of readFileSync(resolve(identifierPath), 'utf8').split(/\r?\n/)) {
    const columns = line.split('\t');
    if (/^\d+-\d+-\d+$/.test(columns[1] || '') && columns[2]) identifiers.set(columns[1], columns[2]);
  }
}
const substances = JSON.parse(readFileSync(new URL('../data/substances.json', import.meta.url), 'utf8'));
const russianByFormula = new Map(substances.items.map((item) => [item.formula, item.name_ru]));
const classByFormula = new Map(substances.items.map((item) => [item.formula, item.class]));
const records = [];
const numeric = (value) => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
for (const line of crcLines.slice(1)) {
  if (!line.trim()) continue;
  const columns = line.split('\t');
  const row = Object.fromEntries(headers.map((header, index) => [header, columns[index] || '']));
  const formula = preferredFormulas.get(row.CAS) || identifiers.get(row.CAS);
  if (!formula) continue;
  for (const [phase, suffix] of [['s', 's'], ['l', 'l'], ['g', 'g']]) {
    const Hf = numeric(row[`Hf${suffix}`]);
    let Gf = numeric(row[`Gf${suffix}`]);
    const S = numeric(row[`S0${suffix}`]);
    const Cp = numeric(row[`Cp${suffix}`]);
    if (Hf === 0 && Gf === null && S !== null) Gf = 0;
    if (Hf === null || Gf === null || S === null) continue;
    records.push({
      id: `${row.CAS}-${phase}`,
      cas: row.CAS,
      formula,
      name_ru: russianByFormula.get(formula) || row.Chemical,
      name_en: row.Chemical,
      phase,
      class: classByFormula.get(formula) || (formula.includes('C') ? 'organic' : 'inorganic'),
      Hf_kJ_mol: Hf / 1000,
      Gf_kJ_mol: Gf / 1000,
      S_J_mol_K: S,
      Cp_J_mol_K: Cp,
      uncertainty: null,
      source: 'CRC Handbook of Chemistry and Physics, 2014; данные переданы проектом chemicals (MIT)'
    });
  }
}
const output = {
  conditions: '298.15 K, 1 бар; стандартные состояния указаны для каждой строки',
  source: 'CRC Handbook of Chemistry and Physics, 2014. Извлечение: CalebBell/chemicals, MIT License.',
  license: 'MIT License, Caleb Bell and contributors; см. README.',
  count: records.length,
  records
};
writeFileSync(new URL('../data/thermo.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${records.length} thermodynamic records`);
for (const formula of ['H2O', 'CO2', 'CH4', 'C', 'O2', 'H2']) {
  console.log(formula, records.filter((record) => record.formula === formula).map((record) => [record.phase, record.Hf_kJ_mol, record.S_J_mol_K]));
}
