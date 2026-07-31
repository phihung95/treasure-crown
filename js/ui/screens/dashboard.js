import { aggregate } from '../../core/dashboard.js';
import { formatCents, catLabel } from '../format.js';

export async function render(root, ctx) {
  const sales = await ctx.store.getAll('sales');
  const items = await ctx.store.getAll('items');
  let period = 'show';

  const draw = () => {
    const a = aggregate({ sales, items, period });
    const keys = Object.keys({ ...a.revenueByKey, ...a.profitByKey }).sort().reverse();
    root.innerHTML = `
      <h1>Home</h1>
      <div class="row">
        ${['day', 'show', 'month'].map((p) => `<button class="btn ${p === period ? '' : 'ghost'}" data-p="${p}">${p}</button>`).join('')}
      </div>
      <div class="split">
        <div class="card"><div class="muted">Inventory cost</div><div class="big">${formatCents(a.inventory.cost_cents)}</div></div>
        <div class="card"><div class="muted">Inventory market</div><div class="big">${formatCents(a.inventory.market_cents)}</div></div>
      </div>
      <div class="card">
        <div class="muted">Revenue &amp; profit by ${period}</div>
        ${keys.length ? keys.map((k) => `
          <div class="list-item"><span>${k}</span>
          <span class="right">rev ${formatCents(a.revenueByKey[k] || 0)}<br>
          <span class="${(a.profitByKey[k] || 0) >= 0 ? 'pos' : 'neg'}">profit ${formatCents(a.profitByKey[k] || 0)}</span></span></div>`).join('')
          : '<p class="muted">No sales yet.</p>'}
      </div>
      <div class="card">
        <div class="muted">By category</div>
        ${Object.keys(a.byCategory).map((c) => {
          const v = a.byCategory[c];
          return `<div class="list-item"><span>${catLabel(c)}</span>
          <span class="right muted">rev ${formatCents(v.revenue_cents)} · profit ${formatCents(v.profit_cents)}<br>
          stock ${formatCents(v.inventory_cost_cents)} cost</span></div>`;
        }).join('') || '<p class="muted">—</p>'}
      </div>
    `;
    root.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { period = b.getAttribute('data-p'); draw(); }; });
  };
  draw();
}
