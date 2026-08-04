import { aggregate } from '../../core/dashboard.js';
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

export async function render(root, ctx) {
  await ctx.reconcile(); // pull the latest from all devices so the numbers are current
  const sales = await ctx.store.getAll('sales');
  const items = await ctx.store.getAll('items');
  const [purchases, trades, cashEvents, expenses] = await Promise.all([
    ctx.store.getAll('purchases'), ctx.store.getAll('trades'), ctx.store.getAll('cash_events'), ctx.store.getAll('expenses'),
  ]);
  const cashTx = transactionCashCents({ sales, purchases, trades });
  const cashManual = manualCashCents(cashEvents);
  const cashTotal = cashTx + cashManual;
  // Money the business holds across ALL payment methods (cash + Zelle + Cash App)
  // minus buys and expenses — so Business Value = inventory + money never drops
  // when you sell, but does drop when you spend on the business.
  const money = moneyHeldCents({ sales, purchases, trades, cashEvents, expenses });
  const settings = await ctx.reloadSettings();
  const currentShow = (settings.current_show || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  const a = aggregate({ sales, items, period: 'show' });
  const active = items.filter((it) => it.quantity_on_hand > 0);
  const itemCount = active.length;
  const unitCount = active.reduce((s, it) => s + it.quantity_on_hand, 0);
  const invCost = a.inventory.cost_cents;
  const invMkt = a.inventory.market_cents;
  const invGain = invMkt - invCost;
  const invPct = invCost > 0 ? Math.round((invGain / invCost) * 100) : 0;
  // Total business value = what the inventory is worth + the money made from it.
  // Selling moves value from the left column to the right, so the total holds.
  const bizValue = invMkt + money;

  const saleRows = sales.filter((s) => s.type === 'sale');
  const realizedRevenue = saleRows.reduce((s, r) => s + (r.revenue_cents || 0), 0);
  const realizedProfit = sales.reduce((s, r) => s + (r.profit_cents || 0), 0);
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

  // "Now at" the active show: today's activity for it.
  let showCard = '';
  if (currentShow) {
    const todayShow = saleRows.filter((s) => s.event === currentShow && s.date === today);
    const rev = todayShow.reduce((s, r) => s + (r.revenue_cents || 0), 0);
    const profit = todayShow.reduce((s, r) => s + (r.profit_cents || 0), 0);
    showCard = `<a class="show-hub" href="#/shows">
      <div class="show-hub-top"><span class="show-hub-k">Active show</span><span class="show-hub-go">Report →</span></div>
      <div class="show-hub-name">${esc(currentShow)}</div>
      <div class="show-hub-stats">Today: <b>${todayShow.length}</b> sold · ${formatCents(rev)}
        ${todayShow.length ? `· <span class="${profit >= 0 ? 'pos' : 'neg'}">${signed(profit)} profit</span>` : ''}</div>
    </a>`;
  }

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
        <span class="hb-part"><span class="hb-k">Cash &amp; sales</span><span class="hb-v ${money < 0 ? 'neg' : ''}">${signed(money)}</span></span>
      </div>
      <div class="hero-sub">
        <span>${itemCount} item${itemCount === 1 ? '' : 's'} · ${unitCount} unit${unitCount === 1 ? '' : 's'} · inventory at market</span>
      </div>
    </section>

    <nav class="hub-actions" aria-label="Quick actions">
      <a class="hub-btn" href="#/buy"><span class="hub-ic" aria-hidden="true">＋</span>Buy</a>
      <a class="hub-btn" href="#/sell"><span class="hub-ic" aria-hidden="true">＄</span>Sell</a>
      <a class="hub-btn" href="#/trade"><span class="hub-ic" aria-hidden="true">⇄</span>Trade</a>
    </nav>

    ${showCard}

    <a class="cash-card" href="#/cash">
      <span class="cash-card-k">💵 Cash on hand</span>
      <span class="cash-card-r"><span class="cash-card-v ${cashTotal < 0 ? 'neg' : ''}">${formatCents(cashTotal)}</span><span class="cash-card-go">Manage →</span></span>
    </a>

    <div class="stat-row">
      <div class="stat"><span class="stat-k">Cost basis</span><span class="stat-v">${formatCents(invCost)}</span></div>
      <div class="stat"><span class="stat-k">Unrealized</span><span class="stat-v ${invGain >= 0 ? 'pos' : 'neg'}">${signed(invGain)}</span></div>
      <div class="stat"><span class="stat-k">Sales revenue</span><span class="stat-v">${formatCents(realizedRevenue)}</span></div>
      <div class="stat"><span class="stat-k">Realized profit</span><span class="stat-v ${realizedProfit >= 0 ? 'pos' : 'neg'}">${hasSales ? signed(realizedProfit) : formatCents(0)}</span></div>
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
}
