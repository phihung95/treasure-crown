import { reconcileTrade, processTrade } from '../../core/trades.js';
import { CATEGORIES } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const stock = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  const giveLines = [];
  const getLines = [];

  root.innerHTML = `
    <h1>Trade</h1>
    <div class="split">
      <div class="card">
        <strong>You give</strong>
        <div id="give"></div>
        <label>Add from stock</label>
        <input id="g-q" placeholder="Search stock…" />
        <div id="g-res"></div>
      </div>
      <div class="card">
        <strong>You get</strong>
        <div id="get"></div>
        <label>Name</label><input id="t-name" placeholder="Card you take in" />
        <div class="row">
          <div><label>Category</label>
            <select id="t-cat">${CATEGORIES.map((c) => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select></div>
          <div><label>Value $</label><input id="t-val" inputmode="decimal" value="0.00" /></div>
        </div>
        <button class="btn secondary" id="add-get">Add received</button>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <div><label>Cash on top $</label><input id="cash" inputmode="decimal" value="0.00" /></div>
        <div><label>Direction</label>
          <select id="dir">
            <option value="customer_pays_me">Customer pays me</option>
            <option value="i_pay">I pay</option>
          </select></div>
      </div>
    </div>
    <div class="total-bar"><span id="recon" class="muted">Add items…</span>
      <button class="btn" style="width:auto;margin:0" id="save">Save trade</button></div>
  `;

  const recon = () => {
    const r = reconcileTrade({
      giveLines, getLines,
      cash_cents: dollarsToCents(root.querySelector('#cash').value),
      cash_direction: root.querySelector('#dir').value,
    });
    const bal = r.delta_cents === 0 ? 'even' : (r.delta_cents > 0 ? `+${formatCents(r.delta_cents)} to you` : `${formatCents(r.delta_cents)} to you`);
    root.querySelector('#recon').innerHTML =
      `give ${formatCents(r.give_total_cents)} · get ${formatCents(r.get_total_cents)} · <strong>${bal}</strong>`;
  };

  const renderGive = () => {
    root.querySelector('#give').innerHTML = giveLines.map((l, i) =>
      `<div class="list-item"><span>${l.item.name}<div class="muted">value ${formatCents(l.agreed_value_cents)}</div></span>
       <button class="btn ghost" style="width:auto;margin:0" data-dg="${i}">✕</button></div>`).join('');
    root.querySelectorAll('[data-dg]').forEach((b) => { b.onclick = () => { giveLines.splice(+b.getAttribute('data-dg'), 1); renderGive(); recon(); }; });
  };
  const renderGet = () => {
    root.querySelector('#get').innerHTML = getLines.map((l, i) =>
      `<div class="list-item"><span>${l.fields.name}<div class="muted">value ${formatCents(l.agreed_value_cents)}</div></span>
       <button class="btn ghost" style="width:auto;margin:0" data-dt="${i}">✕</button></div>`).join('');
    root.querySelectorAll('[data-dt]').forEach((b) => { b.onclick = () => { getLines.splice(+b.getAttribute('data-dt'), 1); renderGet(); recon(); }; });
  };

  root.querySelector('#g-q').oninput = () => {
    const q = root.querySelector('#g-q').value.toLowerCase();
    const shown = q ? stock.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 15) : [];
    root.querySelector('#g-res').innerHTML = shown.map((i) =>
      `<div class="list-item" data-pg="${i.item_id}"><span>${i.name}<div class="muted">cost ${formatCents(i.unit_cost_cents)} · mkt ${formatCents(i.market_value_cents)}</div></span></div>`).join('');
    root.querySelectorAll('[data-pg]').forEach((el) => {
      el.onclick = () => {
        const it = stock.find((x) => x.item_id === el.getAttribute('data-pg'));
        const v = prompt(`Agreed value for "${it.name}" ($):`, (it.market_value_cents / 100).toFixed(2));
        if (v === null) return;
        giveLines.push({ item: it, quantity: 1, agreed_value_cents: dollarsToCents(v) });
        root.querySelector('#g-q').value = ''; root.querySelector('#g-res').innerHTML = '';
        renderGive(); recon();
      };
    });
  };

  root.querySelector('#add-get').onclick = () => {
    const name = root.querySelector('#t-name').value.trim();
    if (!name) { ctx.toast('Name required'); return; }
    getLines.push({
      fields: { name, category: root.querySelector('#t-cat').value },
      quantity: 1,
      agreed_value_cents: dollarsToCents(root.querySelector('#t-val').value),
    });
    root.querySelector('#t-name').value = ''; root.querySelector('#t-val').value = '0.00';
    renderGet(); recon();
  };

  root.querySelector('#cash').oninput = recon;
  root.querySelector('#dir').onchange = recon;

  root.querySelector('#save').onclick = async () => {
    if (giveLines.length === 0 && getLines.length === 0) { ctx.toast('Nothing to trade'); return; }
    let res;
    try {
      const ids = await ctx.sync.makeIds();
      res = processTrade({
        giveLines, getLines,
        cash_cents: dollarsToCents(root.querySelector('#cash').value),
        cash_direction: root.querySelector('#dir').value,
        date: new Date().toISOString().slice(0, 10), event: (ctx.settings.events || [])[0] || '', notes: '',
      }, ids);
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    await save(ctx, 'trades', res.tradeRow);
    for (const sr of res.saleRows) await save(ctx, 'sales', sr);
    for (const u of res.updatedItems) await save(ctx, 'items', u);
    for (const n of res.newItems) await save(ctx, 'items', n);
    await ctx.syncNow();
    ctx.toast(`Trade saved — profit ${formatCents(res.tradeRow.trade_profit_cents)}`);
    ctx.refresh();
  };
}
