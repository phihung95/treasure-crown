import { expensesTotalCents, expensesByCategoryCents } from '../../core/cash.js';
import { dollarsToCents, formatCents } from '../format.js';
import { showNames } from '../../data/shownames.js';

const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Expense categories a card/collectibles vendor actually runs into.
const CATS = [
  ['booth', 'Table / booth fee'],
  ['supplies', 'Supplies (sleeves, toploaders…)'],
  ['filament', '3D filament / printing'],
  ['grading', 'Grading (PSA/CGC)'],
  ['shipping', 'Shipping / postage'],
  ['travel', 'Travel / gas / parking'],
  ['fees', 'Platform / processing fees'],
  ['other', 'Other'],
];
const catLabelE = (c) => (CATS.find((x) => x[0] === c) || [null, c || 'Other'])[1];
const PERIODS = [['week', '7d'], ['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']];

async function saveExpense(ctx, row) {
  await ctx.store.put('expenses', row);
  await ctx.sync.enqueue({ kind: 'put', tab: 'expenses', row });
  await ctx.syncNow();
}

export async function render(root, ctx) {
  await ctx.reconcile();
  const [expenses, events] = await Promise.all([
    ctx.store.getAll('expenses'), showNames(ctx.store, ctx.settings),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  let period = PERIODS.some(([k]) => k === ctx.settings.exp_period) ? ctx.settings.exp_period : 'month';
  let cStart = `${today.slice(0, 8)}01`;
  let cEnd = today;
  let catFilter = null;   // tap a category to narrow the list
  let editingId = null;   // expense currently being edited inline

  const rangeFor = () => {
    switch (period) {
      case 'week': return { start: daysAgo(6), end: today, label: 'Last 7 days' };
      case 'year': return { start: `${today.slice(0, 4)}-01-01`, end: today, label: 'This year' };
      case 'all': return { start: '0000-01-01', end: '9999-12-31', label: 'All time' };
      case 'custom': return { start: cStart, end: cEnd, label: 'Custom range' };
      case 'month': default: return { start: `${today.slice(0, 8)}01`, end: today, label: 'This month' };
    }
  };
  const inRange = (e, r) => { const d = e.date || ''; return d >= r.start && d <= r.end; };

  root.innerHTML = `
    <div class="dash-head"><h1>Expenses</h1></div>

    <div class="card">
      <h1 style="font-size:16px">Add expense</h1>
      <label>Amount $</label>
      <input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off" />
      <div class="row">
        <div><label>Category</label><select id="cat">${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div><label>Date</label><input id="date" type="date" value="${today}" max="${today}" /></div>
      </div>
      <label>Source / event (optional)</label>
      <input id="event" list="ev-expenses" placeholder="Show, Facebook Marketplace…" autocomplete="off" />
      <datalist id="ev-expenses">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
      <label>Note (optional)</label>
      <input id="note" placeholder="e.g. table fee · 500 sleeves" autocomplete="off" />
      <button class="btn" id="add">Add expense</button>
      <p class="muted" style="margin-top:8px">Money spent running the business. Expenses lower your Business Value on Home.</p>
    </div>

    <div class="seg perf-seg" role="tablist" aria-label="Time range">
      ${PERIODS.map(([k, l]) => `<button class="seg-btn ${k === period ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
    </div>
    <div class="perf-custom" id="exp-custom" ${period === 'custom' ? '' : 'hidden'} style="margin-top:11px">
      <div><label>From</label><input type="date" id="c-start" value="${cStart}" max="${today}" /></div>
      <div><label>To</label><input type="date" id="c-end" value="${cEnd}" max="${today}" /></div>
    </div>

    <div id="exp-body"></div>
  `;

  const $ = (s) => root.querySelector(s);

  const renderBody = () => {
    const r = rangeFor();
    const inWindow = expenses.filter((e) => inRange(e, r));
    const total = expensesTotalCents(inWindow);
    const byCat = expensesByCategoryCents(inWindow);
    const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    const maxCat = cats.length ? byCat[cats[0]] : 0;
    // Day span for a rough daily average (only meaningful for bounded windows).
    const days = period === 'all' ? 0 : Math.max(1, Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000) + 1);
    const listed = inWindow
      .filter((e) => !catFilter || (e.category || 'other') === catFilter)
      .sort((a, b) => String(`${b.date}${b.expense_id}`).localeCompare(String(`${a.date}${a.expense_id}`)));

    $('#exp-body').innerHTML = `
      <section class="hero">
        <div class="hero-top"><span class="hero-label">Spent · ${esc(r.label)}</span>${CROWN}</div>
        <div class="hero-amount">${formatCents(total)}</div>
        <div class="hero-sub"><span>${inWindow.length} entr${inWindow.length === 1 ? 'y' : 'ies'}</span>${days ? `<span class="dot">•</span><span>${formatCents(Math.round(total / days))}/day avg</span>` : ''}</div>
      </section>

      ${cats.length ? `<section class="panel">
        <div class="panel-h">By category</div>
        ${cats.map((c) => {
          const pct = total ? Math.round((byCat[c] / total) * 100) : 0;
          const w = maxCat ? Math.round((byCat[c] / maxCat) * 100) : 0;
          return `<div class="exp-cat ${catFilter === c ? 'on' : ''}" data-cat="${c}" role="button" tabindex="0">
            <div class="exp-cat-row"><span>${catLabelE(c)}</span><span class="exp-cat-amt">${formatCents(byCat[c])} · ${pct}%</span></div>
            <div class="exp-bar"><div class="exp-bar-fill" style="width:${w}%"></div></div>
          </div>`;
        }).join('')}
      </section>` : ''}

      <section class="panel">
        <div class="panel-h"><span>Recent${catFilter ? ` · ${catLabelE(catFilter)}` : ''}</span>${catFilter ? '<button class="btn ghost" id="clear-cat" style="width:auto;margin:0;padding:4px 10px;font-size:12px">✕ clear</button>' : ''}</div>
        ${listed.length ? listed.map((e) => (e.expense_id === editingId ? editRow(e) : viewRow(e))).join('') : '<p class="muted">No expenses in this window.</p>'}
      </section>
    `;
    wireBody();
  };

  const viewRow = (e) => `
    <div class="sale-row">
      <div class="sale-main">
        <div class="sale-name">${formatCents(e.amount_cents)} · ${catLabelE(e.category)}</div>
        <div class="muted">${esc(e.date || '')}${e.event ? ` · ${esc(e.event)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
      </div>
      <span class="row-actions">
        <button class="btn ghost row-btn" data-edit="${esc(e.expense_id)}" aria-label="edit">✎</button>
        <button class="btn ghost row-btn" data-del="${esc(e.expense_id)}" aria-label="delete">✕</button>
      </span>
    </div>`;

  const editRow = (e) => `
    <div class="sale-row editing"><div class="edit-grid" style="width:100%">
      <div class="row">
        <div><label>Amount $</label><input class="e-amt" inputmode="decimal" value="${(e.amount_cents / 100).toFixed(2)}" /></div>
        <div><label>Date</label><input class="e-date" type="date" value="${esc(e.date || today)}" max="${today}" /></div>
      </div>
      <label>Category</label>
      <select class="e-cat">${CATS.map(([v, l]) => `<option value="${v}" ${v === e.category ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Source / event</label>
      <input class="e-event" list="ev-expenses" value="${esc(e.event || '')}" />
      <label>Note</label>
      <input class="e-note" value="${esc(e.note || '')}" />
      <div class="row" style="margin-top:8px">
        <button class="btn e-save" data-save="${esc(e.expense_id)}" style="margin:0">Save</button>
        <button class="btn ghost e-cancel" style="margin:0">Cancel</button>
      </div>
    </div></div>`;

  const wireBody = () => {
    root.querySelectorAll('[data-cat]').forEach((el) => {
      const toggle = () => { catFilter = catFilter === el.getAttribute('data-cat') ? null : el.getAttribute('data-cat'); renderBody(); };
      el.onclick = toggle;
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } };
    });
    const clr = $('#clear-cat'); if (clr) clr.onclick = () => { catFilter = null; renderBody(); };
    root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editingId = b.getAttribute('data-edit'); renderBody(); }; });
    root.querySelectorAll('.e-cancel').forEach((b) => { b.onclick = () => { editingId = null; renderBody(); }; });
    root.querySelectorAll('[data-save]').forEach((b) => { b.onclick = async () => {
      const wrap = b.closest('.edit-grid');
      const amount = dollarsToCents(wrap.querySelector('.e-amt').value);
      if (amount <= 0) { ctx.toast('Enter an amount'); return; }
      const orig = expenses.find((x) => x.expense_id === b.getAttribute('data-save'));
      const updated = { ...orig, amount_cents: amount, date: wrap.querySelector('.e-date').value || orig.date, category: wrap.querySelector('.e-cat').value, event: wrap.querySelector('.e-event').value.trim(), note: wrap.querySelector('.e-note').value.trim() };
      Object.assign(orig, updated); // keep the loaded array in sync so re-render shows it
      await saveExpense(ctx, updated);
      editingId = null;
      ctx.toast('Expense updated');
      renderBody();
    }; });
    root.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
      if (!b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = '✕?'; b.classList.add('danger');
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = '✕'; b.classList.remove('danger'); } }, 3000);
        return;
      }
      const id = b.getAttribute('data-del');
      const at = expenses.findIndex((x) => x.expense_id === id);
      if (at >= 0) expenses.splice(at, 1);
      await ctx.store.remove('expenses', id);
      await ctx.sync.enqueue({ kind: 'delete', tab: 'expenses', id });
      await ctx.syncNow();
      renderBody();
    }; });
  };

  // ---- static handlers: add form + period selector ----
  $('#add').onclick = async () => {
    const amount = dollarsToCents($('#amt').value);
    if (amount <= 0) { ctx.toast('Enter an amount'); return; }
    const ids = await ctx.sync.makeIds();
    const row = { expense_id: ids.expense(), date: $('#date').value || today, amount_cents: amount, category: $('#cat').value, note: $('#note').value.trim(), event: $('#event').value.trim() };
    expenses.push(row);
    await saveExpense(ctx, row);
    await ctx.sync.commitIds();
    $('#amt').value = ''; $('#note').value = '';
    ctx.toast('Expense added');
    renderBody();
  };
  $('#amt').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#add').click(); });

  root.querySelectorAll('.perf-seg .seg-btn').forEach((b) => {
    b.onclick = () => {
      period = b.getAttribute('data-p');
      root.querySelectorAll('.perf-seg .seg-btn').forEach((x) => x.classList.toggle('on', x === b));
      $('#exp-custom').hidden = period !== 'custom';
      ctx.store.setSettings({ exp_period: period });
      renderBody();
    };
  });
  const cs = $('#c-start'); const ce = $('#c-end');
  if (cs) cs.oninput = () => { cStart = cs.value || cStart; renderBody(); };
  if (ce) ce.oninput = () => { cEnd = ce.value || cEnd; renderBody(); };

  renderBody();
}
