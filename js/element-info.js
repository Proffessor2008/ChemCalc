import elementData from '../data/elements.json' with { type: 'json' };
import descriptions from '../data/element-descriptions.json' with { type: 'json' };

function isMissing(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export const PERIODIC_ELEMENTS = elementData.elements.map((element) => {
  const extra = descriptions[element.symbol] || {};
  const merged = { ...element };
  for (const [key, value] of Object.entries(extra)) {
    if (!isMissing(value) && isMissing(merged[key])) merged[key] = value;
  }
  return merged;
});

export function elementDescription(symbol) {
  return descriptions[symbol] || null;
}
