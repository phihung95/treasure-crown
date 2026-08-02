import { reconcileTrade, processTrade, reverseTrade } from '../../core/trades.js';
import { pctOfCents } from '../../core/money.js';
import { CATEGORIES } from '../../core/schema.js';
import { dollarsToCents, formatCents, catLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;

export async function render(root, ctx) {
  const stock = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  const events = ctx.settings.events || [];
  // "Edit trade" reverses the old trade and reloads both sides into the builder.
  const pre = ctx.prefill && ctx.prefill.screen === 'trade' ? ctx.prefill : null;
  if (pre) delete ctx.prefill;
  const currentShow = pre ? pre.event : (ctx.settings.current_show || events[0] || '');
  // { item, quantity, agreed_value_cents } — resolve give items from fresh stock
  const giveLines = pre
    ? pre.giveLines.map((g) => ({ item: stock.find((i) => i.item_id === g.item_id), quantity: g.quantity, agreed_value_cents: g.agreed_value_cents })).filter((l) => l.item)
    : [];
  const getLines = pre ? pre.getLines.map((g) => ({ fields: { ...g.fields }, quantity: g.quantity, market_value_cents: g.market_value_cents })) : [];
  let editingGet = -1;
  let pct = pre ? pre.pct : (Number(ctx.settings.buy_percent) || 80);
  let cashOverridden = !!pre;
  let cashCents = pre ? pre.cash_cents : 0;
  let cashDir = pre ? pre.cash_direction : 'customer_pays_me';

  const credited = (l) => pctOfCents(l.market_value_cents || 0, pct); // per unit
  const giveTotal = () => giveLines.reduce((s, l) => s + (l.agreed_value_cents || 0) * (l.quantity || 1), 0);
  const getTotal = () => getLines.reduce((s, l) => s + credited(l) * (l.quantity || 1), 0);
  const diff = () => giveTotal() - getTotal(); // + => customer receives more => customer pays me

  root.innerHTML = `
    <h1>Trade</h1>

    <div class="card">
      <div class="side-h">You give <span class="muted">— your cards</span><span class="side-sum" id="give-sum">$0.00</span></div>
      <div id="give"></div>
      <label>Add from your stock</label>
      <input id="g-q" placeholder="Search your stock…" autocomplete="off" />
      <div id="g-res" class="search-res"></div>
    </div>

    <div class="card">
      <div class="side-h">You get <span class="muted">— their cards</span><span class="side-sum" id="get-sum">$0.00</span></div>
      <div id="get"></div>
      <div class="offer-line sug" style="border-bottom:1px solid var(--line)">
        <span>Credit their cards at</span>
        <span class="pct-ctl">
          <button class="pct-step" id="tpct-dn" aria-label="lower">−</button>
          <input id="tpct" class="pct-in" inputmode="numeric" value="${pct}" aria-label="credit percent" /><span class="pct-sign">%</span>
          <button class="pct-step" id="tpct-up" aria-label="raise">+</button>
        </span>
      </div>
      <label>Add a card they're trading in</label>
      <input id="t-name" placeholder="Card you take in" autocomplete="off" />
      <div class="row">
        <div><label>Category</label>
          <select id="t-cat">${CATEGORIES.map((c) => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select></div>
        <div><label>Qty</label><input id="t-qty" inputmode="numeric" value="1" /></div>
        <div><label>Market value $ (each)</label><input id="t-mv" inputmode="decimal" value="" placeholder="0.00" /></div>
      </div>
      <button class="btn secondary" id="add-get">Add card</button>
    </div>

    <section class="offer" id="bal" hidden>
      <div class="offer-line"><span>You give</span><span class="offer-mkt" id="b-give">$0.00</span></div>
      <div class="offer-line"><span id="b-get-k">You get (credited)</span><span class="offer-sug" id="b-get">$0.00</span></div>
      <div class="bal-net" id="b-net">Even trade</div>
      <div class="row" style="margin-top:6px">
        <div><label>Cash on top $ <span class="muted2" id="cash-reset" hidden>· auto</span></label><input id="cash" inputmode="decimal" value="0.00" /></div>
        <div><label>Direction</label>
          <select id="dir">
            <option value="customer_pays_me">Customer pays me</option>
            <option value="i_pay">I pay</option>
          </select></div>
      </div>
    </section>

    <div class="card" id="terms" hidden>
      <label>Show / event</label>
      <input id="event" list="events" value="${esc(currentShow)}" placeholder="Type a show name…" />
      <datalist id="events">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
    </div>

    <div id="recent-trades"></div>

    <div class="total-bar">
      <button class="btn secondary" style="width:auto;margin:0" id="present" disabled>Show customer</button>
      <button class="btn" style="width:auto;margin:0" id="save" disabled>${pre ? 'Save changes' : 'Save trade'}</button>
    </div>
  `;

  const $ = (s) => root.querySelector(s);

  const renderGive = () => {
    $('#give').innerHTML = giveLines.map((l, i) => `
      <div class="trade-row">
        <span class="tr-name">${esc(l.item.name)}<div class="muted">cost ${formatCents(l.item.unit_cost_cents)}</div></span>
        <span class="tr-val"><span class="cur-sm">$</span><input class="val-in" data-gv="${i}" inputmode="decimal" value="${(l.agreed_value_cents / 100).toFixed(2)}" aria-label="give value" /></span>
        <button class="btn ghost tr-del" data-dg="${i}" aria-label="remove">✕</button>
      </div>`).join('');
    root.querySelectorAll('[data-dg]').forEach((b) => { b.onclick = () => { giveLines.splice(+b.getAttribute('data-dg'), 1); renderGive(); updateTotals(); }; });
    root.querySelectorAll('[data-gv]').forEach((el) => { el.oninput = () => { giveLines[+el.getAttribute('data-gv')].agreed_value_cents = dollarsToCents(el.value); updateTotals(); }; });
  };

  const renderGet = () => {
    $('#get').innerHTML = getLines.map((l, i) => {
      if (i === editingGet) {
        return `<div class="list-item editing">
          <div class="edit-grid">
            <input class="edit-name" data-gen="${i}" value="${esc(l.fields.name)}" aria-label="name" />
            <div class="row">
              <select data-gec="${i}" aria-label="category">${CATEGORIES.map((c) => `<option value="${c}" ${c === l.fields.category ? 'selected' : ''}>${catLabel(c)}</option>`).join('')}</select>
              <input data-geq="${i}" inputmode="numeric" value="${l.quantity}" aria-label="qty" />
              <input data-gem="${i}" inputmode="decimal" value="${(l.market_value_cents / 100).toFixed(2)}" aria-label="market value each" />
            </div>
            <button class="btn secondary" data-gdone="${i}">Done</button>
          </div></div>`;
      }
      return `<div class="list-item"><span>${esc(l.fields.name)} <span class="chip">${catLabel(l.fields.category)}</span>
        <div class="muted">${l.quantity > 1 ? `×${l.quantity} · ` : ''}mkt ${formatCents(l.market_value_cents)} → credit <strong>${formatCents(credited(l) * l.quantity)}</strong> @${pct}%</div></span>
        <span class="row-actions">
          <button class="btn ghost row-btn" data-ge="${i}" aria-label="edit">✎</button>
          <button class="btn ghost row-btn" data-dt="${i}" aria-label="remove">✕</button>
        </span></div>`;
    }).join('');
    root.querySelectorAll('[data-ge]').forEach((b) => { b.onclick = () => { editingGet = +b.getAttribute('data-ge'); renderGet(); const n = $(`[data-gen="${editingGet}"]`); if (n) { n.focus(); n.select(); } }; });
    root.querySelectorAll('[data-gdone]').forEach((b) => { b.onclick = () => {
      const i = +b.getAttribute('data-gdone');
      getLines[i] = {
        fields: { name: $(`[data-gen="${i}"]`).value.trim() || getLines[i].fields.name, category: $(`[data-gec="${i}"]`).value },
        quantity: parseInt($(`[data-geq="${i}"]`).value, 10) || 1,
        market_value_cents: dollarsToCents($(`[data-gem="${i}"]`).value),
      };
      editingGet = -1; renderGet(); updateTotals();
    }; });
    root.querySelectorAll('[data-dt]').forEach((b) => { b.onclick = () => {
      const i = +b.getAttribute('data-dt');
      getLines.splice(i, 1);
      if (editingGet === i) editingGet = -1; else if (editingGet > i) editingGet -= 1;
      renderGet(); updateTotals();
    }; });
  };

  const updateTotals = () => {
    const has = giveLines.length > 0 || getLines.length > 0;
    $('#bal').hidden = !has; $('#terms').hidden = !has; $('#present').disabled = !has; $('#save').disabled = !has;
    const g = giveTotal(); const t = getTotal(); const d = diff();
    $('#give-sum').textContent = formatCents(g);
    $('#get-sum').textContent = formatCents(t);
    $('#b-give').textContent = formatCents(g);
    $('#b-get').textContent = formatCents(t);
    $('#b-get-k').textContent = `You get (credited @${pct}%)`;
    if (!cashOverridden) {
      cashCents = Math.abs(d);
      cashDir = d >= 0 ? 'customer_pays_me' : 'i_pay';
      $('#cash').value = (cashCents / 100).toFixed(2);
      $('#dir').value = cashDir;
    }
    $('#cash-reset').hidden = !cashOverridden;
    // net headline uses the actual cash currently set
    const r = reconcileTrade({ giveLines, getLines: getLines.map((l) => ({ ...l, agreed_value_cents: credited(l) })), cash_cents: cashCents, cash_direction: cashDir });
    const net = $('#b-net');
    if (r.delta_cents === 0) { net.textContent = 'Balanced — even trade'; net.className = 'bal-net even'; }
    else if (r.delta_cents > 0) { net.textContent = `In your favor by ${formatCents(r.delta_cents)}`; net.className = 'bal-net pos'; }
    else { net.textContent = `In their favor by ${formatCents(-r.delta_cents)}`; net.className = 'bal-net neg'; }
  };

  // ---- give side: search stock, add with editable value (default = market) ----
  $('#g-q').oninput = () => {
    const q = $('#g-q').value.toLowerCase();
    const shown = q ? stock.filter((i) => `${i.name} ${i.set} ${i.cert_number}`.toLowerCase().includes(q)).slice(0, 12) : [];
    $('#g-res').innerHTML = shown.map((i) =>
      `<div class="list-item" data-pg="${i.item_id}"><span>${esc(i.name)}<div class="muted">x${i.quantity_on_hand} · cost ${formatCents(i.unit_cost_cents)} · mkt ${formatCents(i.market_value_cents)}</div></span></div>`).join('');
    root.querySelectorAll('[data-pg]').forEach((el) => {
      el.onclick = () => {
        const it = stock.find((x) => x.item_id === el.getAttribute('data-pg'));
        giveLines.push({ item: it, quantity: 1, agreed_value_cents: it.market_value_cents || it.unit_cost_cents || 0 });
        $('#g-q').value = ''; $('#g-res').innerHTML = '';
        renderGive(); updateTotals();
      };
    });
  };

  $('#add-get').onclick = () => {
    const name = $('#t-name').value.trim();
    if (!name) { ctx.toast('Card name required'); return; }
    getLines.push({
      fields: { name, category: $('#t-cat').value },
      quantity: parseInt($('#t-qty').value, 10) || 1,
      market_value_cents: dollarsToCents($('#t-mv').value),
    });
    $('#t-name').value = ''; $('#t-qty').value = '1'; $('#t-mv').value = '';
    $('#t-name').focus();
    renderGet(); updateTotals();
  };
  $('#t-mv').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#add-get').click(); });

  const setPct = (v) => { pct = Math.max(1, Math.min(100, v || 0)); $('#tpct').value = pct; renderGet(); updateTotals(); };
  $('#tpct').oninput = () => setPct(parseInt($('#tpct').value, 10));
  $('#tpct-up').onclick = () => setPct(pct + 5);
  $('#tpct-dn').onclick = () => setPct(pct - 5);
  $('#cash').oninput = () => { cashOverridden = true; cashCents = dollarsToCents($('#cash').value); updateTotals(); };
  $('#dir').onchange = () => { cashOverridden = true; cashDir = $('#dir').value; updateTotals(); };

  // ---- customer-facing present view ----
  $('#present').onclick = () => {
    const giveRows = giveLines.map((l) => `<div class="present-row"><span class="present-name">${esc(l.item.name)}</span><span class="present-val">${formatCents(l.agreed_value_cents * l.quantity)}</span></div>`).join('') || '<div class="present-line"><span>—</span><span></span></div>';
    const getRows = getLines.map((l) => `<div class="present-row"><span class="present-name">${esc(l.fields.name)}${l.quantity > 1 ? ` <span class="present-q">×${l.quantity}</span>` : ''}</span><span class="present-val">${formatCents(credited(l) * l.quantity)}</span></div>`).join('') || '<div class="present-line"><span>—</span><span></span></div>';
    let cashLabel = 'Even trade — no cash';
    let big = 'EVEN';
    if (cashCents > 0) {
      cashLabel = cashDir === 'customer_pays_me' ? 'You pay us' : 'We pay you';
      big = formatCents(cashCents);
    }
    const ov = document.createElement('div');
    ov.className = 'present';
    ov.innerHTML = `
      <div class="present-card">
        <button class="present-x present-close" aria-label="Close">✕</button>
        <div class="present-head">${CROWN}<span>Treasure Crown Collectibles</span></div>
        <div class="present-title">Trade offer</div>
        <div class="present-sub">You receive from us</div>
        <div class="present-list">${giveRows}</div>
        <div class="present-sub">We credit your cards <span class="present-q">@ ${pct}%</span></div>
        <div class="present-list">${getRows}</div>
        <div class="present-sum">
          <div class="present-line"><span>You receive</span><span>${formatCents(giveTotal())}</span></div>
          <div class="present-line"><span>Your cards credited</span><span>${formatCents(getTotal())}</span></div>
        </div>
        <div class="present-offer-k">${cashLabel}</div>
        <div class="present-offer">${big}</div>
        <button class="btn present-close">Close</button>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('present-close')) ov.remove(); });
    document.body.appendChild(ov);
  };

  $('#save').onclick = async () => {
    if (giveLines.length === 0 && getLines.length === 0) { ctx.toast('Nothing to trade'); return; }
    let res;
    try {
      const ids = await ctx.sync.makeIds();
      res = processTrade({
        giveLines,
        getLines: getLines.map((l) => ({ fields: l.fields, quantity: l.quantity, agreed_value_cents: credited(l) })),
        cash_cents: cashCents, cash_direction: cashDir,
        date: new Date().toISOString().slice(0, 10), event: $('#event').value.trim(), notes: `credit ${pct}% of market`,
      }, ids);
      await ctx.sync.commitIds();
    } catch (e) { ctx.toast(e.message); return; }
    await save(ctx, 'trades', res.tradeRow);
    for (const sr of res.saleRows) await save(ctx, 'sales', sr);
    for (const u of res.updatedItems) await save(ctx, 'items', u);
    for (const n of res.newItems) await save(ctx, 'items', n);
    await ctx.setCurrentShow(res.tradeRow.event);
    await ctx.syncNow();
    ctx.toast(`Trade saved — profit ${formatCents(res.tradeRow.trade_profit_cents)}`);
    location.hash = '#/inventory';
  };

  // ---- Recent trades: edit (reverse + reload) or delete a whole trade ----
  const [trades, allItems, allSales] = await Promise.all([
    ctx.store.getAll('trades'), ctx.store.getAll('items'), ctx.store.getAll('sales'),
  ]);
  const recentTrades = trades.sort((a, b) => String(b.trade_id).localeCompare(String(a.trade_id))).slice(0, 8);
  const soldItemIds = new Set(allSales.map((s) => s.item_id));
  const receivedOf = (t) => allItems.filter((i) => i.source_trade_id === t.trade_id);
  const tradeTouched = (t) => receivedOf(t).some((i) => soldItemIds.has(i.item_id)); // a received card was resold

  const reverse = async (t) => {
    const { itemUpdates, itemDeletes, saleDeletes } = reverseTrade({ trade: t, sales: allSales, items: allItems });
    for (const it of itemUpdates) { await ctx.store.put('items', it); await ctx.sync.enqueue({ kind: 'put', tab: 'items', row: it }); }
    for (const id of itemDeletes) { await ctx.store.remove('items', id); await ctx.sync.enqueue({ kind: 'delete', tab: 'items', id }); }
    for (const id of saleDeletes) { await ctx.store.remove('sales', id); await ctx.sync.enqueue({ kind: 'delete', tab: 'sales', id }); }
    await ctx.store.remove('trades', t.trade_id); await ctx.sync.enqueue({ kind: 'delete', tab: 'trades', id: t.trade_id });
    await ctx.syncNow();
  };

  const renderRecentTrades = () => {
    const box = $('#recent-trades');
    if (!recentTrades.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="panel"><div class="panel-h">Recent trades</div>
      ${recentTrades.map((t) => {
        const touched = tradeTouched(t);
        const cash = t.cash_cents ? ` · ${t.cash_direction === 'i_pay' ? 'paid' : 'took'} ${formatCents(t.cash_cents)}` : '';
        return `<div class="sale-row">
          <div class="sale-main">
            <div class="sale-name">Trade · profit ${formatCents(t.trade_profit_cents || 0)}</div>
            <div class="muted">${esc(t.date || '')}${t.event ? ` · ${esc(t.event)}` : ''}${cash}${touched ? ' · <span class="neg">received card sold</span>' : ''}</div>
          </div>
          ${touched ? '' : `<span class="row-actions">
            <button class="btn ghost undo-btn" data-edittrade="${esc(t.trade_id)}">Edit</button>
            <button class="btn ghost undo-btn" data-deltrade="${esc(t.trade_id)}">Delete</button>
          </span>`}
        </div>`;
      }).join('')}</div>`;

    box.querySelectorAll('[data-edittrade]').forEach((b) => { b.onclick = async () => {
      const t = recentTrades.find((x) => x.trade_id === b.getAttribute('data-edittrade'));
      const giveSales = allSales.filter((s) => s.trade_id === t.trade_id && s.type === 'trade_give');
      const m = /credit (\d+)% of market/.exec(t.notes || '');
      const usedPct = m ? +m[1] : (Number(ctx.settings.buy_percent) || 80);
      ctx.prefill = {
        screen: 'trade',
        giveLines: giveSales.map((s) => ({ item_id: s.item_id, quantity: s.quantity, agreed_value_cents: s.unit_price_cents })),
        getLines: receivedOf(t).map((i) => ({ fields: { name: i.name, category: i.category }, quantity: i.quantity_on_hand, market_value_cents: usedPct ? Math.round((i.unit_cost_cents * 100) / usedPct) : i.unit_cost_cents })),
        pct: usedPct, cash_cents: t.cash_cents || 0, cash_direction: t.cash_direction || 'customer_pays_me', event: t.event,
      };
      await reverse(t);
      ctx.toast('Editing trade — adjust, then Save changes');
      ctx.refresh();
    }; });
    box.querySelectorAll('[data-deltrade]').forEach((b) => { b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000); return; }
      const t = recentTrades.find((x) => x.trade_id === b.getAttribute('data-deltrade'));
      await reverse(t);
      ctx.toast('Trade deleted — inventory restored');
      ctx.refresh();
    }; });
  };

  renderGive(); renderGet(); updateTotals();
  if (pre) { $('#cash').value = (cashCents / 100).toFixed(2); $('#dir').value = cashDir; }
  renderRecentTrades();
}
