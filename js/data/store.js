import { TABS, ID_FIELD, createMemStore } from './memstore.js';

const DB_NAME = 'tcc';
const DB_VERSION = 1;
const DEFAULT_SETTINGS = { machine_hourly_rate_cents: 0, events: [], current_show: '', supabase_url: '', supabase_key: '', session: null, buy_percent: 80, counters: {} };

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const tab of TABS) {
        if (!db.objectStoreNames.contains(tab)) db.createObjectStore(tab, { keyPath: ID_FIELD[tab] });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, tab, mode) {
  return db.transaction(tab, mode).objectStore(tab);
}
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openStore() {
  if (typeof indexedDB === 'undefined') return createMemStore();
  const db = await openDb();
  return {
    async getAll(tab) { return wrap(tx(db, tab, 'readonly').getAll()); },
    async put(tab, row) { await wrap(tx(db, tab, 'readwrite').put(row)); return row; },
    async bulkPut(tab, rows) {
      const store = tx(db, tab, 'readwrite');
      await Promise.all(rows.map((r) => wrap(store.put(r))));
    },
    async remove(tab, id) { await wrap(tx(db, tab, 'readwrite').delete(id)); },
    async getSettings() {
      const s = await wrap(db.transaction('meta', 'readonly').objectStore('meta').get('settings'));
      return { ...DEFAULT_SETTINGS, ...(s || {}) };
    },
    async setSettings(patch) {
      const current = await this.getSettings();
      const merged = { ...current, ...patch };
      await wrap(db.transaction('meta', 'readwrite').objectStore('meta').put(merged, 'settings'));
      return merged;
    },
  };
}
