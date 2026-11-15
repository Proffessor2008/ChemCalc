import { readFileSync, writeFileSync } from 'node:fs';

const mapping = JSON.parse(readFileSync('scripts/thermo-name-ru.json', 'utf8'));
const file = 'data/thermo.json';
const source = readFileSync(file, 'utf8');
const latinOnly = (value) => /[A-Za-z]/.test(value) && !/[А-Яа-яЁё]/.test(value);
const missing = new Set();
let replaced = 0;

const localized = source.split('\n').map((line) => {
  const match = line.match(/^(\s*"name_ru":\s*)"(.*)"(,?)$/);
  if (!match) return line;
  const name = match[2];
  if (!latinOnly(name)) return line;
  const russian = mapping[name];
  if (!russian) {
    missing.add(name);
    return line;
  }
  replaced += 1;
  return `${match[1]}"${russian.replace(/"/g, '\\"')}"${match[3]}`;
}).join('\n');

writeFileSync(file, localized);
const data = JSON.parse(readFileSync(file, 'utf8'));
const remaining = data.records.filter((record) => latinOnly(record.name_ru)).map((record) => record.name_ru);
console.log(JSON.stringify({ replaced, missing: [...missing], remaining: [...new Set(remaining)] }, null, 2));
if (missing.size || remaining.length) process.exitCode = 1;
