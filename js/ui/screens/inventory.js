import { newItem, validateItem, CATEGORIES, deriveStatus } from '../../core/schema.js';
import { dollarsToCents, centsInputValue, formatCents, catLabel } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function attr(i) {
  if (i.category === 'slab') {
    const grade = (i.grade || '').trim();
    const grader = (i.grader || '').trim();
    // The grade often already carries the company (e.g. "PSA 10") — don't repeat it.
    if (grade && grader && !grade.toLowerCase().includes(grader.toLowerCase())) return `${grader} ${grade}`;
    return grade || grader;
  }
  if (i.category === 'single') return `${i.set || ''}${i.card_number ? ` #${i.card_number}` : ''}`.trim();
  if (i.category === 'sealed') return `${i.product_type || ''} ${i.set || ''}`.trim();
  return '';
}

export async function render(root, ctx) {
  const items = (await ctx.store.getAll('items')).filter((i) => i.quantity_on_hand > 0);
  let editing = null;      // item_id currently being edited
  let catFilter = 'all';

  root.innerHTML = `
    <div class="dash-head"><h1>Inventory (${items.length})</h1>
      <button class="btn" id="jump-add" style="width:auto;margin:0;padding:9px 16px">+ Add item</button></div>
    <div id="inv-summary"></div>
    <input id="q" placeholder="Search name / set / cert / grade…" autocomplete="off" />
    <div class="inv-controls">
      <div class="chips" id="cat-filter">
        <button class="fchip on" data-cf="all">All</button>
        ${CATEGORIES.map((c) => `<button class="fchip" data-cf="${c}">${catLabel(c)}</button>`).join('')}
      </div>
      <select id="sort" aria-label="sort">
        <option value="market">Sort: Market value</option>
        <option value="profit">Sort: Potential profit</option>
        <option value="recent">Sort: Recently added</option>
        <option value="name">Sort: Name</option>
      </select>
    </div>
    <div id="list"></div>

    <div class="card" id="add-card">
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
      <button class="btn" id="add">Add to inventory</button>
    </div>
  `;

  const $ = (s) => root.querySelector(s);

  const renderSummary = () => {
    let costTotal = 0, marketTotal = 0, units = 0, needsPrice = 0, underwater = 0;
    const byCat = {};
    for (const i of items) {
      const lc = i.quantity_on_hand * i.unit_cost_cents;
      const lm = i.quantity_on_hand * i.market_value_cents;
      costTotal += lc; marketTotal += lm; units += i.quantity_on_hand;
      byCat[i.category] = (byCat[i.category] || 0) + lm;
      if (i.market_value_cents <= 0) needsPrice += 1;
      else if (i.market_value_cents < i.unit_cost_cents) underwater += 1;
    }
    const unreal = marketTotal - costTotal;
    const margin = costTotal > 0 ? Math.round((unreal / costTotal) * 100) : 0;
    const cats = CATEGORIES.filter((c) => byCat[c]).map((c) => `${catLabel(c)} <b>${formatCents(byCat[c])}</b>`).join(' · ');
    const alerts = (needsPrice || underwater)
      ? `<div class="inv-alerts">⚠ ${needsPrice ? `${needsPrice} need a market value` : ''}${needsPrice && underwater ? ' · ' : ''}${underwater ? `${underwater} underwater` : ''}</div>` : '';
    $('#inv-summary').innerHTML = `
      <div class="card inv-summary">
        <div class="split">
          <div class="stat"><span class="stat-k">At cost</span><span class="stat-v">${formatCents(costTotal)}</span></div>
          <div class="stat"><span class="stat-k">At market</span><span class="stat-v">${formatCents(marketTotal)}</span></div>
        </div>
        <div class="inv-sum-line"><span>Unrealized profit · ${items.length} items / ${units} units</span>
          <span class="inv-sum-profit ${unreal >= 0 ? 'pos' : 'neg'}">${formatCents(unreal)} · ${margin}%</span></div>
        ${cats ? `<div class="inv-cats">${cats}</div>` : ''}
        ${alerts}
      </div>`;
  };

  const sortItems = (arr, mode) => {
    const potential = (i) => (i.market_value_cents > 0 ? (i.market_value_cents - i.unit_cost_cents) * i.quantity_on_hand : -Infinity);
    const copy = [...arr];
    if (mode === 'market') copy.sort((a, b) => b.market_value_cents * b.quantity_on_hand - a.market_value_cents * a.quantity_on_hand);
    else if (mode === 'profit') copy.sort((a, b) => potential(b) - potential(a));
    else if (mode === 'recent') copy.sort((a, b) => String(b.date_added || '').localeCompare(String(a.date_added || '')) || String(b.item_id).localeCompare(String(a.item_id)));
    else copy.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return copy;
  };

  const editRow = (i) => `
    <div class="inv-row editing">
      <div class="edit-grid">
        <input class="edit-name" data-en value="${esc(i.name)}" aria-label="name" />
        <div class="row">
          <div><label>Qty</label><input data-eq inputmode="numeric" value="${i.quantity_on_hand}" /></div>
          <div><label>Unit cost $</label><input data-ecost inputmode="decimal" value="${centsInputValue(i.unit_cost_cents)}" /></div>
          <div><label>Market $ each</label><input data-emv inputmode="decimal" value="${centsInputValue(i.market_value_cents)}" /></div>
        </div>
        <div class="row">
          <button class="btn secondary" data-done="${i.item_id}">Done</button>
          <button class="btn ghost" data-cancel>Cancel</button>
        </div>
      </div>
    </div>`;

  const row = (i) => {
    if (editing === i.item_id) return editRow(i);
    const hasMv = i.market_value_cents > 0;
    const profit = hasMv ? (i.market_value_cents - i.unit_cost_cents) * i.quantity_on_hand : null;
    const margin = (hasMv && i.unit_cost_cents > 0) ? Math.round((i.market_value_cents - i.unit_cost_cents) / i.unit_cost_cents * 100) : null;
    const underwater = hasMv && i.market_value_cents < i.unit_cost_cents;
    const a = attr(i);
    const flags = `${!hasMv ? '<span class="flag warn">needs price</span>' : ''}${underwater ? '<span class="flag neg">underwater</span>' : ''}`;
    return `<div class="inv-row">
      <div class="inv-main">
        <div class="inv-name">${esc(i.name)} <span class="chip">${catLabel(i.category)}</span>${a ? `<span class="inv-attr">${esc(a)}</span>` : ''}</div>
        <div class="muted">×${i.quantity_on_hand} · cost ${formatCents(i.unit_cost_cents)} · mkt ${hasMv ? formatCents(i.market_value_cents) : '—'}${flags}</div>
      </div>
      <div class="inv-money">
        ${profit != null
          ? `<div class="inv-profit ${profit >= 0 ? 'pos' : 'neg'}">${formatCents(profit)}</div><div class="muted">${margin != null ? `${margin}%` : ''}</div>`
          : '<div class="muted">—</div>'}
      </div>
      <button class="btn ghost row-btn" data-edit="${i.item_id}" aria-label="edit">✎</button>
    </div>`;
  };

  const renderList = () => {
    const q = $('#q').value.toLowerCase();
    let shown = items.filter((i) => (catFilter === 'all' || i.category === catFilter)
      && (!q || `${i.name} ${i.set} ${i.cert_number} ${i.grader} ${i.grade}`.toLowerCase().includes(q)));
    shown = sortItems(shown, $('#sort').value);
    $('#list').innerHTML = shown.map(row).join('') || '<p class="muted">No items match.</p>';
    root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { editing = b.getAttribute('data-edit'); renderList(); const n = root.querySelector('[data-en]'); if (n) { n.focus(); n.select(); } }; });
    root.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = () => { editing = null; renderList(); }; });
    root.querySelectorAll('[data-done]').forEach((b) => { b.onclick = async () => {
      const id = b.getAttribute('data-done');
      const idx = items.findIndex((x) => x.item_id === id);
      if (idx < 0) return;
      const qtyN = parseInt(root.querySelector('[data-eq]').value, 10);
      const updated = {
        ...items[idx],
        name: root.querySelector('[data-en]').value.trim() || items[idx].name,
        quantity_on_hand: Number.isFinite(qtyN) ? Math.max(0, qtyN) : items[idx].quantity_on_hand,
        unit_cost_cents: dollarsToCents(root.querySelector('[data-ecost]').value),
        market_value_cents: dollarsToCents(root.querySelector('[data-emv]').value),
      };
      updated.status = deriveStatus(updated.quantity_on_hand);
      items[idx] = updated;
      editing = null;
      await save(ctx, 'items', updated);
      await ctx.syncNow();
      if (updated.quantity_on_hand <= 0) items.splice(idx, 1); // dropped out of on-hand view
      renderSummary(); renderList();
    }; });
  };

  const catFields = () => {
    const cat = $('#cat').value;
    const F = {
      single: ['set', 'card_number', 'rarity_variant', 'language', 'condition'],
      slab: ['set', 'card_number', 'grade', 'grader', 'cert_number'],
      sealed: ['set', 'product_type', 'language'],
      print: [], other: [],
    }[cat] || [];
    $('#fields').innerHTML = F.map((f) => `<label>${f.replace(/_/g, ' ')}</label><input data-f="${f}" />`).join('');
  };

  root.querySelectorAll('[data-cf]').forEach((b) => { b.onclick = () => {
    catFilter = b.getAttribute('data-cf');
    root.querySelectorAll('[data-cf]').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  }; });
  $('#jump-add').onclick = () => {
    $('#add-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const nameEl = $('#name'); if (nameEl) setTimeout(() => nameEl.focus(), 300);
  };
  $('#q').oninput = renderList;
  $('#sort').onchange = renderList;
  $('#cat').onchange = catFields;
  catFields();
  renderSummary();
  renderList();

  $('#add').onclick = async () => {
    const cat = $('#cat').value;
    const extra = {};
    root.querySelectorAll('[data-f]').forEach((el) => { extra[el.getAttribute('data-f')] = el.value.trim(); });
    const ids = await ctx.sync.makeIds();
    const item = newItem({
      category: cat,
      name: $('#name').value.trim(),
      quantity_on_hand: parseInt($('#qty').value, 10) || 0,
      unit_cost_cents: dollarsToCents($('#cost').value),
      market_value_cents: dollarsToCents($('#mv').value),
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
