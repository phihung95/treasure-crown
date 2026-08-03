import { reportByShow } from '../../core/shows.js';
import { formatCents, payLabel } from '../format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}` : '';
}
function dateRange(a, b) {
  if (!a && !b) return '';
  if (!b || a === b) return fmtDate(a);
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${fmtDate(a).split(' ')[0]} ${+a.slice(8, 10)}–${+b.slice(8, 10)}` : `${fmtDate(a)} – ${fmtDate(b)}`;
}

export async function render(root, ctx) {
  await ctx.reconcile(); // pull the latest from all devices so the report is current
  const [sales, purchases, trades] = await Promise.all([
    ctx.store.getAll('sales'), ctx.store.getAll('purchases'), ctx.store.getAll('trades'),
  ]);
  const rows = reportByShow({ sales, purchases, trades });
  let selected = null;

  const drawList = () => {
    if (!rows.length) {
      root.innerHTML = `<h1>Shows</h1>
        <div class="card empty">${CROWN}<h2>No shows yet</h2>
        <p>Tag your buys, sales, and trades with a show and each one gets summarized here.</p></div>`;
      return;
    }
    // Grand total across every show.
    const t = rows.reduce((acc, r) => {
      acc.value_added += r.value_added_cents;
      acc.sale_profit += r.sold.profit_cents;
      acc.units += r.sold.units;
      acc.revenue += r.sold.revenue_cents;
      acc.bought += r.bought.items;
      acc.spent += r.bought.spent_cents;
      acc.net_cash += r.net_cash_cents;
      return acc;
    }, { value_added: 0, sale_profit: 0, units: 0, revenue: 0, bought: 0, spent: 0, net_cash: 0 });
    const totalCard = `<div class="card show-total">
      <div class="show-head"><span class="show-name">All shows</span><span class="show-date">${rows.length} show${rows.length === 1 ? '' : 's'}</span></div>
      <div class="show-metrics">
        <div class="show-metric ${t.value_added >= 0 ? 'pos' : 'neg'}"><span class="show-metric-v">${formatCents(t.value_added)}</span><span class="show-metric-k">value added</span></div>
        <div class="show-metric ${t.sale_profit >= 0 ? 'pos' : 'neg'}"><span class="show-metric-v">${formatCents(t.sale_profit)}</span><span class="show-metric-k">sale profit</span></div>
      </div>
      <div class="show-total-made"><span class="stm-k">Total made · net cash</span><span class="stm-v ${t.net_cash >= 0 ? 'pos' : 'neg'}">${formatCents(t.net_cash)}</span></div>
      <div class="show-stats">
        <span class="ss">Sold <b>${t.units}</b> · ${formatCents(t.revenue)}</span>
        <span class="ss">Bought <b>${t.bought}</b> · ${formatCents(t.spent)}</span>
      </div>
    </div>`;
    root.innerHTML = `<h1>Shows</h1>` + totalCard + rows.map((r) => `
      <div class="card show-card" data-show="${esc(r.event)}" role="button" tabindex="0">
        <div class="show-head"><span class="show-name">${esc(r.event)}</span><span class="show-date">${dateRange(r.first_date, r.last_date)}</span></div>
        <div class="show-metrics">
          <div class="show-metric ${r.value_added_cents >= 0 ? 'pos' : 'neg'}">
            <span class="show-metric-v">${formatCents(r.value_added_cents)}</span><span class="show-metric-k">value added</span></div>
          <div class="show-metric ${r.sold.profit_cents >= 0 ? 'pos' : 'neg'}">
            <span class="show-metric-v">${formatCents(r.sold.profit_cents)}</span><span class="show-metric-k">sale profit</span></div>
        </div>
        <div class="show-total-made"><span class="stm-k">Total made · net cash</span><span class="stm-v ${r.net_cash_cents >= 0 ? 'pos' : 'neg'}">${formatCents(r.net_cash_cents)}</span></div>
        <div class="show-stats">
          <span class="ss">Sold <b>${r.sold.units}</b> · ${formatCents(r.sold.revenue_cents)}</span>
          <span class="ss">Bought <b>${r.bought.items}</b> · ${formatCents(r.bought.spent_cents)}</span>
          ${r.traded.count ? `<span class="ss">Trades <b>${r.traded.count}</b></span>` : ''}
          ${r.dice.rolls ? `<span class="ss">🎲 <b>${r.dice.rolls}</b> · ${formatCents(r.dice.revenue_cents)}</span>` : ''}
        </div>
      </div>`).join('');
    root.querySelectorAll('[data-show]').forEach((el) => {
      const open = () => { selected = el.getAttribute('data-show'); drawDetail(); };
      el.onclick = open;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  };

  const drawDetail = () => {
    const r = rows.find((x) => x.event === selected);
    if (!r) { selected = null; drawList(); return; }
    const tradeCashNet = r.traded.cash_in_cents - r.traded.cash_out_cents;
    const pays = Object.keys(r.by_payment);
    root.innerHTML = `
      <button class="btn ghost back-btn" id="back">← All shows</button>
      <div class="show-detail-h"><h1>${esc(r.event)}</h1><div class="muted">${dateRange(r.first_date, r.last_date)}</div></div>

      <section class="hero">
        <div class="hero-top"><span class="hero-label">Value added this show</span>${CROWN}</div>
        <div class="hero-amount ${r.value_added_cents >= 0 ? '' : 'is-neg'}">${formatCents(r.value_added_cents)}</div>
        <div class="hero-sub"><span>${formatCents(r.sold.profit_cents)} sold profit · ${formatCents(r.bought.gain_cents)} buy gain${r.traded.count ? ` · ${formatCents(r.traded.profit_cents)} trade` : ''}</span></div>
      </section>

      ${r.days.length > 1 ? `<div class="card">
        <div class="dl dl-h"><span>By day</span><span class="muted">${r.days.length} days</span></div>
        ${r.days.map((d, i) => `<div class="dl">
          <span><b>Day ${i + 1}</b> · ${fmtDate(d.date)}${d.dice.rolls ? ` <span class="chip">🎲 ${d.dice.rolls}</span>` : ''}</span>
          <span>${d.sold.units} sold · ${formatCents(d.sold.revenue_cents)} · <span class="${d.value_added_cents >= 0 ? 'pos' : 'neg'}"><b>${formatCents(d.value_added_cents)}</b></span></span>
        </div>`).join('')}
      </div>` : ''}

      <div class="card">
        <div class="dl"><span>Sold</span><span><b>${r.sold.units}</b> cards · ${r.sold.lines} sale${r.sold.lines === 1 ? '' : 's'}</span></div>
        <div class="dl"><span>Revenue</span><span>${formatCents(r.sold.revenue_cents)}</span></div>
        <div class="dl"><span>Profit</span><span class="${r.sold.profit_cents >= 0 ? 'pos' : 'neg'}"><b>${formatCents(r.sold.profit_cents)}</b></span></div>
      </div>

      <div class="card">
        <div class="dl"><span>Bought / picked up</span><span><b>${r.bought.items}</b> item${r.bought.items === 1 ? '' : 's'}</span></div>
        <div class="dl"><span>Spent</span><span>${formatCents(r.bought.spent_cents)}</span></div>
        ${r.bought.market_cents > 0 ? `<div class="dl"><span>Market value picked up</span><span>${formatCents(r.bought.market_cents)}</span></div>
        <div class="dl"><span>Below-market gain</span><span class="${r.bought.gain_cents >= 0 ? 'pos' : 'neg'}"><b>${formatCents(r.bought.gain_cents)}</b></span></div>` : ''}
      </div>

      ${r.dice.rolls ? `<div class="card">
        <div class="dl dl-h"><span>🎲 Dice challenge</span><span></span></div>
        <div class="dl"><span>Rolls</span><span><b>${r.dice.rolls}</b> · ${formatCents(r.dice.revenue_cents)} taken</span></div>
        <div class="dl"><span>Prizes given (cost)</span><span>${formatCents(r.dice.cost_cents)}</span></div>
        <div class="dl"><span>Dice profit</span><span class="${r.dice.profit_cents >= 0 ? 'pos' : 'neg'}"><b>${formatCents(r.dice.profit_cents)}</b></span></div>
      </div>` : ''}

      ${r.traded.count ? `<div class="card">
        <div class="dl"><span>Trades</span><span><b>${r.traded.count}</b></span></div>
        <div class="dl"><span>Trade profit</span><span class="${r.traded.profit_cents >= 0 ? 'pos' : 'neg'}">${formatCents(r.traded.profit_cents)}</span></div>
        <div class="dl"><span>Cash in / out</span><span>${formatCents(r.traded.cash_in_cents)} / ${formatCents(r.traded.cash_out_cents)}</span></div>
      </div>` : ''}

      <div class="card">
        <div class="dl"><span>Net cash (in pocket)</span><span class="${r.net_cash_cents >= 0 ? '' : 'neg'}"><b>${formatCents(r.net_cash_cents)}</b></span></div>
        <div class="dl"><span>Cash in · out</span><span>${formatCents(r.sold.revenue_cents)} · ${formatCents(r.bought.spent_cents)}${tradeCashNet !== 0 ? ` · ${formatCents(tradeCashNet)} trade` : ''}</span></div>
      </div>

      ${pays.length ? `<div class="card">
        <div class="dl dl-h"><span>Payments taken</span><span></span></div>
        ${pays.map((p) => `<div class="dl"><span>${payLabel(p)}</span><span>${formatCents(r.by_payment[p])}</span></div>`).join('')}
      </div>` : ''}
    `;
    root.querySelector('#back').onclick = () => { selected = null; drawList(); };
  };

  drawList();
}
