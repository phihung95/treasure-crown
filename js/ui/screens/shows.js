import { reportByShow } from '../../core/shows.js';
import { transactionCashCents } from '../../core/cash.js';
import { dollarsToCents, formatCents, payLabel } from '../format.js';
import { sourceType, sourceTypeLabel, hasCashDrawer, SOURCE_TYPES } from '../../data/sources.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;
const PERIODS = [['all', 'All'], ['month', 'Month'], ['week', '7d'], ['custom', 'Custom']];
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function signed(cents) { return `${cents >= 0 ? '+' : ''}${formatCents(cents)}`; }
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
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  let settings = ctx.settings;
  let period = 'all';
  let query = '';
  let typeFilter = 'all';
  let cStart = `${today.slice(0, 8)}01`;
  let cEnd = today;
  let selected = null;

  // Persist a source's type (show / online / …) and re-render its detail.
  const setType = async (name, type) => {
    await ctx.store.setSettings({ source_types: { ...(settings.source_types || {}), [name]: type } });
    settings = await ctx.reloadSettings();
    drawDetail();
  };

  // Which date window the filter is showing (null = all time).
  const rangeFor = () => {
    switch (period) {
      case 'month': return { start: `${today.slice(0, 8)}01`, end: today };
      case 'week': return { start: daysAgo(6), end: today };
      case 'custom': return { start: cStart, end: cEnd };
      default: return null;
    }
  };
  // Scope the raw records to the window, then re-aggregate — so a show's totals
  // reflect only the activity inside the chosen range (consistent with Home).
  const filteredData = () => {
    const r = rangeFor();
    if (!r) return { sales, purchases, trades };
    const inR = (d) => d && d >= r.start && d <= r.end;
    return { sales: sales.filter((s) => inR(s.date)), purchases: purchases.filter((p) => inR(p.date)), trades: trades.filter((t) => inR(t.date)) };
  };

  const totalCard = (rows) => {
    const t = rows.reduce((acc, r) => {
      acc.value_added += r.value_added_cents; acc.sale_profit += r.sold.profit_cents;
      acc.units += r.sold.units; acc.revenue += r.sold.revenue_cents;
      acc.bought += r.bought.items; acc.spent += r.bought.spent_cents; acc.net_cash += r.net_cash_cents;
      return acc;
    }, { value_added: 0, sale_profit: 0, units: 0, revenue: 0, bought: 0, spent: 0, net_cash: 0 });
    return `<div class="card show-total">
      <div class="show-head"><span class="show-name">${period === 'all' && typeFilter === 'all' && !query ? 'All sources' : 'Filtered'}</span><span class="show-date">${rows.length} source${rows.length === 1 ? '' : 's'}</span></div>
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
  };

  const showCard = (r) => {
    const type = sourceType(r.event, settings);
    return `
    <div class="card show-card" data-show="${esc(r.event)}" role="button" tabindex="0">
      <div class="show-head"><span class="show-name">${esc(r.event)} <span class="chip src-chip src-${type}">${sourceTypeLabel(type)}</span></span><span class="show-date">${dateRange(r.first_date, r.last_date)}</span></div>
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
    </div>`;
  };

  const renderBody = () => {
    const body = root.querySelector('#shows-body');
    if (!body) return;
    const rows = reportByShow(filteredData())
      .filter((r) => !query || r.event.toLowerCase().includes(query))
      .filter((r) => typeFilter === 'all' || sourceType(r.event, settings) === typeFilter);
    if (!rows.length) {
      const narrowed = query || period !== 'all' || typeFilter !== 'all';
      body.innerHTML = `<div class="card empty">${CROWN}<h2>${narrowed ? 'No sources match' : 'No sources yet'}</h2>
        <p>${narrowed ? 'Try a different search, type, or time range.' : 'Tag your buys, sales, and trades with a source and each one gets summarized here.'}</p></div>`;
      return;
    }
    body.innerHTML = totalCard(rows) + rows.map(showCard).join('');
    body.querySelectorAll('[data-show]').forEach((el) => {
      const open = () => { selected = el.getAttribute('data-show'); drawDetail(); };
      el.onclick = open;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  };

  const drawList = () => {
    root.innerHTML = `<h1>Sources</h1>
      <div class="card shows-filter">
        <input id="show-q" placeholder="Search sources…" value="${esc(query)}" autocomplete="off" />
        <div class="seg perf-seg" role="tablist" aria-label="Time range">
          ${PERIODS.map(([k, l]) => `<button class="seg-btn ${k === period ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
        </div>
        <select id="type-filter" aria-label="Source type">
          <option value="all" ${typeFilter === 'all' ? 'selected' : ''}>All types</option>
          ${SOURCE_TYPES.map(([k, l]) => `<option value="${k}" ${typeFilter === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <div class="perf-custom" id="show-custom" ${period === 'custom' ? '' : 'hidden'}>
          <div><label>From</label><input type="date" id="c-start" value="${cStart}" max="${today}" /></div>
          <div><label>To</label><input type="date" id="c-end" value="${cEnd}" max="${today}" /></div>
        </div>
      </div>
      <div id="shows-body"></div>`;
    const $ = (s) => root.querySelector(s);
    const q = $('#show-q');
    q.oninput = () => { query = q.value.trim().toLowerCase(); renderBody(); };
    $('#type-filter').onchange = (e) => { typeFilter = e.target.value; renderBody(); };
    root.querySelectorAll('.shows-filter .seg-btn').forEach((b) => {
      b.onclick = () => {
        period = b.getAttribute('data-p');
        root.querySelectorAll('.shows-filter .seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        $('#show-custom').hidden = period !== 'custom';
        renderBody();
      };
    });
    const cs = $('#c-start'); const ce = $('#c-end');
    if (cs) cs.oninput = () => { cStart = cs.value || cStart; renderBody(); };
    if (ce) ce.oninput = () => { cEnd = ce.value || cEnd; renderBody(); };
    renderBody();
  };

  // Rename a show everywhere: retag every sale, purchase, and trade, then fix the
  // saved show list and the active show. Mutates the loaded arrays in place so the
  // re-aggregated detail shows the new name immediately.
  const renameShow = async (oldName, newName) => {
    const nn = newName.trim();
    if (!nn || nn === oldName) { selected = nn || oldName; drawDetail(); return; }
    const bump = async (tab, arr) => {
      for (const row of arr) {
        if (row.event !== oldName) continue;
        row.event = nn;
        await ctx.store.put(tab, row);
        await ctx.sync.enqueue({ kind: 'put', tab, row });
      }
    };
    await bump('sales', sales);
    await bump('purchases', purchases);
    await bump('trades', trades);
    const evs = [...new Set((ctx.settings.events || []).map((e) => (e === oldName ? nn : e)))];
    const patch = { events: evs };
    if (ctx.settings.current_show === oldName) patch.current_show = nn;
    await ctx.store.setSettings(patch);
    await ctx.reloadSettings();
    ctx.syncNow();
    selected = nn;
    ctx.toast('Show renamed');
    drawDetail();
  };

  const drawDetail = () => {
    const data = filteredData();
    const r = reportByShow(data).find((x) => x.event === selected);
    if (!r) { selected = null; drawList(); return; }
    const type = sourceType(r.event, settings);
    const tradeCashNet = r.traded.cash_in_cents - r.traded.cash_out_cents;
    const pays = Object.keys(r.by_payment);
    const showCashNet = transactionCashCents(data, r.event); // physical cash movement this show
    const multi = r.days.length > 1;

    // Expandable per-day breakdown: each day opens to the actual cards sold/bought.
    const dayBlocks = r.days.map((d, i) => {
      const soldLines = data.sales.filter((s) => s.event === r.event && s.date === d.date && s.type === 'sale');
      const boughtLots = data.purchases.filter((p) => p.event === r.event && p.date === d.date);
      const dayTrades = data.trades.filter((t) => t.event === r.event && t.date === d.date);
      const sec = (title, rowsHtml) => (rowsHtml ? `<div class="day-sec">${title}</div>${rowsHtml}` : '');
      const detail = [
        sec('Sold', soldLines.map((s) => `<div class="day-line"><span>${esc(s.item_name || '—')}${s.quantity > 1 ? ` ×${s.quantity}` : ''}${s.channel === 'dice' ? ' <span class="chip">🎲</span>' : ''}</span><span>${formatCents(s.revenue_cents)} · <span class="${s.profit_cents >= 0 ? 'pos' : 'neg'}">${signed(s.profit_cents)}</span></span></div>`).join('')),
        sec('Bought', boughtLots.map((p) => `<div class="day-line"><span>${p.item_count} card${p.item_count === 1 ? '' : 's'}${p.notes ? ` <span class="muted">· ${esc(String(p.notes).split('·')[0].trim())}</span>` : ''}</span><span>${formatCents(p.lot_total_cents)}</span></div>`).join('')),
        sec('Trades', dayTrades.map((t) => `<div class="day-line"><span>Trade${t.cash_cents ? ` · ${t.cash_direction === 'i_pay' ? 'paid' : 'took'} ${formatCents(t.cash_cents)}` : ''}</span><span class="${t.trade_profit_cents >= 0 ? 'pos' : 'neg'}">${signed(t.trade_profit_cents)}</span></div>`).join('')),
      ].join('');
      return `<div class="day-block">
        <button class="day-head" data-day="${i}" aria-expanded="false">
          <span class="day-title">${multi ? `Day ${i + 1} · ` : ''}${fmtDate(d.date)}</span>
          <span class="day-sum">${d.sold.units} sold${d.bought.items ? ` · ${d.bought.items} bought` : ''} · <b class="${d.value_added_cents >= 0 ? 'pos' : 'neg'}">${formatCents(d.value_added_cents)}</b> <span class="day-caret">▸</span></span>
        </button>
        <div class="day-detail" hidden>${detail || '<div class="day-line muted">No line items recorded.</div>'}</div>
      </div>`;
    }).join('');

    root.innerHTML = `
      <button class="btn ghost back-btn" id="back">← All sources</button>
      <div class="show-detail-h">
        <div class="sd-title-row">
          <h1 id="sd-title">${esc(r.event)}</h1>
          <button class="btn ghost sd-edit" id="rename-btn" aria-label="Rename source">✎</button>
        </div>
        <div class="src-type-row">
          <span class="muted">${dateRange(r.first_date, r.last_date)}</span>
          <label class="src-type-pick">Type
            <select id="src-type">${SOURCE_TYPES.map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
        </div>
      </div>

      <section class="hero">
        <div class="hero-top"><span class="hero-label">Value added this show</span>${CROWN}</div>
        <div class="hero-amount ${r.value_added_cents >= 0 ? '' : 'is-neg'}">${formatCents(r.value_added_cents)}</div>
        <div class="hero-sub"><span>${formatCents(r.sold.profit_cents)} sold profit · ${formatCents(r.bought.gain_cents)} buy gain${r.traded.count ? ` · ${formatCents(r.traded.profit_cents)} trade` : ''}</span></div>
      </section>

      <div class="card">
        <div class="dl dl-h"><span>${multi ? 'By day' : 'What sold &amp; bought'}</span><span class="muted">tap to expand</span></div>
        ${dayBlocks}
      </div>

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

      ${hasCashDrawer(type) ? `<div class="card">
        <div class="dl dl-h"><span>💵 Cash drawer</span><span class="muted">count &amp; reconcile</span></div>
        <div class="dl"><span>Started with</span><span class="cur-in">$ <input id="cd-start" inputmode="decimal" value="0.00" aria-label="started with" /></span></div>
        <div class="dl"><span>Cash in/out this show</span><span class="${showCashNet >= 0 ? 'pos' : 'neg'}">${showCashNet >= 0 ? '+' : ''}${formatCents(showCashNet)}</span></div>
        <div class="dl"><span>Should be in the box</span><span id="cd-expected"><b>${formatCents(showCashNet)}</b></span></div>
        <div class="dl"><span>Counted</span><span class="cur-in">$ <input id="cd-count" inputmode="decimal" placeholder="0.00" aria-label="counted" /></span></div>
        <div class="dl"><span>Difference</span><span id="cd-diff" class="muted">—</span></div>
      </div>` : ''}
    `;

    // Change this source's type (show / online / …).
    root.querySelector('#src-type').onchange = (e) => setType(r.event, e.target.value);

    // Inline rename: swap the title for an input, then retag every record on save.
    root.querySelector('#rename-btn').onclick = () => {
      const row = root.querySelector('.sd-title-row');
      row.innerHTML = `<input id="rename-in" class="sd-rename-in" value="${esc(r.event)}" aria-label="Show name" />
        <div class="sd-rename-actions">
          <button class="btn" id="rename-save" style="width:auto;margin:0">Save</button>
          <button class="btn ghost" id="rename-cancel" style="width:auto;margin:0">Cancel</button>
        </div>`;
      const inp = root.querySelector('#rename-in');
      inp.focus(); inp.select();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#rename-save').click(); if (e.key === 'Escape') drawDetail(); });
      root.querySelector('#rename-save').onclick = async () => {
        const nn = inp.value.trim();
        if (!nn) { ctx.toast('Name required'); return; }
        root.querySelector('#rename-save').disabled = true;
        await renameShow(r.event, nn);
      };
      root.querySelector('#rename-cancel').onclick = () => drawDetail();
    };

    // Expand/collapse each day's line items.
    root.querySelectorAll('.day-head').forEach((b) => {
      b.onclick = () => {
        const d = b.nextElementSibling;
        const opening = d.hasAttribute('hidden');
        if (opening) { d.removeAttribute('hidden'); b.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
        else { d.setAttribute('hidden', ''); b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); }
      };
    });

    // Live cash-drawer reconcile (in-person shows only): expected = started + net
    // cash movement; diff = counted − expected.
    const cdStart = root.querySelector('#cd-start');
    const cdCount = root.querySelector('#cd-count');
    if (cdStart && cdCount) {
      const cdRecalc = () => {
        const start = dollarsToCents(cdStart.value);
        const expected = start + showCashNet;
        root.querySelector('#cd-expected').innerHTML = `<b>${formatCents(expected)}</b>`;
        const diffEl = root.querySelector('#cd-diff');
        if (cdCount.value.trim() === '') { diffEl.textContent = '—'; diffEl.className = 'muted'; return; }
        const diff = dollarsToCents(cdCount.value) - expected;
        diffEl.innerHTML = `<b>${diff >= 0 ? '+' : ''}${formatCents(diff)}</b>${diff === 0 ? ' ✓' : ' ⚠'}`;
        diffEl.className = diff === 0 ? 'pos' : 'neg';
      };
      cdStart.addEventListener('input', cdRecalc);
      cdCount.addEventListener('input', cdRecalc);
    }

    root.querySelector('#back').onclick = () => { selected = null; drawList(); };
  };

  drawList();
}
