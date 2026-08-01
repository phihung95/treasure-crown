import { aggregate } from '../../core/dashboard.js';
import { formatCents, catLabel } from '../format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  return `${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
function periodNoun(p) { return p === 'day' ? 'day' : p === 'month' ? 'month' : 'show'; }
function signed(cents) { return `${cents >= 0 ? '+' : ''}${formatCents(cents)}`; }

// A short, human descriptor for an item — set + card number, or grade for slabs.
function itemMeta(it) {
  if (it.category === 'slab') {
    const grade = (it.grade || '').trim();
    const grader = (it.grader || '').trim();
    // The grade often already carries the company (e.g. "PSA 10") — don't repeat it.
    if (grade && grader && !grade.toLowerCase().includes(grader.toLowerCase())) return `${grader} ${grade}`;
    return grade || grader || 'Graded';
  }
  return [it.set, it.card_number ? `#${it.card_number}` : ''].filter(Boolean).join(' ');
}

export async function render(root, ctx) {
  const sales = await ctx.store.getAll('sales');
  const items = await ctx.store.getAll('items');
  let period = 'show';

  const emptyState = () => `
    <div class="dash-head"><h1>Home</h1></div>
    <div class="card empty">
      ${CROWN}
      <h2>Your treasury is empty</h2>
      <p>Add inventory or log your first sale — your business value, profit, and holdings show up here.</p>
      <div class="empty-actions">
        <a class="btn" href="#/buy">Add a buy</a>
        <a class="btn secondary" href="#/sell">Record a sale</a>
      </div>
    </div>`;

  const draw = () => {
    const a = aggregate({ sales, items, period });

    // ---- inventory truth (works with zero sales) ----
    const active = items.filter((it) => it.quantity_on_hand > 0);
    const itemCount = active.length;
    const unitCount = active.reduce((s, it) => s + it.quantity_on_hand, 0);
    const invCost = a.inventory.cost_cents;
    const invMkt = a.inventory.market_cents;
    const invGain = invMkt - invCost;
    const invPct = invCost > 0 ? Math.round((invGain / invCost) * 100) : 0;

    // ---- realized performance (from sales) ----
    const saleRows = sales.filter((s) => s.type === 'sale');
    const realizedRevenue = saleRows.reduce((s, r) => s + (r.revenue_cents || 0), 0);
    const realizedProfit = sales.reduce((s, r) => s + (r.profit_cents || 0), 0);
    const hasSales = sales.length > 0;

    // Nothing at all -> a real first-run screen.
    if (itemCount === 0 && !hasSales) { root.innerHTML = emptyState(); wire(); return; }

    // ---- sales-by-period buckets (most recent first) ----
    const allKeys = Object.keys({ ...a.revenueByKey, ...a.profitByKey });
    const keyDate = {};
    for (const s of sales) {
      if (s.type !== 'sale' && s.type !== 'trade_give') continue;
      const k = period === 'show' ? (s.event || '(no show)') : (period === 'month' ? String(s.date).slice(0, 7) : s.date);
      if (!keyDate[k] || s.date > keyDate[k]) keyDate[k] = s.date;
    }
    const keys = allKeys.sort((x, y) => (keyDate[y] || '').localeCompare(keyDate[x] || '') || y.localeCompare(x));
    const noun = periodNoun(period);

    // ---- top holdings by total market value ----
    const top = [...active]
      .map((it) => ({ it, total: it.quantity_on_hand * it.market_value_cents }))
      .sort((p, q) => q.total - p.total)
      .slice(0, 5);

    // ---- inventory by category (only cats that hold stock) ----
    const catRows = Object.keys(a.byCategory)
      .map((c) => ({ c, v: a.byCategory[c] }))
      .filter((r) => r.v.inventory_market_cents > 0)
      .sort((p, q) => q.v.inventory_market_cents - p.v.inventory_market_cents);

    root.innerHTML = `
      <div class="dash-head">
        <h1>Home</h1>
        ${hasSales ? `<div class="seg" role="tablist" aria-label="Time period">
          ${['day', 'show', 'month'].map((p) => `<button class="seg-btn ${p === period ? 'on' : ''}" data-p="${p}" role="tab" aria-selected="${p === period}">${p}</button>`).join('')}
        </div>` : ''}
      </div>

      <section class="hero">
        <div class="hero-top">
          <span class="hero-label">Business value · at market</span>
          ${CROWN}
        </div>
        <div class="hero-amount">${formatCents(invMkt)}</div>
        <div class="hero-sub">
          <span>${itemCount} item${itemCount === 1 ? '' : 's'} · ${unitCount} unit${unitCount === 1 ? '' : 's'}</span>
          <span class="dot">•</span>
          <span class="hero-gain ${invGain >= 0 ? 'pos' : 'neg'}">${signed(invGain)} (${invPct}%) over cost</span>
        </div>
      </section>

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

      ${hasSales ? `<section class="panel">
        <div class="panel-h">Revenue &amp; profit by ${noun}</div>
        <div class="tbl by-period">
          <div class="thd"><span>${noun[0].toUpperCase() + noun.slice(1)}</span><span class="num">Revenue</span><span class="num">Profit</span></div>
          ${keys.map((k) => {
            const rev = a.revenueByKey[k] || 0; const pf = a.profitByKey[k] || 0;
            return `<div class="trow">
              <span class="tname">${esc(k)}</span>
              <span class="num">${formatCents(rev)}</span>
              <span class="num ${pf >= 0 ? 'pos' : 'neg'}">${formatCents(pf)}</span>
            </div>`;
          }).join('')}
        </div>
      </section>` : `<a class="hint-card" href="#/sell">
          <span class="hint-k">No sales yet</span>
          <span class="hint-v">Record your first sale to track revenue &amp; profit →</span>
        </a>`}
    `;
    wire();
  };

  const wire = () => {
    root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { period = b.getAttribute('data-p'); draw(); }; });
  };

  draw();
}
