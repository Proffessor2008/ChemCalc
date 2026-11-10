import { readFileSync, writeFileSync } from 'node:fs';
const elements = JSON.parse(readFileSync(new URL('../data/elements.json', import.meta.url), 'utf8'));
const records = elements.elements.map((element) => ({
  symbol: element.symbol,
  number: element.number,
  name_ru: element.name_ru,
  pauling: element.electronegativity,
  allred_rochow: null,
  mulliken: null,
  source: 'Pauling scale; Periodic-Table-JSON / Wikipedia, ссылка в карточке элемента'
}));
writeFileSync(new URL('../data/electronegativity.json', import.meta.url), `${JSON.stringify({ scale: 'Полинг, безразмерная величина', source: 'Periodic-Table-JSON, значения по шкале Полинга', records }, null, 2)}\n`);
console.log(`Generated ${records.length} electronegativity records`);
