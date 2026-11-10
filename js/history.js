const HISTORY_KEY = 'chemcalc-history-v2';
const MAX_ITEMS = 20;

function makeId(now) {
  return globalThis.crypto?.randomUUID?.() || `${now().getTime()}-${Math.random().toString(16).slice(2)}`;
}

export function createHistoryStore(storage, now = () => new Date()) {
  const memory = new Map();
  const safeStorage = storage || {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value)
  };
  let items = [];
  try {
    const saved = JSON.parse(safeStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(saved)) {
      items = saved.filter((item) => item && typeof item.id === 'string' && typeof item.equation === 'string')
        .slice(0, MAX_ITEMS)
        .map((item) => ({
          id: item.id,
          equation: item.equation,
          mode: item.mode === 'auto' ? 'auto' : 'check',
          conditions: item.conditions && typeof item.conditions === 'object' ? item.conditions : {},
          favorite: Boolean(item.favorite),
          createdAt: item.createdAt || now().toISOString()
        }));
    }
  } catch {
    items = [];
  }

  function save() {
    safeStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  }

  return {
    list() {
      return items.map((item) => ({ ...item, conditions: { ...item.conditions } }));
    },
    add(entry) {
      if (!entry || typeof entry.equation !== 'string' || !entry.equation.trim()) throw new RangeError('Нельзя сохранить пустое уравнение');
      const mode = entry.mode === 'auto' ? 'auto' : 'check';
      const signature = JSON.stringify([entry.equation, mode, entry.conditions || {}]);
      const existing = items.find((item) => JSON.stringify([item.equation, item.mode, item.conditions || {}]) === signature);
      if (existing) {
        items = items.filter((item) => item !== existing);
        items.unshift({ ...existing, createdAt: now().toISOString() });
      } else {
        items.unshift({
          id: makeId(now),
          equation: entry.equation,
          mode,
          conditions: { ...(entry.conditions || {}) },
          favorite: Boolean(entry.favorite),
          createdAt: now().toISOString()
        });
      }
      items = items.slice(0, MAX_ITEMS);
      save();
      return items[0];
    },
    toggleFavorite(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      item.favorite = !item.favorite;
      save();
      return { ...item };
    },
    remove(id) {
      const previousLength = items.length;
      items = items.filter((item) => item.id !== id);
      save();
      return items.length !== previousLength;
    },
    clear() {
      items = [];
      save();
    }
  };
}

export function filterHistoryEntries(items, filter = 'all') {
  if (filter === 'favorites') return items.filter((item) => item.favorite);
  if (filter === 'auto' || filter === 'check') return items.filter((item) => item.mode === filter);
  return items;
}

export const HISTORY_LIMIT = MAX_ITEMS;
