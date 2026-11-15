import { t } from './i18n.js';

export const SUBSTANCE_CLASSES = [
  'salt', 'acid', 'base', 'oxide', 'acidic_oxide', 'basic_oxide', 'amphoteric_oxide',
  'simple', 'metal', 'organic', 'binary', 'gas', 'complex', 'acidic_salt', 'basic_salt',
  'organic_salt', 'peroxide', 'hydride', 'carbide', 'nitride', 'phosphide', 'sulfide',
  'mineral', 'intermetallic', 'covalent_halide'
];

export function classLabel(value) {
  const key = `substanceClass_${value}`;
  const label = t(key);
  return label === key ? String(value) : label;
}
