import { aggregate, aggregatePeriod } from '../../core/dashboard.js';
import { transactionCashCents, manualCashCents, moneyHeldCents } from '../../core/cash.js';
import { formatCents, catLabel } from '../format.js';

const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function signed(cents) { return `${cents >= 0 ? '+' : ''}${formatCents(cents)}`; }

// A short, human descriptor for an item — set + card number, or grade for slabs.
function itemMeta(it) {
  if (it.category === 'slab') {
    const grade = (it.grade || '').trim();
    const grader = (it.grader || '').trim();
    if (grade && grader && !grade.toLowerCase().includes(grader.toLowerCase())) return `${grader} ${grade}`;
    return grade || grader || 'Graded';
  }
  return [it.set, it.card_number ? `#${it.card_number}` : ''].filter(Boolean).join(' ');
}

const PERIODS = [['today', 'Day'], ['week', '7d'], ['month', 'Month'], ['all', 'All'], ['custom', 'Custom']];

export async function render(root, ctx) {
  await ctx.reconcile(); // pull the latest from all devices so the numbers are current
  const sales = await ctx.store.getAll('sales');
  const items = await ctx.store.getAll('items');
  const [purchases, trades, cashEvents, expenses] = await Promise.all([
    ctx.store.getAll('purchases'), ctx.store.getAll('trades'), ctx.store.getAll('cash_events'), ctx.store.getAll('expenses'),
  ]);
  const cashTotal = transactionCashCents({ sales, purchases, trades }) + manualCashCents(cashEvents);
  // Money the business holds across ALL payment methods (cash + Zelle + Cash App)
  // minus buys and expenses — so Business Value = inventory + money never drops
  // when you sell, but does drop when you spend on the business.
  const money = moneyHeldCents({ sales, purchases, trades, cashEvents, expenses });
  const settings = await ctx.reloadSettings();

  const a = aggregate({ sales, items, period: 'show' });
  const active = items.filter((it) => it.quantity_on_hand > 0);
  const itemCount = active.length;
  const unitCount = active.reduce((s, it) => s + it.quantity_on_hand, 0);
  const invCost = a.inventory.cost_cents;
  const invMkt = a.inventory.market_cents;
  const invGain = invMkt - invCost;
  // Total business value = what the inventory is worth + the money made from it.
  const bizValue = invMkt + money;
  const hasSales = sales.length > 0;

  // First run: nothing to show yet.
  if (itemCount === 0 && !hasSales) {
    root.innerHTML = `
      <div class="dash-head"><h1>Home</h1></div>
      <div class="card empty">${CROWN}
        <h2>Welcome to your treasury</h2>
        <p>Add inventory or log your first sale — your business value, profit, and holdings show up here.</p>
        <div class="empty-actions">
          <a class="btn" href="#/buy">Add a buy</a>
          <a class="btn secondary" href="#/sell">Record a sale</a>
        </div></div>`;
    return;
  }

  // ---- Period performance (the flows within a chosen date window) ----
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const rangeFor = (p, cs, ce) => {
    switch (p) {
      case 'today': return { start: today, end: today, label: 'Today' };
      case 'week': return { start: daysAgo(6), end: today, label: 'Last 7 days' };
      case 'all': return { start: '0000-01-01', end: '9999-12-31', label: 'All time' };
      case 'custom': return { start: cs || `${today.slice(0, 8)}01`, end: ce || today, label: 'Custom range' };
      case 'month': default: return { start: `${today.slice(0, 8)}01`, end: today, label: 'This month' };
    }
  };
  let period = PERIODS.some(([k]) => k === settings.dash_period) ? settings.dash_period : 'month';
  let cStart = `${today.slice(0, 8)}01`;
  let cEnd = today;

  const perfBody = (range) => {
    const p = aggregatePeriod({ sales, purchases, trades, expenses, start: range.start, end: range.end });
    const va = p.value_added_cents;
    const nothing = p.sold.units === 0 && p.bought.items === 0 && p.traded.count === 0;
    if (nothing) {
      return `<div class="perf-hero"><span class="perf-hero-k">Value added · ${esc(range.label)}</span><span class="perf-hero-v">$0.00</span></div>
        <p class="perf-empty">No sales, buys, or trades in this window yet.</p>`;
    }
    const cell = (k, v, cls) => `<div class="pm"><span class="pm-k">${k}</span><span class="pm-v ${cls || ''}">${v}</span></div>`;
    const cells = [
      cell('Sold', `${p.sold.units} · ${formatCents(p.sold.revenue_cents)}`),
      cell('Sale profit', signed(p.sold.profit_cents), p.sold.profit_cents >= 0 ? 'pos' : 'neg'),
      cell('Bought', `${p.bought.items} · ${formatCents(p.bought.spent_cents)}`),
      cell('Net cash', signed(p.net_cash_cents), p.net_cash_cents >= 0 ? 'pos' : 'neg'),
    ];
    if (p.traded.count) cells.push(cell('Trades', `${p.traded.count} · ${signed(p.traded.profit_cents)}`, p.traded.profit_cents >= 0 ? 'pos' : 'neg'));
    if (p.dice.rolls) cells.push(cell('🎲 Dice', `${p.dice.rolls} · ${formatCents(p.dice.revenue_cents)}`));
    if (p.expenses_cents) cells.push(cell('Expenses', `−${formatCents(p.expenses_cents)}`, 'neg'));
    return `
      <div class="perf-hero">
        <span class="perf-hero-k">Value added · ${esc(range.label)}</span>
        <span class="perf-hero-v ${va >= 0 ? 'pos' : 'neg'}">${signed(va)}</span>
      </div>
      <div class="perf-grid">${cells.join('')}</div>`;
  };

  const top = [...active]
    .map((it) => ({ it, total: it.quantity_on_hand * it.market_value_cents }))
    .sort((p, q) => q.total - p.total)
    .slice(0, 5);

  const catRows = Object.keys(a.byCategory)
    .map((c) => ({ c, v: a.byCategory[c] }))
    .filter((r) => r.v.inventory_market_cents > 0)
    .sort((p, q) => q.v.inventory_market_cents - p.v.inventory_market_cents);

  root.innerHTML = `
    <div class="dash-head"><h1>Home</h1></div>

    <section class="hero">
      <div class="hero-top"><span class="hero-label">Business value</span>${CROWN}</div>
      <div class="hero-amount">${formatCents(bizValue)}</div>
      <div class="hero-breakdown">
        <span class="hb-part"><span class="hb-k">Inventory</span><span class="hb-v">${formatCents(invMkt)}</span></span>
        <span class="hb-plus">+</span>
        <span class="hb-part"><span class="hb-k">Money</span><span class="hb-v ${money < 0 ? 'neg' : ''}">${signed(money)}</span></span>
      </div>
      <div class="hero-sub">
        <span>${itemCount} item${itemCount === 1 ? '' : 's'} · ${unitCount} unit${unitCount === 1 ? '' : 's'} · inventory at market</span>
      </div>
    </section>

    <section class="panel perf">
      <div class="perf-title">Performance</div>
      <div class="seg perf-seg" role="tablist" aria-label="Time range">
        ${PERIODS.map(([k, lbl]) => `<button class="seg-btn ${k === period ? 'on' : ''}" data-p="${k}" role="tab" aria-selected="${k === period}">${lbl}</button>`).join('')}
      </div>
      <div class="perf-custom" id="perf-custom" ${period === 'custom' ? '' : 'hidden'}>
        <div><label>From</label><input type="date" id="c-start" value="${cStart}" max="${today}" /></div>
        <div><label>To</label><input type="date" id="c-end" value="${cEnd}" max="${today}" /></div>
      </div>
      <div id="perf-body">${perfBody(rangeFor(period, cStart, cEnd))}</div>
    </section>

    <nav class="hub-actions" aria-label="Quick actions">
      <a class="hub-btn" href="#/buy"><span class="hub-ic" aria-hidden="true">＋</span>Buy</a>
      <a class="hub-btn" href="#/sell"><span class="hub-ic" aria-hidden="true">＄</span>Sell</a>
      <a class="hub-btn" href="#/trade"><span class="hub-ic" aria-hidden="true">⇄</span>Trade</a>
    </nav>

    <a class="cash-card" href="#/cash">
      <span class="cash-card-k">💵 Cash on hand</span>
      <span class="cash-card-r"><span class="cash-card-v ${cashTotal < 0 ? 'neg' : ''}">${formatCents(cashTotal)}</span><span class="cash-card-go">Manage →</span></span>
    </a>

    <div class="stat-row">
      <div class="stat"><span class="stat-k">Cost basis</span><span class="stat-v">${formatCents(invCost)}</span></div>
      <div class="stat"><span class="stat-k">Unrealized</span><span class="stat-v ${invGain >= 0 ? 'pos' : 'neg'}">${signed(invGain)}</span></div>
    </div>

    ${catRows.length ? `<section class="panel">
      <div class="panel-h">Inventory by category</div>
      <div class="tbl by-cat">
        <div class="thd"><span>Category</span><span class="num">At market</span><span class="num">Unrealized</span></div>
        ${catRows.map(({ c, v }) => {
          const gain = v.inventory_market_cents - v.inventory_cost_cents;
          return `<div class="trow">
            <span class="tname">${catLabel(c)}<span class="tsub">${formatCents(v.inventory_cost_cents)} at cost</span></span>
            <span class="num">${formatCents(v.inventory_market_cents)}</span>
            <span class="num ${gain >= 0 ? 'pos' : 'neg'}">${signed(gain)}</span>
          </div>`;
        }).join('')}
      </div>
    </section>` : ''}

    ${top.length ? `<section class="panel">
      <div class="panel-h">Top holdings</div>
      <div class="tbl by-top">
        ${top.map(({ it, total }) => `<div class="trow">
          <span class="tname">${esc(it.name)} <span class="chip">${catLabel(it.category)}</span>
            <span class="tsub">${esc(itemMeta(it))}${it.quantity_on_hand > 1 ? ` · ×${it.quantity_on_hand}` : ''}</span></span>
          <span class="num">${formatCents(total)}</span>
        </div>`).join('')}
      </div>
    </section>` : ''}

    ${!hasSales ? `<a class="hint-card" href="#/sell">
        <span class="hint-k">No sales yet</span>
        <span class="hint-v">Record your first sale to track revenue &amp; profit →</span>
      </a>` : ''}
  `;

  // ---- Period selector wiring: re-render just the performance body on change ----
  const $ = (s) => root.querySelector(s);
  const redrawPerf = () => { $('#perf-body').innerHTML = perfBody(rangeFor(period, cStart, cEnd)); };
  root.querySelectorAll('.perf-seg .seg-btn').forEach((b) => {
    b.onclick = () => {
      period = b.getAttribute('data-p');
      root.querySelectorAll('.perf-seg .seg-btn').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      $('#perf-custom').hidden = period !== 'custom';
      ctx.store.setSettings({ dash_period: period }); // remember for next visit
      redrawPerf();
    };
  });
  const cs = $('#c-start'); const ce = $('#c-end');
  if (cs) cs.oninput = () => { cStart = cs.value || cStart; redrawPerf(); };
  if (ce) ce.oninput = () => { cEnd = ce.value || cEnd; redrawPerf(); };
}
