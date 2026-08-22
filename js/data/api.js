// Talks to a Supabase project's auto-generated REST API (PostgREST) with plain
// fetch — no SDK, keeping the app dependency-free. `url` is the project URL
// (https://<ref>.supabase.co) and `key` is the anon/publishable API key.
const DATA_TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments', 'cash_events', 'expenses'];
const ID_FIELD = { items: 'item_id', sales: 'txn_id', trades: 'trade_id', purchases: 'purchase_id', print_products: 'print_product_id', print_parts: 'part_id', filaments: 'filament_id', cash_events: 'cash_id', expenses: 'expense_id' };

export function createApi({ url, key, getToken, getAccountId, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const base = url ? `${url.replace(/\/+$/, '')}/rest/v1` : '';
  // apikey is the public anon key; Authorization carries the signed-in user's
  // token when available (falls back to the anon key when auth is unused).
  async function authHeaders() {
    const token = getToken ? await getToken() : null;
    return { apikey: key || '', Authorization: `Bearer ${token || key || ''}`, 'Content-Type': 'application/json' };
  }

  function ensure() { if (!url || !key) throw new Error('backend not configured'); }

  // Build a rich error from a failed response: keep the status AND PostgREST's
  // own message/hint (it explains exactly what was rejected — a missing column,
  // an RLS denial, an expired token) so the UI can show WHY, not just "error".
  async function fail(res, where) {
    let body = '';
    try { body = (await res.text()) || ''; } catch { /* body may be unreadable */ }
    let detail = body;
    try { const j = JSON.parse(body); detail = [j.message, j.hint].filter(Boolean).join(' — ') || body; } catch { /* not json */ }
    const err = new Error(`backend error: ${res.status}${where ? ` (${where})` : ''}${detail ? ` · ${detail}` : ''}`);
    err.status = res.status; err.detail = detail; err.where = where || '';
    return err;
  }

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
      headers: { ...(await authHeaders()), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(normalize(rows)),
    });
    if (!res.ok) throw await fail(res, `save ${tab}`);
  }

  // Delete EVERY row of a table the caller can see (RLS scopes this to their own
  // account, so it never touches another tenant's data). The filter matches all
  // rows since a primary key is never null. Used by the full-reset flow.
  async function clearTable(tab) {
    ensure();
    const field = ID_FIELD[tab];
    const res = await doFetch(`${base}/${tab}?${field}=not.is.null`, {
      method: 'DELETE',
      headers: { ...(await authHeaders()), Prefer: 'return=minimal' },
    });
    if (!res.ok) throw await fail(res, `clear ${tab}`);
  }

  // Delete a single row by its primary key (e.g. voiding a sale).
  async function del(tab, id) {
    const field = ID_FIELD[tab];
    const res = await doFetch(`${base}/${tab}?${field}=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...(await authHeaders()), Prefer: 'return=minimal' },
    });
    if (!res.ok) throw await fail(res, `delete ${tab}`);
  }

  return {
    // Pull every data table; returns { items:[...], sales:[...], ... } like the old backend.
    // Tables are fetched concurrently so boot is one round-trip's latency, not seven.
    async pull() {
      ensure();
      const h = await authHeaders();
      const out = {};
      await Promise.all(DATA_TABS.map(async (tab) => {
        const res = await doFetch(`${base}/${tab}?select=*`, { headers: h });
        if (!res.ok) throw await fail(res, `load ${tab}`);
        out[tab] = await res.json();
      }));
      return out;
    },

    // Apply queued write ops: upsert 'put' rows, DELETE 'delete' rows.
    async push(ops) {
      ensure();
      // Dedupe puts by primary key per table (last write wins) so one upsert
      // batch never targets the same row twice (Postgres ON CONFLICT rejects that).
      const acct = getAccountId ? getAccountId() : null;
      const byTab = {};
      const deletes = [];
      for (const op of ops) {
        if (!DATA_TABS.includes(op.tab)) continue;
        if (op.kind === 'delete') deletes.push(op);
        else if (op.kind === 'put') {
          // Always stamp the SIGNED-IN account on every outgoing write. A device is
          // only ever in one tenant, so its data belongs to that tenant — forcing it
          // here means a row left tagged to another account (e.g. from an account
          // switch) can never get permanently stuck failing row-level security (403).
          const row = acct ? { ...op.row, account_id: acct } : op.row;
          (byTab[op.tab] ||= new Map()).set(row[ID_FIELD[op.tab]], row);
        }
      }
      for (const tab of Object.keys(byTab)) await upsert(tab, [...byTab[tab].values()]);
      for (const op of deletes) await del(op.tab, op.id);
      return { applied: ops.length };
    },

    // Wipe every data table for the signed-in account (used by the full reset).
    async clearAll() {
      ensure();
      for (const tab of DATA_TABS) await clearTable(tab);
    },

    // Shared id counters live in a single app_meta row so devices don't collide.
    async getCounters() {
      ensure();
      const res = await doFetch(`${base}/app_meta?id=eq.app&select=counters`, { headers: await authHeaders() });
      if (!res.ok) throw await fail(res, 'id counters');
      const rows = await res.json();
      return rows[0] ? (rows[0].counters || {}) : {};
    },
    async setCounters(counters) {
      if (!url || !key) return;
      await upsert('app_meta', [{ id: 'app', counters: counters || {} }]);
    },

    // Which account does the signed-in user belong to? Row-level security scopes
    // account_members to the caller, so this returns their own membership only.
    // null = definitively no account yet (safe to provision); a throw = network/
    // auth problem (do NOT provision — keep the cached account).
    async getMyAccount() {
      ensure();
      const res = await doFetch(`${base}/account_members?select=account_id&limit=1`, { headers: await authHeaders() });
      if (!res.ok) throw await fail(res, 'membership');
      const rows = await res.json();
      return rows[0] ? rows[0].account_id : null;
    },

    // Create a fresh account for the signed-in user (server-side SECURITY DEFINER
    // function derives the email from the token and adds them as owner). Returns
    // the new account_id. Idempotent: returns the existing account if they have one.
    async provisionAccount(name) {
      ensure();
      const res = await doFetch(`${base}/rpc/provision_my_account`, {
        method: 'POST',
        headers: { ...(await authHeaders()), Prefer: 'return=representation' },
        body: JSON.stringify({ account_name: name || null }),
      });
      if (!res.ok) throw await fail(res, 'create account');
      return res.json(); // scalar text account_id, e.g. "ACC-0002"
    },
  };
}
