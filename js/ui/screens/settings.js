import { dollarsToCents, centsInputValue, formatCents } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const s = ctx.settings;
  const filaments = await ctx.store.getAll('filaments');

  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  root.innerHTML = `
    <h1>Setup</h1>
    <div class="card">
      <h1 style="font-size:16px">Shows</h1>
      ${s.current_show
        ? `<p class="muted">Active show: <strong style="color:var(--gold-deep)">${esc(s.current_show)}</strong> — auto-fills Buy / Sell / Trade.</p>`
        : '<p class="muted">No active show yet. Set one on Buy, Sell, or Trade, or add it below.</p>'}
      <label>Your shows (comma-separated)</label>
      <input id="events" value="${esc((s.events || []).join(', '))}" placeholder="Bergen Show, Oslo Con" />
      <p class="muted" style="margin-top:6px">New shows you type on Buy / Sell / Trade are saved here automatically.</p>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Rates &amp; backend</h1>
      <label>Default buy rate (% of market value you pay)</label>
      <input id="buypct" inputmode="numeric" value="${s.buy_percent ?? 80}" />
      <label>Machine hourly rate (electricity + wear), $/hr</label>
      <input id="rate" inputmode="decimal" value="${centsInputValue(s.machine_hourly_rate_cents || 0)}" />
      <label>Backend web app URL</label>
      <input id="url" value="${esc(s.backend_url || '')}" placeholder="https://script.google.com/.../exec" />
      <label>Backend token</label>
      <input id="token" value="${esc(s.backend_token || '')}" />
      <button class="btn" id="save">Save settings</button>
      <button class="btn secondary" id="pull">Pull now</button>
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
      backend_url: root.querySelector('#url').value.trim(),
      backend_token: root.querySelector('#token').value.trim(),
      machine_hourly_rate_cents: dollarsToCents(root.querySelector('#rate').value),
      buy_percent: Math.max(1, Math.min(100, parseInt(root.querySelector('#buypct').value, 10) || 80)),
      events: root.querySelector('#events').value.split(',').map((x) => x.trim()).filter(Boolean),
    });
    ctx.toast('Saved — reloading');
    setTimeout(() => location.reload(), 600);
  };

  root.querySelector('#pull').onclick = async () => {
    try { await ctx.sync.pull(); ctx.toast('Pulled from Sheet'); ctx.refresh(); }
    catch { ctx.toast('Could not reach backend'); }
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
