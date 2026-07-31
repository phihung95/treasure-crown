// Talks to a Supabase project's auto-generated REST API (PostgREST) with plain
// fetch — no SDK, keeping the app dependency-free. `url` is the project URL
// (https://<ref>.supabase.co) and `key` is the anon/publishable API key.
const DATA_TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments'];
const ID_FIELD = { items: 'item_id', sales: 'txn_id', trades: 'trade_id', purchases: 'purchase_id', print_products: 'print_product_id', print_parts: 'part_id', filaments: 'filament_id' };

export function createApi({ url, key, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const base = url ? `${url.replace(/\/+$/, '')}/rest/v1` : '';
  const headers = { apikey: key || '', Authorization: `Bearer ${key || ''}`, 'Content-Type': 'application/json' };

  function ensure() { if (!url || !key) throw new Error('backend not configured'); }

  // PostgREST rejects a bulk insert unless every row has the identical set of
  // keys. Rows built by different flows (or older data) can differ, so widen
  // every row to the union of keys, filling any it lacks with null.
  function normalize(rows) {
    const keys = new Set();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const cols = [...keys];
    return rows.map((r) => { const o = {}; for (const k of cols) o[k] = k in r ? r[k] : null; return o; });
  }

  async function upsert(tab, rows) {
    if (rows.length === 0) return;
    const res = await doFetch(`${base}/${tab}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(normalize(rows)),
    });
    if (!res.ok) throw new Error(`backend error: ${res.status}`);
  }

  return {
    // Pull every data table; returns { items:[...], sales:[...], ... } like the old backend.
    async pull() {
      ensure();
      const out = {};
      for (const tab of DATA_TABS) {
        const res = await doFetch(`${base}/${tab}?select=*`, { headers });
        if (!res.ok) throw new Error(`backend error: ${res.status}`);
        out[tab] = await res.json();
      }
      return out;
    },

    // Apply queued write ops (kind 'put') by upserting rows into their table.
    async push(ops) {
      ensure();
      // Dedupe by primary key per table (last write wins) so one upsert batch
      // never targets the same row twice (Postgres ON CONFLICT rejects that).
      const byTab = {};
      for (const op of ops) {
        if (op.kind !== 'put' || !DATA_TABS.includes(op.tab)) continue;
        (byTab[op.tab] ||= new Map()).set(op.row[ID_FIELD[op.tab]], op.row);
      }
      for (const tab of Object.keys(byTab)) await upsert(tab, [...byTab[tab].values()]);
      return { applied: ops.length };
    },

    // Shared id counters live in a single app_meta row so devices don't collide.
    async getCounters() {
      ensure();
      const res = await doFetch(`${base}/app_meta?id=eq.app&select=counters`, { headers });
      if (!res.ok) throw new Error(`backend error: ${res.status}`);
      const rows = await res.json();
      return rows[0] ? (rows[0].counters || {}) : {};
    },
    async setCounters(counters) {
      if (!url || !key) return;
      await upsert('app_meta', [{ id: 'app', counters: counters || {} }]);
    },
  };
}
