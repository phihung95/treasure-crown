import { bookSale, voidSale, bookCustomSale, bookLotSale, editSale } from '../../core/sales.js';
import { PAYMENT_METHODS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';
import { loadDraft, saveDraft, clearDraft } from '../../data/drafts.js';
import { showNames } from '../../data/shownames.js';

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const items = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  const events = await showNames(ctx.store, ctx.settings);
  const currentShow = ctx.settings.current_show || events[0] || '';
  let selected = null;
  const lot = [];            // [{ item }] — cards in the current bundle
  let lotMode = false;
  let lotPriceEdited = false;

  // Most recent sales first (txn ids are monotonic), for quick fix/undo.
  const allSales = (await ctx.store.getAll('sales'))
    .filter((s) => s.type === 'sale')
    .sort((a, b) => String(b.txn_id).localeCompare(String(a.txn_id)));
  const recent = allSales.slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);
  const todays = allSales.filter((s) => s.date === today);
  const todayRevenue = todays.reduce((sum, r) => sum + (r.revenue_cents || 0), 0);

  root.innerHTML = `
    <h1>Sell</h1>
    <label class="dice-toggle" id="lot-toggle"><input type="checkbox" id="lot-mode" />
      <span>🧺 Sell several as a lot</span>
      <span class="muted">— one bundle price, split across the cards</span></label>
    <input id="q" placeholder="Find item to sell…" />
    <div id="results"></div>
    <section id="lot" hidden>
      <div class="card" id="lot-cart"></div>
      <label>Bundle price $ (total for all)</label>
      <input id="lot-price" inputmode="decimal" value="0.00" />
      <div class="muted" id="lot-split" style="margin:6px 0"></div>
      <label>Payment</label>
      <select id="lot-pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select>
      <label>Source</label>
      <input id="lot-event" list="events" value="${currentShow}" placeholder="Show, Facebook Marketplace, eBay…" />
      <label>Notes (optional)</label>
      <input id="lot-note" placeholder="e.g. bundle deal" autocomplete="off" />
      <button class="btn" id="lot-do" disabled>Record lot sale</button>
    </section>
    <div id="form" hidden>
      <div id="sel"></div>
      <div id="custom-fields" hidden>
        <label>Item name</label>
        <input id="c-name" placeholder="What are you selling?" autocomplete="off" />
        <label>Your cost $ each (optional)</label>
        <input id="c-cost" inputmode="decimal" value="0.00" />
      </div>
      <label class="dice-toggle"><input type="checkbox" id="dice" />
        <span>🎲 Dice challenge</span>
        <span class="muted">— $5 a roll, tracked separately</span></label>
      <div class="row">
        <div><label>Qty</label><input id="qty" inputmode="numeric" value="1" /></div>
        <div><label>Price $ (each)</label><input id="price" inputmode="decimal" value="0.00" /></div>
      </div>
      <label>Payment</label>
      <select id="pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select>
      <label>Source</label>
      <input id="event" list="events" value="${currentShow}" placeholder="Show, Facebook Marketplace, eBay…" />
      <datalist id="events">${events.map((e) => `<option value="${e}">`).join('')}</datalist>
      <label>Notes (optional)</label>
      <input id="note" placeholder="e.g. corner ding · holding for pickup" autocomplete="off" />
      <button class="btn" id="do">Record sale</button>
      <button class="btn ghost" id="clear-sel">Clear</button>
    </div>
    <div id="recent"></div>
  `;

  const renderResults = () => {
    const raw = root.querySelector('#q').value.trim();
    const q = raw.toLowerCase();
    const shown = q ? items.filter((i) => `${i.name} ${i.set} ${i.cert_number}`.toLowerCase().includes(q)).slice(0, 25) : [];
    // Lot mode: tapping a result adds/removes it from the bundle cart.
    if (lotMode) {
      root.querySelector('#results').innerHTML = shown.map((i) => {
        const inLot = lot.some((l) => l.item.item_id === i.item_id);
        return `<div class="list-item${inLot ? ' lot-in' : ''}" data-lotadd="${i.item_id}">
          <span>${i.name} <span class="chip">${catLabel(i.category)}</span>
            <div class="muted">x${i.quantity_on_hand} · mkt ${formatCents(i.market_value_cents)}</div></span>
          <span class="muted">${inLot ? '✓ in lot' : '＋ add'}</span></div>`;
      }).join('');
      root.querySelectorAll('[data-lotadd]').forEach((el) => { el.onclick = () => toggleLot(el.getAttribute('data-lotadd')); });
      return;
    }
    // Always offer a one-off sale for whatever's typed, in case it's not in inventory.
    const customRow = raw ? `<div class="list-item custom-pick" data-pickcustom="1">
      <span>＋ Record “<strong>${esc(raw)}</strong>” <span class="chip">not in inventory</span>
        <div class="muted">a one-off sale — doesn't change stock</div></span></div>` : '';
    root.querySelector('#results').innerHTML = shown.map((i) => `
      <div class="list-item" data-pick="${i.item_id}">
        <span>${i.name} <span class="chip">${catLabel(i.category)}</span>
          <div class="muted">x${i.quantity_on_hand} · cost ${formatCents(i.unit_cost_cents)}</div></span>
        <span class="muted">${formatCents(i.market_value_cents)}</span>
      </div>`).join('') + customRow;
    root.querySelectorAll('[data-pick]').forEach((el) => { el.onclick = () => pick(el.getAttribute('data-pick')); });
    const cp = root.querySelector('[data-pickcustom]');
    if (cp) cp.onclick = () => pickCustom(raw);
  };

  // ---- Lot / bundle sale: pick several cards, one price, split by market value ----
  const lotMarketTotal = () => lot.reduce((s, l) => s + (l.item.market_value_cents || 0), 0);
  const toggleLot = (id) => {
    const at = lot.findIndex((l) => l.item.item_id === id);
    if (at >= 0) lot.splice(at, 1);
    else { const it = items.find((i) => i.item_id === id); if (it) lot.push({ item: it }); }
    renderLot(); renderResults();
  };
  const renderLot = () => {
    const cart = root.querySelector('#lot-cart');
    const doBtn = root.querySelector('#lot-do');
    if (!lot.length) {
      cart.innerHTML = '<p class="muted">Search above and tap cards to add them to the lot.</p>';
      root.querySelector('#lot-split').textContent = ''; doBtn.disabled = true; return;
    }
    cart.innerHTML = lot.map((l, i) => `<div class="sale-row">
      <div class="sale-main"><div class="sale-name">${esc(l.item.name)}</div>
        <div class="muted">mkt ${formatCents(l.item.market_value_cents)}</div></div>
      <button class="btn ghost undo-btn" data-lotrm="${i}">Remove</button></div>`).join('');
    root.querySelectorAll('[data-lotrm]').forEach((b) => { b.onclick = () => { lot.splice(+b.getAttribute('data-lotrm'), 1); renderLot(); renderResults(); }; });
    if (!lotPriceEdited) root.querySelector('#lot-price').value = (lotMarketTotal() / 100).toFixed(2);
    const price = dollarsToCents(root.querySelector('#lot-price').value);
    const mkt = lotMarketTotal();
    const vs = mkt > 0 ? ` · market total ${formatCents(mkt)} (${Math.round((price / mkt) * 100)}%)` : '';
    root.querySelector('#lot-split').textContent = `${formatCents(price)} split across ${lot.length} card${lot.length === 1 ? '' : 's'} by value${vs}`;
    doBtn.disabled = false;
  };

  const isDice = () => root.querySelector('#dice').checked;
  const setPrice = () => {
    if (isDice()) { root.querySelector('#price').value = '5.00'; return; }
    if (selected && selected.custom) return; // one-off: keep whatever price is typed
    root.querySelector('#price').value = selected ? (selected.market_value_cents / 100).toFixed(2) : '0.00';
  };

  // A prominent "selected" card so it's obvious which item was tapped. The ✕
  // dismisses the selection (same as Clear).
  const selCard = (title, sub) => `<div class="sel-card"><span class="sel-check">✓</span>
    <div class="sel-info"><div class="sel-name">${esc(title)}</div><div class="muted">${sub}</div></div>
    <button class="sel-x" data-clearsel aria-label="Unselect">✕</button></div>`;
  // After picking, collapse the search results and bring the selection to the top.
  const focusSelection = () => {
    root.querySelector('#results').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Record a sale for something not in inventory: type a name + price (+ optional cost).
  const pickCustom = (typed) => {
    const name = (typed ?? root.querySelector('#q').value).trim();
    selected = { custom: true, name, category: 'single', unit_cost_cents: 0 };
    root.querySelector('#form').hidden = false;
    root.querySelector('#custom-fields').hidden = false;
    root.querySelector('#c-name').value = name;
    root.querySelector('#sel').innerHTML = selCard(name || 'One-off sale', "not in inventory — won't change stock");
    setPrice();
    focusSelection();
    snapshot();
  };

  const pick = (id) => {
    selected = items.find((i) => i.item_id === id);
    root.querySelector('#custom-fields').hidden = true;
    root.querySelector('#form').hidden = false;
    const meta = [selected.set, selected.card_number ? `#${selected.card_number}` : '', selected.condition].filter(Boolean).join(' · ');
    root.querySelector('#sel').innerHTML = selCard(selected.name, `${meta ? `${esc(meta)} · ` : ''}on hand ×${selected.quantity_on_hand} · cost ${formatCents(selected.unit_cost_cents)}`);
    setPrice();
    focusSelection();
    snapshot();
  };

  const $ = (s) => root.querySelector(s);
  // Auto-save the in-progress sale so a reload/crash mid-entry doesn't lose it.
  const snapshot = () => {
    if (!selected) { clearDraft(ctx.store, 'sell'); return; }
    const common = { qty: $('#qty').value, price: $('#price').value, dice: isDice(), pay: $('#pay').value, event: $('#event').value, note: $('#note').value };
    if (selected.custom) saveDraft(ctx.store, 'sell', { custom: true, cname: $('#c-name').value, ccost: $('#c-cost').value, ...common });
    else saveDraft(ctx.store, 'sell', { item_id: selected.item_id, ...common });
  };

  // Drop the current selection and wipe the saved draft, so returning to Sell
  // later starts fresh instead of reopening the last item.
  const clearSelection = () => {
    selected = null;
    $('#form').hidden = true;
    $('#custom-fields').hidden = true;
    $('#dice').checked = false;
    $('#note').value = '';
    $('#c-name').value = ''; $('#c-cost').value = '0.00';
    $('#q').value = '';
    clearDraft(ctx.store, 'sell');
    renderResults();
    $('#q').focus();
  };

  root.querySelector('#q').oninput = renderResults;
  root.querySelector('#dice').onchange = () => { setPrice(); snapshot(); };
  ['#qty', '#price', '#event', '#note', '#c-name', '#c-cost'].forEach((s) => $(s).addEventListener('input', snapshot));
  $('#pay').addEventListener('change', snapshot);
  $('#clear-sel').onclick = clearSelection;
  // The ✕ on the selected card (its content changes, so delegate on the container).
  $('#sel').addEventListener('click', (e) => { if (e.target.closest('[data-clearsel]')) clearSelection(); });

  // Lot mode: toggle switches the search into "add to bundle" behavior.
  $('#lot-mode').onchange = () => {
    lotMode = $('#lot-mode').checked;
    $('#lot').hidden = !lotMode;
    $('#form').hidden = true; selected = null; // close any single-sale form
    $('#q').value = '';
    renderResults(); renderLot();
  };
  $('#lot-price').addEventListener('input', () => { lotPriceEdited = true; renderLot(); });
  $('#lot-do').onclick = async () => {
    if (!lot.length) return;
    const price = dollarsToCents($('#lot-price').value);
    if (price <= 0) { ctx.toast('Set a bundle price'); return; }
    let result;
    try {
      const ids = await ctx.sync.makeIds();
      result = bookLotSale({
        lines: lot.map((l) => ({ item: l.item, quantity: 1 })),
        lot_total_cents: price, payment_method: $('#lot-pay').value,
        date: new Date().toISOString().slice(0, 10),
        event: $('#lot-event').value.trim(), notes: $('#lot-note').value.trim(),
      }, ids);
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    for (const u of result.updatedItems) await save(ctx, 'items', u);
    for (const s of result.saleRows) await save(ctx, 'sales', s);
    await ctx.setCurrentShow($('#lot-event').value.trim());
    await ctx.syncNow();
    const profit = result.saleRows.reduce((s, r) => s + r.profit_cents, 0);
    ctx.toast(`Lot sold — ${result.saleRows.length} cards, profit ${formatCents(profit)}`);
    ctx.refresh();
  };

  // Restore a draft sale: a one-off, or an inventory item still in stock.
  const draft = await loadDraft(ctx.store, 'sell');
  const restoreCommon = () => {
    $('#dice').checked = !!draft.dice;
    $('#qty').value = draft.qty ?? '1';
    $('#price').value = draft.price ?? $('#price').value;
    if (draft.pay) $('#pay').value = draft.pay;
    if (draft.event != null) $('#event').value = draft.event;
    if (draft.note != null) $('#note').value = draft.note;
  };
  if (draft && draft.custom) {
    pickCustom(draft.cname || '');
    $('#c-cost').value = draft.ccost ?? '0.00';
    restoreCommon();
  } else if (draft && items.some((i) => i.item_id === draft.item_id)) {
    pick(draft.item_id);
    restoreCommon();
  }

  root.querySelector('#do').onclick = async () => {
    if (!selected) return;
    const price = dollarsToCents(root.querySelector('#price').value);
    const common = {
      unit_price_cents: price,
      payment_method: root.querySelector('#pay').value,
      date: new Date().toISOString().slice(0, 10),
      event: root.querySelector('#event').value.trim(),
      notes: root.querySelector('#note').value.trim(),
      channel: isDice() ? 'dice' : '',
    };
    let result;
    try {
      const ids = await ctx.sync.makeIds();
      if (selected.custom) {
        const qty = Math.max(1, parseInt(root.querySelector('#qty').value, 10) || 1);
        result = bookCustomSale({
          name: root.querySelector('#c-name').value.trim(), category: 'single', quantity: qty,
          unit_cost_cents: dollarsToCents(root.querySelector('#c-cost').value), ...common,
        }, ids.sale());
      } else {
        const qty = parseInt(root.querySelector('#qty').value, 10) || 0;
        result = bookSale({ item: selected, quantity: qty, ...common }, ids.sale());
      }
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    if (result.updatedItem) await save(ctx, 'items', result.updatedItem);
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
      <label>Source</label>
      <input data-eev list="events" value="${esc(s.event || '')}" />
      <label>Notes</label>
      <input data-enote value="${esc(s.notes || '')}" placeholder="optional" />
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
    box.innerHTML = `<div class="panel">
      <div class="panel-h recent-h">Recent sales${todays.length ? `<span class="recent-today">Today: ${todays.length} · ${formatCents(todayRevenue)}</span>` : ''}</div>
      ${recent.map((s) => (s.txn_id === editingSale ? editRow(s) : displayRow(s))).join('')}
      ${allSales.length > recent.length ? '<a class="recent-all" href="#/shows">See all in Shows →</a>' : ''}</div>`;

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
          notes: box.querySelector('[data-enote]').value.trim(),
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
