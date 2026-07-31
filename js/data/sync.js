import { ID_FIELD } from './memstore.js';

const PREFIX = { item: 'ITM', sale: 'TXN', trade: 'TRD', purchase: 'PUR', printProduct: 'PP', part: 'PART', filament: 'FIL' };
const DATA_TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments'];

export function createSync({ store, api }) {
  let counters = null;

  async function loadCounters() {
    const s = await store.getSettings();
    counters = { ...(s.counters || {}) };
  }

  function gen(kind) {
    const prefix = PREFIX[kind];
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}-${String(counters[prefix]).padStart(4, '0')}`;
  }

  return {
    async makeIds() {
      if (!counters) await loadCounters();
      return {
        item: () => gen('item'),
        sale: () => gen('sale'),
        trade: () => gen('trade'),
        purchase: () => gen('purchase'),
        printProduct: () => gen('printProduct'),
        part: () => gen('part'),
        filament: () => gen('filament'),
      };
    },
    async commitIds() {
      if (counters) await store.setSettings({ counters: { ...counters } });
    },
    async enqueue(op) {
      const op_id = `Q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await store.put('queue', { op_id, ...op });
    },
    async flush() {
      const ops = await store.getAll('queue');
      if (ops.length === 0) return { pushed: 0, remaining: 0 };
      await api.push(ops);
      for (const op of ops) await store.remove('queue', op.op_id);
      return { pushed: ops.length, remaining: 0 };
    },
    async pull() {
      const data = await api.pull();
      for (const tab of DATA_TABS) {
        if (Array.isArray(data[tab])) await store.bulkPut(tab, data[tab]);
      }
    },
  };
}
