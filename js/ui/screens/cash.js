import { transactionCashCents, manualCashCents } from '../../core/cash.js';
import { dollarsToCents, formatCents } from '../format.js';

const CROWN = `<svg class="crown-wm" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e6c565" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#e6c565" opacity=".85"/></svg>`;
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function saveEvent(ctx, row) {
  await ctx.store.put('cash_events', row);
  await ctx.sync.enqueue({ kind: 'put', tab: 'cash_events', row });
  await ctx.syncNow();
}

export async function render(root, ctx) {
  await ctx.reconcile();
  const [sales, purchases, trades, cashEvents] = await Promise.all([
    ctx.store.getAll('sales'), ctx.store.getAll('purchases'), ctx.store.getAll('trades'), ctx.store.getAll('cash_events'),
  ]);
  const txCash = transactionCashCents({ sales, purchases, trades });
  const manual = manualCashCents(cashEvents);
  const total = txCash + manual;
  const today = new Date().toISOString().slice(0, 10);

  root.innerHTML = `
    <div class="dash-head"><h1>Cash</h1></div>

    <section class="hero">
      <div class="hero-top"><span class="hero-label">Cash on hand</span>${CROWN}</div>
      <div class="hero-amount ${total < 0 ? 'is-neg' : ''}">${formatCents(total)}</div>
      <div class="hero-sub"><span>${formatCents(txCash)} tracked from cash sales/buys</span><span class="dot">•</span><span>${formatCents(manual)} your adjustments</span></div>
    </section>

    <div class="card">
      <h1 style="font-size:16px">Adjust cash</h1>
      <p class="muted" style="margin-bottom:8px">Cash sales &amp; cash buys count automatically. Use this to set your starting cash or record cash you add / take out (e.g. a bank deposit).</p>
      <label>Amount $</label>
      <input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off" />
      <label>Note (optional)</label>
      <input id="note" placeholder="e.g. starting float · bank deposit" autocomplete="off" />
      <button class="btn" id="setto">Set cash on hand to this amount</button>
      <div class="row">
        <button class="btn secondary" id="add">＋ Add cash</button>
        <button class="btn secondary" id="remove">－ Take out</button>
      </div>
    </div>

    <section class="panel">
      <div class="panel-h">Adjustments</div>
      ${cashEvents.length
        ? [...cashEvents].sort((a, b) => String(b.cash_id).localeCompare(String(a.cash_id))).map((ev) => `
        <div class="sale-row">
          <div class="sale-main">
            <div class="sale-name ${ev.kind === 'remove' ? 'neg' : 'pos'}">${ev.kind === 'remove' ? '−' : '+'}${formatCents(ev.amount_cents)}</div>
            <div class="muted">${esc(ev.date || '')}${ev.note ? ` · ${esc(ev.note)}` : ''}</div>
          </div>
          <button class="btn ghost undo-btn" data-del="${esc(ev.cash_id)}">Delete</button>
        </div>`).join('')
        : '<p class="muted">No manual adjustments yet.</p>'}
    </section>
  `;

  const $ = (s) => root.querySelector(s);
  const amount = () => dollarsToCents($('#amt').value);

  const addEvent = async (kind, amount_cents, note) => {
    if (amount_cents <= 0) { ctx.toast('Enter an amount'); return; }
    const ids = await ctx.sync.makeIds();
    await saveEvent(ctx, { cash_id: ids.cash(), date: today, kind, amount_cents, event: '', note: note || '' });
    await ctx.sync.commitIds();
    ctx.refresh();
  };

  $('#add').onclick = () => addEvent('add', amount(), $('#note').value.trim());
  $('#remove').onclick = () => addEvent('remove', amount(), $('#note').value.trim() || 'Cash taken out');
  $('#setto').onclick = () => {
    const target = amount();
    const delta = target - total; // adjustment needed to make total == target
    if (delta === 0) { ctx.toast('Already at that amount'); return; }
    addEvent(delta >= 0 ? 'add' : 'remove', Math.abs(delta), $('#note').value.trim() || `Set cash to ${formatCents(target)}`);
  };

  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('danger');
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000);
        return;
      }
      const id = b.getAttribute('data-del');
      await ctx.store.remove('cash_events', id);
      await ctx.sync.enqueue({ kind: 'delete', tab: 'cash_events', id });
      await ctx.syncNow();
      ctx.refresh();
    };
  });
}
