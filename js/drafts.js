const PREFIX = 'chemcalc-community-drafts-v1:';
const LIMIT = 20;

function identifier() {
  return globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDraftStore(storage, userId) {
  const key = `${PREFIX}${userId}`;
  function list() {
    try {
      const value = JSON.parse(storage.getItem(key) || '[]');
      return Array.isArray(value) ? value.filter((draft) => draft && typeof draft.id === 'string' && draft.data && typeof draft.updatedAt === 'string').slice(0, LIMIT) : [];
    } catch {
      return [];
    }
  }
  function write(drafts) {
    storage.setItem(key, JSON.stringify(drafts));
    return drafts;
  }
  return {
    userId,
    list,
    get(id) { return list().find((draft) => draft.id === id) || null; },
    save(data, id = identifier()) {
      const timestamp = new Date().toISOString();
      const drafts = list().filter((draft) => draft.id !== id);
      drafts.unshift({ id, data, updatedAt: timestamp });
      write(drafts.slice(0, LIMIT));
      return id;
    },
    remove(id) { write(list().filter((draft) => draft.id !== id)); }
  };
}
