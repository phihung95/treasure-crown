import { bookSale, voidSale } from '../../core/sales.js';
import { PAYMENT_METHODS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const items = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  const events = ctx.settings.events || [];
  const currentShow = ctx.settings.current_show || events[0] || '';
  let selected = null;

  // Most recent sales first (txn ids are monotonic), for quick undo.
  const recent = (await ctx.store.getAll('sales'))
    .filter((s) => s.type === 'sale')
    .sort((a, b) => String(b.txn_id).localeCompare(String(a.txn_id)))
    .slice(0, 12);

  root.innerHTML = `
    <h1>Sell</h1>
    <input id="q" placeholder="Find item to sell…" />
    <div id="results"></div>
    <div id="form" hidden>
      <div class="card" id="sel"></div>
      <label class="dice-toggle"><input type="checkbox" id="dice" />
        <span>🎲 Dice challenge</span>
        <span class="muted">— $5 a roll, tracked separately</span></label>
      <div class="row">
        <div><label>Qty</label><input id="qty" inputmode="numeric" value="1" /></div>
        <div><label>Price $ (each)</label><input id="price" inputmode="decimal" value="0.00" /></div>
      </div>
      <label>Payment</label>
      <select id="pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select>
      <label>Show / event</label>
      <input id="event" list="events" value="${currentShow}" placeholder="Type a show name…" />
      <datalist id="events">${events.map((e) => `<option value="${e}">`).join('')}</datalist>
      <button class="btn" id="do">Record sale</button>
    </div>
    ${recent.length ? `<div class="panel" id="recent">
      <div class="panel-h">Recent sales</div>
      ${recent.map((s) => `<div class="sale-row">
        <div class="sale-main">
          <div class="sale-name">${esc(s.item_name || s.item_id)}${s.channel === 'dice' ? ' <span class="chip">🎲 dice</span>' : ''}</div>
          <div class="muted">×${s.quantity} · ${formatCents(s.unit_price_cents)}${s.event ? ` · ${esc(s.event)}` : ''}</div>
        </div>
        <button class="btn ghost undo-btn" data-undo="${esc(s.txn_id)}">Undo</button>
      </div>`).join('')}
    </div>` : ''}
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

  const isDice = () => root.querySelector('#dice').checked;
  const setPrice = () => {
    // A dice roll is always $5; otherwise start from the item's market value.
    root.querySelector('#price').value = isDice() ? '5.00' : (selected ? (selected.market_value_cents / 100).toFixed(2) : '0.00');
  };

  const pick = (id) => {
    selected = items.find((i) => i.item_id === id);
    root.querySelector('#form').hidden = false;
    root.querySelector('#sel').innerHTML = `<strong>${selected.name}</strong>
      <div class="muted">on hand x${selected.quantity_on_hand} · cost ${formatCents(selected.unit_cost_cents)}</div>`;
    setPrice();
  };

  root.querySelector('#q').oninput = renderResults;
  root.querySelector('#dice').onchange = setPrice;

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
        channel: isDice() ? 'dice' : '',
      }, ids.sale());
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    await save(ctx, 'items', result.updatedItem);
    await save(ctx, 'sales', result.saleRow);
    await ctx.setCurrentShow(result.saleRow.event);
    await ctx.syncNow();
    ctx.toast(`Sold — profit ${formatCents(result.saleRow.profit_cents)}`);
    ctx.refresh();
  };

  // Undo a sale: one tap arms (3s), a second tap voids it and restores stock.
  const voidTxn = async (txn_id) => {
    const sale = recent.find((s) => s.txn_id === txn_id);
    if (!sale) return;
    const item = (await ctx.store.getAll('items')).find((i) => i.item_id === sale.item_id);
    const { updatedItem } = voidSale(sale, item);
    if (updatedItem) await save(ctx, 'items', updatedItem); // enqueues a stock put
    await ctx.store.remove('sales', sale.txn_id);
    await ctx.sync.enqueue({ kind: 'delete', tab: 'sales', id: sale.txn_id });
    await ctx.syncNow();
    ctx.toast('Sale voided — stock restored');
    ctx.refresh();
  };
  root.querySelectorAll('[data-undo]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.armed) { voidTxn(b.getAttribute('data-undo')); return; }
      b.dataset.armed = '1'; b.textContent = 'Void?'; b.classList.add('danger');
      setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Undo'; b.classList.remove('danger'); } }, 3000);
    };
  });
}
