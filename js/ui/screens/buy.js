import { allocatePurchase } from '../../core/allocation.js';
import { newItem, CATEGORIES, PAYMENT_METHODS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const events = ctx.settings.events || [];
  const lines = [];

  root.innerHTML = `
    <h1>Buy</h1>
    <div class="card">
      <label>Cost method</label>
      <select id="method">
        <option value="by_market">Lot total, split by market value</option>
        <option value="even">Lot total, split evenly</option>
        <option value="per_item">Type each card's price</option>
      </select>
      <div id="lot-wrap">
        <label>Lot total $ (what you paid for the stack)</label>
        <input id="lot" inputmode="decimal" value="0.00" />
      </div>
      <label>Payment</label>
      <select id="pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select>
      <label>Show / event</label>
      <input id="event" list="events" value="${events[0] || ''}" />
      <datalist id="events">${events.map((e) => `<option value="${e}">`).join('')}</datalist>
    </div>

    <div class="card">
      <h1 style="font-size:16px">Add a card to this buy</h1>
      <label>Name</label><input id="l-name" placeholder="Umbreon VMAX Alt Art" />
      <div class="row">
        <div><label>Category</label>
          <select id="l-cat">${CATEGORIES.map((c) => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select></div>
        <div><label>Qty</label><input id="l-qty" inputmode="numeric" value="1" /></div>
      </div>
      <div class="row">
        <div><label>Market value $ (each)</label><input id="l-mv" inputmode="decimal" value="0.00" /></div>
        <div id="l-price-wrap" hidden><label>Price $ (each)</label><input id="l-price" inputmode="decimal" value="0.00" /></div>
      </div>
      <button class="btn secondary" id="add-line">Add to buy</button>
    </div>

    <div id="lines"></div>
    <div class="total-bar"><span id="preview" class="muted">No cards yet</span>
      <button class="btn" style="width:auto;margin:0" id="save">Save buy</button></div>
  `;

  const methodEl = root.querySelector('#method');
  const togglePer = () => {
    const per = methodEl.value === 'per_item';
    root.querySelector('#lot-wrap').hidden = per;
    root.querySelector('#l-price-wrap').hidden = !per;
  };
  methodEl.onchange = () => { togglePer(); renderLines(); };
  togglePer();

  const renderLines = () => {
    root.querySelector('#lines').innerHTML = lines.map((l, i) => `
      <div class="list-item"><span>${l.name} <span class="chip">${catLabel(l.category)}</span>
        <div class="muted">x${l.quantity} · mkt ${formatCents(l.market_value_cents)}${l.entered_price_cents ? ` · price ${formatCents(l.entered_price_cents)}` : ''}</div></span>
        <button class="btn ghost" style="width:auto;margin:0" data-del="${i}">✕</button></div>`).join('');
    root.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { lines.splice(+b.getAttribute('data-del'), 1); renderLines(); }; });
    preview();
  };

  const preview = () => {
    if (lines.length === 0) { root.querySelector('#preview').textContent = 'No cards yet'; return; }
    const res = allocatePurchase({
      lot_total_cents: dollarsToCents(root.querySelector('#lot').value),
      method: methodEl.value, lines,
    });
    const total = res.lines.reduce((s, l) => s + l.line_total_cents, 0);
    root.querySelector('#preview').textContent =
      `${lines.length} card(s) · total cost ${formatCents(total)}${res.fallback ? ' (even split — missing values)' : ''}`;
  };
  root.querySelector('#lot').oninput = preview;

  root.querySelector('#add-line').onclick = () => {
    const name = root.querySelector('#l-name').value.trim();
    if (!name) { ctx.toast('Name required'); return; }
    lines.push({
      name,
      category: root.querySelector('#l-cat').value,
      quantity: parseInt(root.querySelector('#l-qty').value, 10) || 1,
      market_value_cents: dollarsToCents(root.querySelector('#l-mv').value),
      entered_price_cents: dollarsToCents(root.querySelector('#l-price').value),
    });
    root.querySelector('#l-name').value = '';
    root.querySelector('#l-mv').value = '0.00';
    root.querySelector('#l-price').value = '0.00';
    renderLines();
  };

  root.querySelector('#save').onclick = async () => {
    if (lines.length === 0) { ctx.toast('Add at least one card'); return; }
    const method = methodEl.value;
    const lot_total_cents = method === 'per_item'
      ? lines.reduce((s, l) => s + (l.entered_price_cents || 0), 0)
      : dollarsToCents(root.querySelector('#lot').value);
    const res = allocatePurchase({ lot_total_cents, method, lines });

    const ids = await ctx.sync.makeIds();
    const purchase_id = ids.purchase();
    const when = new Date().toISOString().slice(0, 10);
    const event = root.querySelector('#event').value.trim();

    for (const l of res.lines) {
      const item = newItem({
        category: l.category, name: l.name, quantity_on_hand: l.quantity,
        unit_cost_cents: l.unit_cost_cents, market_value_cents: l.market_value_cents || 0,
        acquisition: 'bought', source_purchase_id: purchase_id, acquired_date: when,
      }, ids.item());
      await save(ctx, 'items', item);
    }
    await save(ctx, 'purchases', {
      purchase_id, date: when, event, lot_total_cents,
      payment_method: root.querySelector('#pay').value,
      allocation_method: res.method_used, item_count: res.lines.length, notes: '',
    });
    await ctx.sync.commitIds();
    await ctx.syncNow();
    ctx.toast(`Bought ${res.lines.length} card(s)`);
    location.hash = '#/inventory';
  };
}
