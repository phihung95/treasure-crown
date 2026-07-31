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

export async function render(root, ctx) {
  const sales = await ctx.store.getAll('sales');
  const items = await ctx.store.getAll('items');
  let period = 'show';

  const emptyState = () => `
    <div class="dash-head"><h1>Home</h1></div>
    <div class="card empty">
      ${CROWN}
      <h2>Your treasury is empty</h2>
      <p>Log your first buy or sale and your revenue, profit, and inventory value show up here.</p>
      <div class="empty-actions">
        <a class="btn" href="#/buy">Add a buy</a>
        <a class="btn secondary" href="#/sell">Record a sale</a>
      </div>
    </div>`;

  const draw = () => {
    const a = aggregate({ sales, items, period });
    const allKeys = Object.keys({ ...a.revenueByKey, ...a.profitByKey });

    // most-recent-first: order buckets by the latest sale date they contain
    const keyDate = {};
    for (const s of sales) {
      if (s.type !== 'sale' && s.type !== 'trade_give') continue;
      const k = period === 'show' ? (s.event || '(no show)') : (period === 'month' ? String(s.date).slice(0, 7) : s.date);
      if (!keyDate[k] || s.date > keyDate[k]) keyDate[k] = s.date;
    }
    const keys = allKeys.sort((x, y) => (keyDate[y] || '').localeCompare(keyDate[x] || '') || y.localeCompare(x));

    if (keys.length === 0) { root.innerHTML = emptyState(); wire(); return; }

    const lead = keys[0];
    const leadPf = a.profitByKey[lead] || 0;
    const leadRev = a.revenueByKey[lead] || 0;
    const asOf = keyDate[lead];
    const noun = periodNoun(period);
    const bizGain = a.inventory.market_cents - a.inventory.cost_cents;
    const bizPct = a.inventory.cost_cents > 0 ? Math.round((bizGain / a.inventory.cost_cents) * 100) : 0;

    root.innerHTML = `
      <div class="dash-head">
        <h1>Home</h1>
        <div class="seg" role="tablist" aria-label="Time period">
          ${['day', 'show', 'month'].map((p) => `<button class="seg-btn ${p === period ? 'on' : ''}" data-p="${p}" role="tab" aria-selected="${p === period}">${p}</button>`).join('')}
        </div>
      </div>

      <section class="hero">
        <div class="hero-top">
          <span class="hero-label">${esc(lead)} · profit</span>
          ${CROWN}
        </div>
        <div class="hero-amount ${leadPf >= 0 ? '' : 'is-neg'}">${formatCents(leadPf)}</div>
        <div class="hero-sub">
          <span>${formatCents(leadRev)} revenue</span>
          <span class="dot">•</span>
          <span>as of ${fmtDate(asOf)}</span>
        </div>
      </section>

      <div class="biz-value">
        <div class="biz-row"><span class="biz-k">Business value</span><span class="biz-note">inventory at market</span></div>
        <div class="biz-v">${formatCents(a.inventory.market_cents)}</div>
        <div class="biz-foot"><span>cost ${formatCents(a.inventory.cost_cents)}</span>
          <span class="${bizGain >= 0 ? 'pos' : 'neg'}">${bizGain >= 0 ? '+' : ''}${formatCents(bizGain)} (${bizPct}%) over cost</span></div>
      </div>

      <section class="panel">
        <div class="panel-h">Revenue &amp; profit by ${noun}</div>
        <div class="tbl by-period">
          <div class="thd"><span>${noun[0].toUpperCase() + noun.slice(1)}</span><span class="num">Revenue</span><span class="num">Profit</span></div>
          ${keys.map((k) => {
            const rev = a.revenueByKey[k] || 0; const pf = a.profitByKey[k] || 0;
            return `<div class="trow ${k === lead ? 'lead' : ''}">
              <span class="tname">${esc(k)}</span>
              <span class="num">${formatCents(rev)}</span>
              <span class="num ${pf >= 0 ? 'pos' : 'neg'}">${formatCents(pf)}</span>
            </div>`;
          }).join('')}
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">By category</div>
        <div class="tbl by-cat">
          <div class="thd"><span>Category</span><span class="num">Revenue</span><span class="num">Profit</span></div>
          ${Object.keys(a.byCategory).map((c) => {
            const v = a.byCategory[c];
            return `<div class="trow">
              <span class="tname">${catLabel(c)}<span class="tsub">${formatCents(v.inventory_cost_cents)} in stock</span></span>
              <span class="num">${formatCents(v.revenue_cents)}</span>
              <span class="num ${v.profit_cents >= 0 ? 'pos' : 'neg'}">${formatCents(v.profit_cents)}</span>
            </div>`;
          }).join('')}
        </div>
      </section>
    `;
    wire();
  };

  const wire = () => {
    root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { period = b.getAttribute('data-p'); draw(); }; });
  };

  draw();
}
