import { newItem, validateItem, CATEGORIES, deriveStatus } from '../../core/schema.js';
import { dollarsToCents, centsInputValue, formatCents, catLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

export async function render(root, ctx) {
  const items = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  root.innerHTML = `
    <h1>Stock (${items.length})</h1>
    <input id="q" placeholder="Search name / set / cert…" />
    <div id="list"></div>
    <div class="card">
      <h1 style="font-size:16px">Add item</h1>
      <label>Category</label>
      <select id="cat">${CATEGORIES.map((c) => `<option value="${c}">${catLabel(c)}</option>`).join('')}</select>
      <label>Name</label><input id="name" placeholder="Charizard VMAX / Surging Sparks Box" />
      <div id="fields"></div>
      <div class="row">
        <div><label>Quantity</label><input id="qty" inputmode="numeric" value="1" /></div>
        <div><label>Unit cost $</label><input id="cost" inputmode="decimal" value="0.00" /></div>
      </div>
      <label>Est. market value $ (each)</label><input id="mv" inputmode="decimal" value="0.00" />
      <button class="btn" id="add">Add to stock</button>
    </div>
  `;

  const catFields = () => {
    const cat = root.querySelector('#cat').value;
    const F = {
      single: ['set', 'card_number', 'rarity_variant', 'language', 'condition'],
      slab: ['set', 'card_number', 'grade', 'grader', 'cert_number'],
      sealed: ['set', 'product_type', 'language'],
      print: [],
      other: [],
    }[cat] || [];
    root.querySelector('#fields').innerHTML = F.map((f) =>
      `<label>${f.replace(/_/g, ' ')}</label><input data-f="${f}" />`).join('');
  };

  const renderList = () => {
    const q = root.querySelector('#q').value.toLowerCase();
    const shown = items.filter((i) => !q || `${i.name} ${i.set} ${i.cert_number}`.toLowerCase().includes(q));
    root.querySelector('#list').innerHTML = shown.map((i) => `
      <div class="list-item">
        <span>${i.name} <span class="chip">${catLabel(i.category)}</span>
          <div class="muted">x${i.quantity_on_hand} · cost ${formatCents(i.unit_cost_cents)} · mkt ${formatCents(i.market_value_cents)}</div>
        </span>
        <button class="btn ghost" style="width:auto;margin:0" data-edit="${i.item_id}">Edit</button>
      </div>`).join('') || '<p class="muted">No items.</p>';
    root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editItem(b.getAttribute('data-edit')); });
  };

  async function editItem(id) {
    const it = items.find((x) => x.item_id === id);
    const mv = prompt(`Market value each for "${it.name}" ($):`, centsInputValue(it.market_value_cents));
    if (mv === null) return;
    const qty = prompt('Quantity on hand:', String(it.quantity_on_hand));
    if (qty === null) return;
    const updated = { ...it, market_value_cents: dollarsToCents(mv), quantity_on_hand: parseInt(qty, 10) || 0 };
    updated.status = deriveStatus(updated.quantity_on_hand);
    await save(ctx, 'items', updated);
    await ctx.syncNow();
    ctx.refresh();
  }

  root.querySelector('#cat').onchange = catFields;
  root.querySelector('#q').oninput = renderList;
  catFields();
  renderList();

  root.querySelector('#add').onclick = async () => {
    const cat = root.querySelector('#cat').value;
    const extra = {};
    root.querySelectorAll('[data-f]').forEach((el) => { extra[el.getAttribute('data-f')] = el.value.trim(); });
    const ids = await ctx.sync.makeIds();
    const item = newItem({
      category: cat,
      name: root.querySelector('#name').value.trim(),
      quantity_on_hand: parseInt(root.querySelector('#qty').value, 10) || 0,
      unit_cost_cents: dollarsToCents(root.querySelector('#cost').value),
      market_value_cents: dollarsToCents(root.querySelector('#mv').value),
      acquisition: 'bought',
      ...extra,
    }, ids.item());
    const problems = validateItem(item);
    if (problems.length) { ctx.toast(problems[0]); return; }
    await save(ctx, 'items', item);
    await ctx.sync.commitIds();
    await ctx.syncNow();
    ctx.toast('Added');
    ctx.refresh();
  };
}
