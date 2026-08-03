export const TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments', 'cash_events', 'queue'];
export const ID_FIELD = {
  items: 'item_id',
  sales: 'txn_id',
  trades: 'trade_id',
  purchases: 'purchase_id',
  print_products: 'print_product_id',
  print_parts: 'part_id',
  filaments: 'filament_id',
  cash_events: 'cash_id',
  queue: 'op_id',
};

const DEFAULT_SETTINGS = { machine_hourly_rate_cents: 0, events: [], backend_url: '', backend_token: '', counters: {} };

export function createMemStore(seed = {}) {
  const data = {};
  for (const t of TABS) data[t] = new Map((seed[t] || []).map((r) => [r[ID_FIELD[t]], r]));
  let settings = { ...DEFAULT_SETTINGS, ...(seed.settings || {}) };

  return {
    async getAll(tab) { return [...data[tab].values()]; },
    async put(tab, row) { data[tab].set(row[ID_FIELD[tab]], row); return row; },
    async bulkPut(tab, rows) { for (const r of rows) data[tab].set(r[ID_FIELD[tab]], r); },
    async remove(tab, id) { data[tab].delete(id); },
    async getSettings() { return { ...settings }; },
    async setSettings(patch) { settings = { ...settings, ...patch }; return { ...settings }; },
  };
}
