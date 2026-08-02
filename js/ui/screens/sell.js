import { bookSale, voidSale } from '../../core/sales.js';
import { PAYMENT_METHODS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';
import { loadDraft, saveDraft, clearDraft } from '../../data/drafts.js';

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
    <div id="recent"></div>
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
    snapshot();
  };

  const $ = (s) => root.querySelector(s);
  // Auto-save the in-progress sale so a reload/crash mid-entry doesn't lose it.
  const snapshot = () => {
    if (selected) saveDraft(ctx.store, 'sell', { item_id: selected.item_id, qty: $('#qty').value, price: $('#price').value, dice: isDice(), pay: $('#pay').value, event: $('#event').value });
    else clearDraft(ctx.store, 'sell');
  };

  root.querySelector('#q').oninput = renderResults;
  root.querySelector('#dice').onchange = () => { setPrice(); snapshot(); };
  ['#qty', '#price', '#event'].forEach((s) => $(s).addEventListener('input', snapshot));
  $('#pay').addEventListener('change', snapshot);

  // Restore a draft sale if its item is still in stock.
  const draft = await loadDraft(ctx.store, 'sell');
  if (draft && items.some((i) => i.item_id === draft.item_id)) {
    pick(draft.item_id);
    $('#dice').checked = !!draft.dice;
    $('#qty').value = draft.qty ?? '1';
    $('#price').value = draft.price ?? $('#price').value;
    if (draft.pay) $('#pay').value = draft.pay;
    if (draft.event != null) $('#event').value = draft.event;
  }

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
    await clearDraft(ctx.store, 'sell');
    await ctx.setCurrentShow(result.saleRow.event);
    await ctx.syncNow();
    ctx.toast(`Sold — profit ${formatCents(result.saleRow.profit_cents)}`);
    ctx.refresh();
  };

  // ---- Recent sales: edit price/qty/payment/show or delete, with stock kept in sync ----
  let editingSale = null; // txn_id being edited

  const displayRow = (s) => `<div class="sale-row">
    <div class="sale-main">
      <div class="sale-name">${esc(s.item_name || s.item_id)}${s.channel === 'dice' ? ' <span class="chip">🎲 dice</span>' : ''}</div>
      <div class="muted">×${s.quantity} · ${formatCents(s.unit_price_cents)}${s.event ? ` · ${esc(s.event)}` : ''}</div>
    </div>
    <button class="btn ghost undo-btn" data-editsale="${esc(s.txn_id)}">Edit</button>
  </div>`;

  const editRow = (s) => `<div class="sale-row editing">
    <div class="edit-grid">
      <div class="sale-name">${esc(s.item_name || s.item_id)}</div>
      <div class="row">
        <div><label>Qty</label><input data-eq inputmode="numeric" value="${s.quantity}" /></div>
        <div><label>Price $ (each)</label><input data-ep inputmode="decimal" value="${(s.unit_price_cents / 100).toFixed(2)}" /></div>
      </div>
      <label>Payment</label>
      <select data-epay>${PAYMENT_METHODS.map((p) => `<option value="${p}" ${p === s.payment_method ? 'selected' : ''}>${payLabel(p)}</option>`).join('')}</select>
      <label>Show / event</label>
      <input data-eev list="events" value="${esc(s.event || '')}" />
      <label class="dice-toggle"><input type="checkbox" data-edice ${s.channel === 'dice' ? 'checked' : ''} />
        <span>🎲 Dice challenge</span></label>
      <div class="row">
        <button class="btn secondary" data-savesale="${esc(s.txn_id)}">Save changes</button>
        <button class="btn ghost" data-canceledit>Cancel</button>
      </div>
      <button class="btn ghost sale-del" data-delsale="${esc(s.txn_id)}">Delete sale</button>
    </div>
  </div>`;

  const renderRecent = () => {
    const box = root.querySelector('#recent');
    if (!recent.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="panel"><div class="panel-h">Recent sales</div>
      ${recent.map((s) => (s.txn_id === editingSale ? editRow(s) : displayRow(s))).join('')}</div>`;

    box.querySelectorAll('[data-editsale]').forEach((b) => { b.onclick = () => { editingSale = b.getAttribute('data-editsale'); renderRecent(); }; });
    const cancel = box.querySelector('[data-canceledit]');
    if (cancel) cancel.onclick = () => { editingSale = null; renderRecent(); };

    const saveBtn = box.querySelector('[data-savesale]');
    if (saveBtn) saveBtn.onclick = async () => {
      const sale = recent.find((s) => s.txn_id === saveBtn.getAttribute('data-savesale'));
      const item = (await ctx.store.getAll('items')).find((i) => i.item_id === sale.item_id);
      let updatedSale; let updatedItem;
      try {
        ({ updatedSale, updatedItem } = editSale(sale, item, {
          quantity: parseInt(box.querySelector('[data-eq]').value, 10),
          unit_price_cents: dollarsToCents(box.querySelector('[data-ep]').value),
          payment_method: box.querySelector('[data-epay]').value,
          event: box.querySelector('[data-eev]').value.trim(),
          channel: box.querySelector('[data-edice]').checked ? 'dice' : '',
        }));
      } catch (e) { ctx.toast(e.message); return; }
      if (updatedItem) await save(ctx, 'items', updatedItem);
      await save(ctx, 'sales', updatedSale);
      await ctx.syncNow();
      ctx.toast('Sale updated');
      ctx.refresh();
    };

    const delBtn = box.querySelector('[data-delsale]');
    if (delBtn) delBtn.onclick = async () => {
      if (!delBtn.dataset.armed) {
        delBtn.dataset.armed = '1'; delBtn.textContent = 'Tap again to delete'; delBtn.classList.add('danger');
        setTimeout(() => { if (delBtn.isConnected && delBtn.dataset.armed) { delete delBtn.dataset.armed; delBtn.textContent = 'Delete sale'; delBtn.classList.remove('danger'); } }, 3000);
        return;
      }
      const sale = recent.find((s) => s.txn_id === delBtn.getAttribute('data-delsale'));
      const item = (await ctx.store.getAll('items')).find((i) => i.item_id === sale.item_id);
      const { updatedItem } = voidSale(sale, item);
      if (updatedItem) await save(ctx, 'items', updatedItem);
      await ctx.store.remove('sales', sale.txn_id);
      await ctx.sync.enqueue({ kind: 'delete', tab: 'sales', id: sale.txn_id });
      await ctx.syncNow();
      ctx.toast('Sale deleted — stock restored');
      ctx.refresh();
    };
  };
  renderRecent();
}
