import { toCsv } from '../../core/csv.js';
import { APP_VERSION } from '../../config.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

// Trigger a client-side file download (no server, works offline).
function download(filename, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Human-friendly inventory CSV: dollars (not cents), spreadsheet-ready columns.
function inventoryCsv(items) {
  const rows = items.map((i) => ({
    item_id: i.item_id, category: i.category, name: i.name, set: i.set, card_number: i.card_number,
    condition: i.condition, grade: i.grade, grader: i.grader, cert_number: i.cert_number, language: i.language,
    quantity: i.quantity_on_hand,
    unit_cost: ((i.unit_cost_cents || 0) / 100).toFixed(2),
    market_value: ((i.market_value_cents || 0) / 100).toFixed(2),
    acquisition: i.acquisition, acquired_date: i.acquired_date, status: i.status, notes: i.notes,
  }));
  return toCsv(rows);
}

const BACKUP_TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments'];

// Repair ordering + schema so smart-repair can re-issue ids safely. Referenced
// tables (purchases, trades) come before the ones that point at them (items,
// sales), so a new id is known before a referencing row is pushed.
const REPAIR_TABS = ['purchases', 'trades', 'items', 'sales', 'cash_events', 'expenses', 'print_products', 'print_parts', 'filaments'];
const PK_FIELD = { items: 'item_id', sales: 'txn_id', trades: 'trade_id', purchases: 'purchase_id', cash_events: 'cash_id', expenses: 'expense_id', print_products: 'print_product_id', print_parts: 'part_id', filaments: 'filament_id' };
const KIND_FOR = { items: 'item', sales: 'sale', trades: 'trade', purchases: 'purchase', cash_events: 'cash', expenses: 'expense', print_products: 'printProduct', print_parts: 'part', filaments: 'filament' };
// Fields that reference another table's primary key — followed when an id changes.
const REPAIR_REFS = { items: [['source_trade_id', 'trades'], ['source_purchase_id', 'purchases']], sales: [['item_id', 'items'], ['trade_id', 'trades']] };

// When a plain re-upload hits a 403, a local row's id already belongs to ANOTHER
// account in the shared table (leftover from an old account switch). Push each
// row on its own; for any that collide, mint a fresh id and remap references so
// nothing is orphaned. Returns how many were pushed / re-issued.
async function smartRepair(ctx, acct) {
  // The failed bulk flush left its put-ops in the queue; drop them and re-push
  // straight from the local store, one row at a time, so we can fix exact rows.
  try { await ctx.store.clear('queue'); } catch { /* no queue store */ }
  const ids = await ctx.sync.makeIds();
  const remap = {}; // { table: { oldId: newId } }
  const applyRefs = (tab, row) => {
    let out = row;
    for (const [field, rtab] of (REPAIR_REFS[tab] || [])) {
      const m = remap[rtab]; const v = out[field];
      if (m && v && m[v]) out = { ...out, [field]: m[v] };
    }
    return out;
  };
  let pushed = 0; let reminted = 0;
  for (const tab of REPAIR_TABS) {
    let rows; try { rows = await ctx.store.getAll(tab); } catch { continue; }
    for (const orig of rows) {
      if (!orig) continue;
      const row = applyRefs(tab, { ...orig, account_id: acct });
      try {
        await ctx.api.push([{ kind: 'put', tab, row }]);
        if (row !== orig) await ctx.store.put(tab, row); // persist any ref update
        pushed += 1;
      } catch (err) {
        if (!(err && err.status === 403)) throw err; // a real failure — bubble up
        // Id collides with another account's row → give it a brand-new one.
        const pk = PK_FIELD[tab];
        const oldId = row[pk];
        const newId = ids[KIND_FOR[tab]]();
        (remap[tab] ||= {})[oldId] = newId;
        const newRow = { ...row, [pk]: newId };
        await ctx.api.push([{ kind: 'put', tab, row: newRow }]);
        try { await ctx.store.remove(tab, oldId); } catch { /* ignore */ }
        await ctx.store.put(tab, newRow);
        pushed += 1; reminted += 1;
      }
    }
  }
  await ctx.sync.commitIds();
  await ctx.sync.flush(); // queue is empty → just publishes the advanced id counters
  await ctx.sync.pull();
  return { pushed, reminted };
}

export async function render(root, ctx) {
  const s = ctx.settings;

  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const acct = ctx.auth && ctx.auth.email ? ctx.auth.email() : '';
  root.innerHTML = `
    <h1>Settings</h1>
    ${acct ? `<div class="card acct-card"><span class="muted">Signed in as <strong style="color:var(--ink)">${esc(acct)}</strong></span>
      <button class="btn ghost" id="signout" style="width:auto;margin:0">Sign out</button></div>` : ''}
    <div class="card">
      <h1 style="font-size:16px">Buying</h1>
      <label>Default buy rate — the % of market value you pay</label>
      <input id="buypct" inputmode="numeric" value="${s.buy_percent ?? 80}" />
      <p class="muted" style="margin-top:6px">Pre-fills your offer on every Buy and Trade. You can still change it on any deal.</p>
      <button class="btn" id="save">Save</button>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Devices &amp; sync</h1>
      <p class="muted" style="margin-bottom:8px">Your data syncs across every device automatically. Seeing different totals on another device? Repair re-uploads anything stuck on this one.</p>
      <button class="btn ghost" id="repair">🔧 Repair sync</button>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Export &amp; backup</h1>
      <p class="muted" style="margin-bottom:8px">Download a copy of your data. Keep a backup so nothing's ever stuck on one device.</p>
      <button class="btn secondary" id="exp-inv">⤓ Inventory (CSV)</button>
      <button class="btn secondary" id="exp-sales">⤓ Sales &amp; trades (CSV)</button>
      <button class="btn ghost" id="exp-all">⤓ Full backup (everything, JSON)</button>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Import</h1>
      <p class="muted" style="margin-bottom:8px">Refresh market values from a Collectr export. Previews every change before anything is saved.</p>
      <a class="btn secondary" href="#/import" style="text-decoration:none">⤒ Import from Collectr</a>
    </div>

    <div class="card" style="border-color:var(--neg)">
      <h1 style="font-size:16px;color:var(--neg)">Reset</h1>
      <p class="muted" style="margin-bottom:10px">Permanently delete <strong>all</strong> business data — inventory, sales, buys, trades, expenses, and cash. This clears the <strong>shared database</strong>, so it wipes it for your partner and every device. It can't be undone. Download a Full backup above first if you might want it.</p>
      <button class="btn ghost" id="reset-btn" style="border-color:var(--neg);color:var(--neg)">Reset — delete all data</button>
    </div>

    <p class="muted" style="text-align:center;margin:16px 0 4px">Treasure Crown · App version <strong>${esc(APP_VERSION)}</strong></p>
  `;

  root.querySelector('#save').onclick = async () => {
    await ctx.store.setSettings({
      buy_percent: Math.max(1, Math.min(100, parseInt(root.querySelector('#buypct').value, 10) || 80)),
    });
    await ctx.reloadSettings();
    ctx.toast('Saved');
  };

  const stamp = () => (s.current_date || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '') || 'export';
  root.querySelector('#exp-inv').onclick = async () => {
    const items = await ctx.store.getAll('items');
    download(`treasure-crown-inventory-${stamp()}.csv`, inventoryCsv(items), 'text/csv;charset=utf-8');
    ctx.toast(`Exported ${items.length} items`);
  };
  root.querySelector('#exp-sales').onclick = async () => {
    const [sales, trades] = await Promise.all([ctx.store.getAll('sales'), ctx.store.getAll('trades')]);
    const salesCsv = toCsv(sales.map((r) => ({ ...r, unit_price: ((r.unit_price_cents || 0) / 100).toFixed(2), revenue: ((r.revenue_cents || 0) / 100).toFixed(2), profit: ((r.profit_cents || 0) / 100).toFixed(2) })));
    download(`treasure-crown-sales-${stamp()}.csv`, salesCsv, 'text/csv;charset=utf-8');
    ctx.toast(`Exported ${sales.length} sales`);
  };
  root.querySelector('#exp-all').onclick = async () => {
    const dump = { exported_at: stamp(), counters: (await ctx.store.getSettings()).counters || {} };
    for (const tab of BACKUP_TABS) dump[tab] = await ctx.store.getAll(tab);
    download(`treasure-crown-backup-${stamp()}.json`, JSON.stringify(dump, null, 2), 'application/json');
    const total = BACKUP_TABS.reduce((n, t) => n + (dump[t] ? dump[t].length : 0), 0);
    ctx.toast(`Backed up ${total} records`);
  };

  const signout = root.querySelector('#signout');
  if (signout) signout.onclick = () => ctx.signOut();

  // Repair sync: re-tag any local record missing its account_id (which is why it
  // never uploaded), push it up, THEN pull — so stranded records finally land in
  // the shared DB and stop causing per-device disagreements. Push-before-pull so
  // the local-only rows are safely uploaded before anything is overwritten.
  root.querySelector('#repair').onclick = async () => {
    const btn = root.querySelector('#repair');
    const acct = ctx.settings.account_id;
    if (!acct) { ctx.toast('Not signed in to an account yet'); return; }
    btn.disabled = true; btn.textContent = 'Repairing…';
    try {
      // Re-upload EVERYTHING on this device (not only untagged rows) so any record
      // that never reached the shared DB — for whatever reason — is pushed up
      // BEFORE the pull, guaranteeing no local-only card is overwritten/lost.
      const TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments', 'cash_events', 'expenses'];
      let n = 0;
      for (const tab of TABS) {
        let rows; try { rows = await ctx.store.getAll(tab); } catch { continue; }
        for (const r of rows) {
          if (!r) continue;
          // Force every local row onto THIS account — not just untagged ones — so a
          // row stranded under a different account (from an old account switch) is
          // rescued instead of failing row-level security forever.
          const fixed = { ...r, account_id: acct };
          await ctx.store.put(tab, fixed);
          await ctx.sync.enqueue({ kind: 'put', tab, row: fixed });
          n += 1;
        }
      }
      await ctx.sync.flush(); // push all of it up first…
      await ctx.sync.pull();  // …then pull, so nothing local is lost
      ctx.toast(`Re-uploaded ${n} record(s) — all devices now match`);
      ctx.refresh();
    } catch (e) {
      // A 403 means a local row's id already belongs to another account in the
      // shared table. Recover by re-issuing fresh ids for just those rows.
      if (e && e.status === 403) {
        btn.textContent = 'Fixing IDs…';
        try {
          const { pushed, reminted } = await smartRepair(ctx, acct);
          ctx.toast(reminted ? `Fixed ${reminted} stuck record(s) · synced ${pushed}` : `Synced ${pushed} record(s)`);
          ctx.refresh();
          return;
        } catch {
          ctx.toast('Could not finish repair — try again on wifi');
          btn.disabled = false; btn.textContent = '🔧 Repair sync';
          return;
        }
      }
      ctx.toast('Could not reach the database — try again on wifi');
      btn.disabled = false; btn.textContent = '🔧 Repair sync';
    }
  };

  // Full reset behind a pop-up: clicking Reset opens a modal where you must type
  // "DELETE" — so the wipe can never fire from a single stray tap.
  root.querySelector('#reset-btn').onclick = () => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-card">
      <h2 style="color:var(--neg)">Delete everything?</h2>
      <p class="muted">This permanently deletes <strong>all</strong> inventory, sales, buys, trades, expenses, and cash — for you, your partner, and every device. It can't be undone.</p>
      <label>Type <strong>DELETE</strong> to confirm</label>
      <input id="m-word" placeholder="DELETE" autocomplete="off" autocapitalize="characters" />
      <button class="btn" id="m-go" disabled style="background:var(--neg);color:#fff">Delete everything</button>
      <button class="btn ghost" id="m-cancel">Cancel</button>
    </div>`;
    document.body.appendChild(ov);
    const word = ov.querySelector('#m-word');
    const go = ov.querySelector('#m-go');
    const close = () => ov.remove();
    word.focus();
    word.oninput = () => { go.disabled = word.value.trim().toUpperCase() !== 'DELETE'; };
    word.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) go.click(); });
    ov.querySelector('#m-cancel').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); // tap outside to dismiss
    go.onclick = async () => {
      if (word.value.trim().toUpperCase() !== 'DELETE') return;
      go.disabled = true; go.textContent = 'Deleting…';
      try {
        await ctx.api.clearAll(); // wipe the shared DB (RLS-scoped to this account)
      } catch {
        ctx.toast('Could not reach the database — reset needs a connection');
        go.disabled = false; go.textContent = 'Delete everything';
        return;
      }
      // Clear local copies + the queue so nothing gets re-uploaded on the next boot.
      const TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments', 'cash_events', 'expenses', 'queue'];
      for (const t of TABS) { try { await ctx.store.clear(t); } catch { /* store may lack this table */ } }
      ctx.toast('All data deleted');
      setTimeout(() => location.reload(), 600);
    };
  };

}
