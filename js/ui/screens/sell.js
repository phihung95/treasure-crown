import { bookSale } from '../../core/sales.js';
import { PAYMENT_METHODS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const items = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  const events = ctx.settings.events || [];
  let selected = null;

  root.innerHTML = `
    <h1>Sell</h1>
    <input id="q" placeholder="Find item to sell…" />
    <div id="results"></div>
    <div id="form" hidden>
      <div class="card" id="sel"></div>
      <div class="row">
        <div><label>Qty</label><input id="qty" inputmode="numeric" value="1" /></div>
        <div><label>Price $ (each)</label><input id="price" inputmode="decimal" value="0.00" /></div>
      </div>
      <label>Payment</label>
      <select id="pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select>
      <label>Show / event</label>
      <input id="event" list="events" value="${events[0] || ''}" />
      <datalist id="events">${events.map((e) => `<option value="${e}">`).join('')}</datalist>
      <button class="btn" id="do">Record sale</button>
    </div>
  `;

  const renderResults = () => {
    const q = root.querySelector('#q').value.toLowerCase();
    const shown = q ? items.filter((i) => `${i.name} ${i.set} ${i.cert_number}`.toLowerCase().includes(q)).slice(0, 25) : [];
    root.querySelector('#results').innerHTML = shown.map((i) => `
      <div class="list-item" data-pick="${i.item_id}">
        <span>${i.name} <span class="chip">${catLabel(i.category)}</span>
          <div class="muted">x${i.quantity_on_hand} · cost ${formatCents(i.unit_cost_cents)}</div></span>
        <span class="muted">${formatCents(i.market_value_cents)}</span>
      </div>`).join('');
    root.querySelectorAll('[data-pick]').forEach((el) => { el.onclick = () => pick(el.getAttribute('data-pick')); });
  };

  const pick = (id) => {
    selected = items.find((i) => i.item_id === id);
    root.querySelector('#form').hidden = false;
    root.querySelector('#sel').innerHTML = `<strong>${selected.name}</strong>
      <div class="muted">on hand x${selected.quantity_on_hand} · cost ${formatCents(selected.unit_cost_cents)}</div>`;
    root.querySelector('#price').value = (selected.market_value_cents / 100).toFixed(2);
  };

  root.querySelector('#q').oninput = renderResults;

  root.querySelector('#do').onclick = async () => {
    if (!selected) return;
    const qty = parseInt(root.querySelector('#qty').value, 10) || 0;
    const price = dollarsToCents(root.querySelector('#price').value);
    let result;
    try {
      const ids = await ctx.sync.makeIds();
      result = bookSale({
        item: selected, quantity: qty, unit_price_cents: price,
        payment_method: root.querySelector('#pay').value,
        date: new Date().toISOString().slice(0, 10),
        event: root.querySelector('#event').value.trim(), notes: '',
      }, ids.sale());
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    await save(ctx, 'items', result.updatedItem);
    await save(ctx, 'sales', result.saleRow);
    await ctx.syncNow();
    ctx.toast(`Sold — profit ${formatCents(result.saleRow.profit_cents)}`);
    ctx.refresh();
  };
}
