import { allocatePurchase, marketTotalCents, suggestedOfferCents, reversePurchase } from '../../core/allocation.js';
import { newItem, CATEGORIES, PAYMENT_METHODS, CONDITIONS } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel, payLabel } from '../format.js';
import { loadDraft, saveDraft, clearDraft } from '../../data/drafts.js';
import { showNames } from '../../data/shownames.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;

export async function render(root, ctx) {
  const events = await showNames(ctx.store, ctx.settings);
  // "Edit buy" reverses the old lot and drops its cards back into the builder.
  const pre = ctx.prefill && ctx.prefill.screen === 'buy' ? ctx.prefill : null;
  if (pre) delete ctx.prefill;
  // Restore an auto-saved draft when we're not editing an existing buy.
  const draft = pre ? null : await loadDraft(ctx.store, 'buy');
  const seed = pre || draft;
  const currentShow = seed && seed.event != null ? seed.event : (ctx.settings.current_show || events[0] || '');
  const lines = seed && seed.lines ? seed.lines.map((l) => ({ ...l })) : [];
  let editing = -1;
  let pct = seed && seed.pct != null ? seed.pct : (Number(ctx.settings.buy_percent) || 80);
  let overridden = seed ? !!seed.overridden : false;
  let finalCents = seed && seed.finalCents != null ? seed.finalCents : 0;
  const seedPay = seed ? seed.payment : null;
  const seedNote = seed ? seed.note : null;

  const snapshot = () => {
    if (lines.length) saveDraft(ctx.store, 'buy', { lines, pct, overridden, finalCents, event: root.querySelector('#event') ? root.querySelector('#event').value : currentShow, payment: root.querySelector('#pay') ? root.querySelector('#pay').value : '', note: root.querySelector('#note') ? root.querySelector('#note').value : '' });
    else clearDraft(ctx.store, 'buy');
  };

  const marketTotal = () => marketTotalCents(lines);
  const suggested = () => suggestedOfferCents(lines, pct);

  root.innerHTML = `
    <h1>Buy</h1>

    <div class="card">
      <label>Add a card the customer is selling</label>
      <input id="l-name" placeholder="Umbreon VMAX Alt Art" autocomplete="off" />
      <div class="row">
        <div><label>Set</label><input id="l-set" placeholder="Evolving Skies" autocomplete="off" /></div>
        <div><label>Card #</label><input id="l-num" placeholder="215/203" autocomplete="off" /></div>
      </div>
      <div class="row">
        <div><label>Category</label>
          <select id="l-cat">${CATEGORIES.map((c) => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select></div>
        <div><label>Condition</label>
          <select id="l-cond"><option value="">—</option>${CONDITIONS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div><label>Qty</label><input id="l-qty" inputmode="numeric" value="1" /></div>
        <div><label>Market $ (each)</label><input id="l-mv" inputmode="decimal" value="" placeholder="0.00" /></div>
      </div>
      <button class="btn secondary" id="add-line">Add card</button>
    </div>

    <div id="lines"></div>

    <section class="offer" id="offer" hidden>
      <div class="offer-line"><span>Total market value</span><span class="offer-mkt" id="o-mkt">$0.00</span></div>
      <div class="offer-line">
        <span>Buy at</span>
        <span class="pct-ctl">
          <button class="pct-step" id="pct-dn" aria-label="lower">−</button>
          <input id="pct" class="pct-in" inputmode="numeric" value="${pct}" aria-label="buy percent" /><span class="pct-sign">%</span>
          <button class="pct-step" id="pct-up" aria-label="raise">+</button>
        </span>
      </div>
      <div class="offer-line sug"><span id="o-sug-k">At ${pct}% of market</span><span class="offer-sug" id="o-sug">$0.00</span></div>
      <div class="offer-final">
        <span class="offer-final-k">Offer <span class="muted2" id="o-reset" hidden>· reset to ${pct}%</span></span>
        <span class="offer-final-v"><span class="cur">$</span><input id="final" class="final-in" inputmode="decimal" value="0.00" aria-label="final offer" /></span>
      </div>
    </section>

    <div class="card" id="terms" hidden>
      <div class="row">
        <div><label>Payment (money out)</label>
          <select id="pay">${PAYMENT_METHODS.map((p) => `<option value="${p}">${payLabel(p)}</option>`).join('')}</select></div>
        <div><label>Show / event</label>
          <input id="event" list="events" value="${esc(currentShow)}" placeholder="Type a show name…" />
          <datalist id="events">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist></div>
      </div>
      <label>Notes (optional)</label>
      <input id="note" placeholder="e.g. bought from Mike · includes bonus card" autocomplete="off" />
    </div>

    <div id="recent-buys"></div>

    <div class="total-bar">
      <button class="btn secondary" style="width:auto;margin:0" id="present" disabled>Show customer</button>
      <button class="btn" style="width:auto;margin:0" id="save" disabled>${pre ? 'Save changes' : 'Record buy'}</button>
    </div>
  `;

  const $ = (s) => root.querySelector(s);
  if (pre && pre.payment_method) $('#pay').value = pre.payment_method;
  else if (seedPay) $('#pay').value = seedPay;
  if (seedNote != null) $('#note').value = seedNote;

  const renderLines = () => {
    $('#lines').innerHTML = lines.map((l, i) => {
      if (i === editing) {
        return `<div class="list-item editing">
          <div class="edit-grid">
            <input class="edit-name" data-en="${i}" value="${esc(l.name)}" aria-label="name" />
            <div class="row">
              <input data-eset="${i}" value="${esc(l.set || '')}" placeholder="Set" aria-label="set" />
              <input data-enum="${i}" value="${esc(l.card_number || '')}" placeholder="Card #" aria-label="card number" />
            </div>
            <div class="row">
              <select data-ec="${i}" aria-label="category">${CATEGORIES.map((c) => `<option value="${c}" ${c === l.category ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select>
              <select data-econd="${i}" aria-label="condition"><option value="">—</option>${CONDITIONS.map((c) => `<option value="${c}" ${c === l.condition ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <input data-eq="${i}" inputmode="numeric" value="${l.quantity}" aria-label="qty" />
              <input data-em="${i}" inputmode="decimal" value="${(l.market_value_cents / 100).toFixed(2)}" aria-label="market value each" />
            </div>
            <button class="btn secondary edit-done" data-done="${i}">Done</button>
          </div></div>`;
      }
      const meta = [l.set, l.card_number ? `#${l.card_number}` : '', l.condition].filter(Boolean).join(' · ');
      return `<div class="list-item"><span>${esc(l.name)} <span class="chip">${catLabel(l.category)}</span>${meta ? `<span class="inv-attr">${esc(meta)}</span>` : ''}
        <div class="muted">${l.quantity > 1 ? `×${l.quantity} · ` : ''}mkt ${formatCents(l.market_value_cents)}${l.quantity > 1 ? ` = ${formatCents(l.market_value_cents * l.quantity)}` : ''}</div></span>
        <span class="row-actions">
          <button class="btn ghost row-btn" data-edit="${i}" aria-label="edit">✎</button>
          <button class="btn ghost row-btn" data-del="${i}" aria-label="remove">✕</button>
        </span></div>`;
    }).join('');
    root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editing = +b.getAttribute('data-edit'); renderLines(); const n = $(`[data-en="${editing}"]`); if (n) { n.focus(); n.select(); } }; });
    root.querySelectorAll('[data-done]').forEach((b) => { b.onclick = () => {
      const i = +b.getAttribute('data-done');
      lines[i] = {
        name: $(`[data-en="${i}"]`).value.trim() || lines[i].name,
        set: $(`[data-eset="${i}"]`).value.trim(),
        card_number: $(`[data-enum="${i}"]`).value.trim(),
        condition: $(`[data-econd="${i}"]`).value,
        category: $(`[data-ec="${i}"]`).value,
        quantity: parseInt($(`[data-eq="${i}"]`).value, 10) || 1,
        market_value_cents: dollarsToCents($(`[data-em="${i}"]`).value),
      };
      editing = -1; refresh();
    }; });
    root.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => {
      const i = +b.getAttribute('data-del');
      lines.splice(i, 1);
      if (editing === i) editing = -1; else if (editing > i) editing -= 1;
      refresh();
    }; });
  };

  const refresh = () => {
    renderLines();
    const has = lines.length > 0;
    $('#offer').hidden = !has;
    $('#terms').hidden = !has;
    $('#present').disabled = !has;
    $('#save').disabled = !has;
    $('#o-mkt').textContent = formatCents(marketTotal());
    $('#o-sug').textContent = formatCents(suggested());
    $('#o-sug-k').textContent = `At ${pct}% of market`;
    if (!overridden) { finalCents = suggested(); $('#final').value = (finalCents / 100).toFixed(2); }
    $('#o-reset').hidden = !overridden;
    $('#o-reset').textContent = `· reset to ${pct}%`;
    snapshot();
  };

  $('#add-line').onclick = () => {
    const name = $('#l-name').value.trim();
    if (!name) { ctx.toast('Card name required'); return; }
    lines.push({
      name,
      set: $('#l-set').value.trim(),
      card_number: $('#l-num').value.trim(),
      condition: $('#l-cond').value,
      category: $('#l-cat').value,
      quantity: parseInt($('#l-qty').value, 10) || 1,
      market_value_cents: dollarsToCents($('#l-mv').value),
    });
    $('#l-name').value = ''; $('#l-set').value = ''; $('#l-num').value = ''; $('#l-cond').value = ''; $('#l-qty').value = '1'; $('#l-mv').value = '';
    $('#l-name').focus();
    refresh();
  };
  $('#l-mv').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#add-line').click(); });

  const setPct = (v) => { pct = Math.max(1, Math.min(100, v || 0)); $('#pct').value = pct; overridden = false; refresh(); };
  $('#pct').oninput = () => setPct(parseInt($('#pct').value, 10));
  $('#pct-up').onclick = () => setPct(pct + 5);
  $('#pct-dn').onclick = () => setPct(pct - 5);
  $('#final').oninput = () => { overridden = true; finalCents = dollarsToCents($('#final').value); $('#o-reset').hidden = false; snapshot(); };
  $('#o-reset').onclick = () => { overridden = false; refresh(); };
  $('#event').addEventListener('input', snapshot);
  $('#pay').addEventListener('change', snapshot);
  $('#note').addEventListener('input', snapshot);

  // ---- Customer-facing present mode (transparent: shows everything incl. the %) ----
  $('#present').onclick = () => {
    const rows = lines.map((l) => `
      <div class="present-row"><span class="present-name">${esc(l.name)}${l.quantity > 1 ? ` <span class="present-q">×${l.quantity}</span>` : ''}</span>
        <span class="present-val">${formatCents(l.market_value_cents * l.quantity)}</span></div>`).join('');
    const ov = document.createElement('div');
    ov.className = 'present';
    ov.innerHTML = `
      <div class="present-card">
        <button class="present-x present-close" aria-label="Close">✕</button>
        <div class="present-head">${CROWN}<span>Treasure Crown Collectibles</span></div>
        <div class="present-title">Our buy offer</div>
        <div class="present-list">${rows}</div>
        <div class="present-sum">
          <div class="present-line"><span>Total market value</span><span>${formatCents(marketTotal())}</span></div>
          <div class="present-line"><span>Our buy rate</span><span>${pct}% of market</span></div>
        </div>
        <div class="present-offer-k">We'll pay you</div>
        <div class="present-offer">${formatCents(finalCents)}</div>
        <button class="btn present-close">Close</button>
      </div>`;
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('present-close')) close(); });
    document.body.appendChild(ov);
  };

  $('#save').onclick = async () => {
    if (lines.length === 0) { ctx.toast('Add at least one card'); return; }
    if (finalCents <= 0) { ctx.toast('Set an offer above $0'); return; }
    const res = allocatePurchase({ lot_total_cents: finalCents, method: 'by_market', lines });

    const ids = await ctx.sync.makeIds();
    const purchase_id = ids.purchase();
    const when = new Date().toISOString().slice(0, 10);
    const event = $('#event').value.trim();

    for (const l of res.lines) {
      const item = newItem({
        category: l.category, name: l.name, set: l.set || '', card_number: l.card_number || '', condition: l.condition || '',
        quantity_on_hand: l.quantity,
        unit_cost_cents: l.unit_cost_cents, market_value_cents: l.market_value_cents || 0,
        acquisition: 'bought', source_purchase_id: purchase_id, acquired_date: when,
      }, ids.item());
      await save(ctx, 'items', item);
    }
    const userNote = $('#note').value.trim();
    await save(ctx, 'purchases', {
      purchase_id, date: when, event, lot_total_cents: finalCents, market_total_cents: marketTotal(),
      payment_method: $('#pay').value, allocation_method: res.method_used, item_count: res.lines.length,
      notes: [userNote, `offer ${pct}% of market ${formatCents(marketTotal())}${res.fallback ? ' (even split — missing values)' : ''}`].filter(Boolean).join(' · '),
    });
    await ctx.sync.commitIds();
    await clearDraft(ctx.store, 'buy');
    await ctx.setCurrentShow(event);
    await ctx.syncNow();
    ctx.toast(`Bought ${res.lines.length} card(s) for ${formatCents(finalCents)}`);
    location.hash = '#/inventory';
  };

  // ---- Recent buys: edit (reverse + reload into builder) or delete a whole lot ----
  const [purchases, allItems, allSales] = await Promise.all([
    ctx.store.getAll('purchases'), ctx.store.getAll('items'), ctx.store.getAll('sales'),
  ]);
  const recentBuys = purchases.sort((a, b) => String(b.purchase_id).localeCompare(String(a.purchase_id))).slice(0, 8);
  const soldItemIds = new Set(allSales.map((s) => s.item_id));
  const lotItems = (p) => allItems.filter((i) => i.source_purchase_id === p.purchase_id);
  const lotSold = (p) => lotItems(p).some((i) => soldItemIds.has(i.item_id));

  // Reverse a lot LOCALLY (fast), then push the deletes in the background. The UI
  // never waits on the network — so Edit repopulates the builder instantly instead
  // of appearing to vanish while a slow sync completes.
  const reverseBuy = async (p) => {
    const { itemDeletes } = reversePurchase({ purchase: p, items: allItems });
    for (const id of itemDeletes) { await ctx.store.remove('items', id); await ctx.sync.enqueue({ kind: 'delete', tab: 'items', id }); }
    await ctx.store.remove('purchases', p.purchase_id); await ctx.sync.enqueue({ kind: 'delete', tab: 'purchases', id: p.purchase_id });
    ctx.syncNow(); // background — deletes are already saved locally and queued
  };

  const renderRecentBuys = () => {
    const box = $('#recent-buys');
    if (!recentBuys.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="panel"><div class="panel-h">Recent buys</div>
      ${recentBuys.map((p) => {
        const sold = lotSold(p);
        return `<div class="sale-row">
          <div class="sale-main">
            <div class="sale-name">${p.item_count} card${p.item_count === 1 ? '' : 's'} · ${formatCents(p.lot_total_cents)}</div>
            <div class="muted">${esc(p.date || '')}${p.event ? ` · ${esc(p.event)}` : ''}${sold ? ' · <span class="neg">has sold cards</span>' : ''}</div>
          </div>
          ${sold ? '' : `<span class="row-actions">
            <button class="btn ghost undo-btn" data-editbuy="${esc(p.purchase_id)}">Edit</button>
            <button class="btn ghost undo-btn" data-delbuy="${esc(p.purchase_id)}">Delete</button>
          </span>`}
        </div>`;
      }).join('')}</div>`;

    box.querySelectorAll('[data-editbuy]').forEach((b) => { b.onclick = async () => {
      // Guard: editing a past buy replaces the current entry. If one's in
      // progress, require a confirming second tap so it's never lost by accident.
      if (lines.length && !b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = 'Discard current?'; b.classList.add('danger');
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Edit'; b.classList.remove('danger'); } }, 3500);
        return;
      }
      const p = recentBuys.find((x) => x.purchase_id === b.getAttribute('data-editbuy'));
      const preLines = lotItems(p).map((i) => ({ name: i.name, set: i.set, card_number: i.card_number, condition: i.condition, category: i.category, quantity: i.quantity_on_hand, market_value_cents: i.market_value_cents }));
      await reverseBuy(p);
      ctx.prefill = { screen: 'buy', lines: preLines, finalCents: p.lot_total_cents, event: p.event, payment_method: p.payment_method };
      ctx.toast('Editing buy — adjust, then Save changes');
      ctx.refresh();
    }; });
    box.querySelectorAll('[data-delbuy]').forEach((b) => { b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000); return; }
      const p = recentBuys.find((x) => x.purchase_id === b.getAttribute('data-delbuy'));
      await reverseBuy(p);
      ctx.toast('Buy deleted — cards removed');
      ctx.refresh();
    }; });
  };

  refresh();
  renderRecentBuys();
  if (overridden) $('#final').value = (finalCents / 100).toFixed(2);
  // After tapping Edit on a recent buy (which lives at the bottom), scroll up so
  // the reloaded cards are visible — otherwise it looks like the buy vanished.
  if (pre) setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
}
