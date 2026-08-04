import { expensesTotalCents, expensesByCategoryCents } from '../../core/cash.js';
import { dollarsToCents, formatCents } from '../format.js';
import { showNames } from '../../data/shownames.js';

const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
  const total = expensesTotalCents(expenses);
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const monthTotal = expensesTotalCents(expenses.filter((e) => (e.date || '').startsWith(month)));
  const byCat = expensesByCategoryCents(expenses);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);

  root.innerHTML = `
    <div class="dash-head"><h1>Expenses</h1></div>

    <section class="hero">
      <div class="hero-top"><span class="hero-label">Total expenses</span>${CROWN}</div>
      <div class="hero-amount">${formatCents(total)}</div>
      <div class="hero-sub"><span>${formatCents(monthTotal)} this month</span><span class="dot">•</span><span>${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}</span></div>
    </section>

    <div class="card">
      <h1 style="font-size:16px">Add expense</h1>
      <p class="muted" style="margin-bottom:8px">Booth fees, supplies, filament, shipping — money spent running the business. Expenses lower your Business Value on Home.</p>
      <label>Amount $</label>
      <input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off" />
      <div class="row">
        <div><label>Category</label><select id="cat">${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div><label>Date</label><input id="date" type="date" value="${today}" /></div>
      </div>
      <label>Show / event (optional)</label>
      <input id="event" list="ev-expenses" placeholder="Type a show name…" autocomplete="off" />
      <datalist id="ev-expenses">${events.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
      <label>Note (optional)</label>
      <input id="note" placeholder="e.g. table fee · 500 sleeves" autocomplete="off" />
      <button class="btn" id="add">Add expense</button>
    </div>

    ${cats.length ? `<section class="panel">
      <div class="panel-h">By category</div>
      <div class="tbl">
        ${cats.map((c) => `<div class="dl"><span>${catLabelE(c)}</span><span>${formatCents(byCat[c])}</span></div>`).join('')}
        <div class="dl dl-total"><span>Total</span><span>${formatCents(total)}</span></div>
      </div>
    </section>` : ''}

    <section class="panel">
      <div class="panel-h">Recent</div>
      ${expenses.length
        ? [...expenses].sort((a, b) => String(`${b.date}${b.expense_id}`).localeCompare(String(`${a.date}${a.expense_id}`))).slice(0, 30).map((e) => `
        <div class="sale-row">
          <div class="sale-main">
            <div class="sale-name">${formatCents(e.amount_cents)} · ${catLabelE(e.category)}</div>
            <div class="muted">${esc(e.date || '')}${e.event ? ` · ${esc(e.event)}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
          </div>
          <button class="btn ghost undo-btn" data-del="${esc(e.expense_id)}">Delete</button>
        </div>`).join('')
        : '<p class="muted">No expenses yet.</p>'}
    </section>
  `;

  const $ = (s) => root.querySelector(s);

  $('#add').onclick = async () => {
    const amount = dollarsToCents($('#amt').value);
    if (amount <= 0) { ctx.toast('Enter an amount'); return; }
    const ids = await ctx.sync.makeIds();
    await saveExpense(ctx, {
      expense_id: ids.expense(), date: $('#date').value || today,
      amount_cents: amount, category: $('#cat').value,
      note: $('#note').value.trim(), event: $('#event').value.trim(),
    });
    await ctx.sync.commitIds();
    ctx.toast('Expense added');
    ctx.refresh();
  };

  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('danger');
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000);
        return;
      }
      const id = b.getAttribute('data-del');
      await ctx.store.remove('expenses', id);
      await ctx.sync.enqueue({ kind: 'delete', tab: 'expenses', id });
      await ctx.syncNow();
      ctx.refresh();
    };
  });
}
