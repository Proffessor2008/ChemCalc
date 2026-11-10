import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../data/elements.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const SHANNON_URL = 'https://winter.group.shef.ac.uk/webelements/periodicity/ionic_radius/';
const MAGNESIUM_URL = 'https://www.rsc.org/periodic-table/element/12/magnesium';

const ionicRadii = {
  Li: [76, 'Li⁺', 6], Be: [45, 'Be²⁺', 6], B: [27, 'B³⁺', 4], C: [16, 'C⁴⁺', 4], N: [146, 'N³⁻', 4], O: [140, 'O²⁻', 6], F: [133, 'F⁻', 6],
  Na: [102, 'Na⁺', 6], Mg: [72, 'Mg²⁺', 6], Al: [53.5, 'Al³⁺', 6], Si: [40, 'Si⁴⁺', 4], P: [212, 'P³⁻', 4], S: [184, 'S²⁻', 6], Cl: [181, 'Cl⁻', 6],
  K: [138, 'K⁺', 6], Ca: [100, 'Ca²⁺', 6], Sc: [75, 'Sc³⁺', 6], Ti: [60.5, 'Ti⁴⁺', 6], V: [54, 'V⁵⁺', 6], Cr: [61.5, 'Cr³⁺', 6], Mn: [83, 'Mn²⁺, high spin', 6],
  Fe: [78, 'Fe²⁺, high spin', 6], Co: [74.5, 'Co²⁺, high spin', 6], Ni: [69, 'Ni²⁺', 6], Cu: [73, 'Cu²⁺', 6], Zn: [74, 'Zn²⁺', 6],
  Ga: [62, 'Ga³⁺', 6], Ge: [53, 'Ge⁴⁺', 6], As: [58, 'As³⁺', 6], Se: [198, 'Se²⁻', 6], Br: [196, 'Br⁻', 6]
};

let ionicUpdated = 0;
let discoveryUpdated = 0;
for (const element of data.elements) {
  const entry = ionicRadii[element.symbol];
  if (entry && element.ionic_radius == null) {
    const [radius, ion, coordination] = entry;
    element.ionic_radius = radius;
    element.ionic_radius_note = `${ion}, CN=${coordination}`;
    element.ionic_radius_source = SHANNON_URL;
    element.sources.push({ label: `Shannon, эффективный ионный радиус ${ion}, CN=${coordination}`, url: SHANNON_URL });
    ionicUpdated += 1;
  }
  if (element.symbol === 'Mg') {
    if (element.discovery_year == null) {
      element.discovery_year = 1755;
      discoveryUpdated += 1;
    }
    element.discovery_context = 'Joseph Black предложил выделить магний как элемент в 1755 году; металл выделен позднее.';
    element.discovery_source = MAGNESIUM_URL;
    if (!element.sources.some((source) => source.url === MAGNESIUM_URL)) {
      element.sources.push({ label: 'RSC — Magnesium, история открытия', url: MAGNESIUM_URL });
    }
  }
}

const sources = Array.isArray(data.sources) ? data.sources : [];
for (const source of [
  { label: 'Shannon effective ionic radii, coordination and spin specified', url: SHANNON_URL },
  { label: 'RSC — Magnesium, history and Joseph Black (1755)', url: MAGNESIUM_URL }
]) {
  if (!sources.some((item) => item.url === source.url)) sources.push(source);
}
data.sources = sources;
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log({ ionicUpdated, discoveryUpdated });
