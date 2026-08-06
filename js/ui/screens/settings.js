import { dollarsToCents, centsInputValue, formatCents } from '../format.js';
import { toCsv } from '../../core/csv.js';

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

export async function render(root, ctx) {
  const s = ctx.settings;
  const filaments = await ctx.store.getAll('filaments');

  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const acct = ctx.auth && ctx.auth.email ? ctx.auth.email() : '';
  root.innerHTML = `
    <h1>Setup</h1>
    ${acct ? `<div class="card acct-card"><span class="muted">Signed in as <strong style="color:var(--ink)">${esc(acct)}</strong></span>
      <button class="btn ghost" id="signout" style="width:auto;margin:0">Sign out</button></div>` : ''}
    <div class="card">
      <h1 style="font-size:16px">Sources</h1>
      ${s.current_show
        ? `<p class="muted">Active source: <strong style="color:var(--gold-deep)">${esc(s.current_show)}</strong> — auto-fills Buy / Sell / Trade.</p>`
        : '<p class="muted">No active source yet. Set one on Buy, Sell, or Trade, or add it below.</p>'}
      <label>Your sources (comma-separated)</label>
      <input id="events" value="${esc((s.events || []).join(', '))}" placeholder="Card show, Facebook Marketplace, eBay" />
      <p class="muted" style="margin-top:6px">Sources you type on Buy / Sell / Trade are saved here. Set each one's type (show, online…) in the Sources tab.</p>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Rates &amp; backend</h1>
      <label>Default buy rate (% of market value you pay)</label>
      <input id="buypct" inputmode="numeric" value="${s.buy_percent ?? 80}" />
      <label>Machine hourly rate (electricity + wear), $/hr</label>
      <input id="rate" inputmode="decimal" value="${centsInputValue(s.machine_hourly_rate_cents || 0)}" />
      <label>Supabase project URL</label>
      <input id="url" value="${esc(s.supabase_url || '')}" placeholder="https://xxxx.supabase.co" autocomplete="off" />
      <label>Supabase anon key</label>
      <input id="token" value="${esc(s.supabase_key || '')}" placeholder="eyJhbGciOi…" autocomplete="off" />
      <p class="muted" style="margin-top:6px">Connects this device to your shared database. Same URL + key on every device.</p>
      <button class="btn" id="save">Save &amp; connect</button>
      <button class="btn secondary" id="pull">Pull now</button>
      <button class="btn ghost" id="repair">🔧 Repair sync</button>
      <p class="muted" style="margin-top:4px">Different totals on another device? Tap this to re-upload anything stuck on this device to the shared database.</p>
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

    <div class="card">
      <h1 style="font-size:16px">Filaments</h1>
      <div id="fil-list">${filaments.map((f) => `
        <div class="list-item"><span>${f.name} <span class="chip">${f.color || ''}</span></span>
        <span class="muted">${formatCents(f.cost_per_kg_cents)}/kg</span></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
      <label>Add filament — name</label><input id="f-name" placeholder="Bambu PLA Black" />
      <div class="row">
        <div><label>Color</label><input id="f-color" placeholder="black" /></div>
        <div><label>$/kg</label><input id="f-rate" inputmode="decimal" placeholder="25.00" /></div>
      </div>
      <button class="btn secondary" id="add-fil">Add filament</button>
    </div>
  `;

  root.querySelector('#save').onclick = async () => {
    await ctx.store.setSettings({
      supabase_url: root.querySelector('#url').value.trim(),
      supabase_key: root.querySelector('#token').value.trim(),
      machine_hourly_rate_cents: dollarsToCents(root.querySelector('#rate').value),
      buy_percent: Math.max(1, Math.min(100, parseInt(root.querySelector('#buypct').value, 10) || 80)),
      events: root.querySelector('#events').value.split(',').map((x) => x.trim()).filter(Boolean),
    });
    ctx.toast('Saved — reloading');
    setTimeout(() => location.reload(), 600);
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

  root.querySelector('#pull').onclick = async () => {
    try { await ctx.sync.pull(); ctx.toast('Pulled from Sheet'); ctx.refresh(); }
    catch { ctx.toast('Could not reach backend'); }
  };

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
      const TABS = ['items', 'sales', 'trades', 'purchases', 'print_products', 'print_parts', 'filaments', 'cash_events', 'expenses'];
      let n = 0;
      for (const tab of TABS) {
        let rows; try { rows = await ctx.store.getAll(tab); } catch { continue; }
        for (const r of rows) {
          if (r && !r.account_id) {
            const fixed = { ...r, account_id: acct };
            await ctx.store.put(tab, fixed);
            await ctx.sync.enqueue({ kind: 'put', tab, row: fixed });
            n += 1;
          }
        }
      }
      await ctx.sync.flush();
      await ctx.sync.pull();
      ctx.toast(n ? `Re-uploaded ${n} stuck record(s)` : 'Nothing stuck — all synced');
      ctx.refresh();
    } catch {
      ctx.toast('Could not reach the database — try again on wifi');
      btn.disabled = false; btn.textContent = '🔧 Repair sync';
    }
  };

  root.querySelector('#add-fil').onclick = async () => {
    const name = root.querySelector('#f-name').value.trim();
    if (!name) { ctx.toast('Name required'); return; }
    const ids = await ctx.sync.makeIds();
    const row = {
      filament_id: ids.filament(),
      name,
      color: root.querySelector('#f-color').value.trim(),
      cost_per_kg_cents: dollarsToCents(root.querySelector('#f-rate').value),
    };
    await save(ctx, 'filaments', row);
    await ctx.sync.commitIds();
    await ctx.syncNow();
    ctx.refresh();
  };
}
