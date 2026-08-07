import { computePrintUnitCostCents } from '../../core/costing.js';
import { restock } from '../../core/inventory.js';
import { newItem } from '../../core/schema.js';
import { dollarsToCents, formatCents } from '../format.js';

async function save(ctx, tab, row) {
  await ctx.store.put(tab, row);
  await ctx.sync.enqueue({ kind: 'put', tab, row });
}

function ratesById(filaments) {
  const m = {};
  for (const f of filaments) m[f.filament_id] = { cost_per_kg_cents: f.cost_per_kg_cents };
  return m;
}

export async function render(root, ctx) {
  const filaments = await ctx.store.getAll('filaments');
  const products = await ctx.store.getAll('print_products');
  const allParts = await ctx.store.getAll('print_parts');
  const rates = ratesById(filaments);
  const machine = ctx.settings.machine_hourly_rate_cents || 0;
  const parts = [];

  const partsFor = (pid) => allParts.filter((p) => p.print_product_id === pid);
  const unitCost = (product, ps) => computePrintUnitCostCents({
    parts: ps, filamentRatesById: rates, machine_hourly_rate_cents: machine, extras_cost_cents: product.extras_cost_cents || 0,
  });

  const filOptions = filaments.map((f) => `<option value="${f.filament_id}">${f.name}</option>`).join('');

  root.innerHTML = `
    <h1>3D Prints</h1>
    ${filaments.length === 0 ? '<p class="muted">Add filaments in Settings first.</p>' : ''}
    <div id="products">${products.map((p) => {
      const c = unitCost(p, partsFor(p.print_product_id));
      return `<div class="card"><div class="list-item" style="border:0;margin:0;padding:0">
        <span><strong>${p.name}</strong><div class="muted">${partsFor(p.print_product_id).length} part(s) · unit cost ${formatCents(c)}</div></span>
        <span><input style="width:64px" inputmode="numeric" value="1" data-n="${p.print_product_id}" />
        <button class="btn" style="width:auto;margin:0" data-make="${p.print_product_id}">Make</button></span>
      </div></div>`;
    }).join('') || '<p class="muted">No print products yet.</p>'}</div>

    <div class="card">
      <h1 style="font-size:16px">New print product</h1>
      <label>Name</label><input id="p-name" placeholder="Torii Slab Stand" />
      <label>Extras $ (hardware/consumables, each)</label><input id="p-extras" inputmode="decimal" value="0.00" />
      <div id="parts"></div>
      <div class="card" style="background:#faf7f2">
        <strong>Add part</strong>
        <label>Part name</label><input id="pt-name" placeholder="left column" />
        <label>Filament</label><select id="pt-fil">${filOptions}</select>
        <div class="row">
          <div><label>Grams</label><input id="pt-g" inputmode="decimal" value="0" /></div>
          <div><label>Print hours</label><input id="pt-h" inputmode="decimal" value="0" /></div>
        </div>
        <button class="btn secondary" id="add-part">Add part</button>
      </div>
      <div class="muted" id="p-cost">Unit cost: $0.00</div>
      <button class="btn" id="save-product">Save product</button>
    </div>
  `;

  const draftCost = () => {
    const c = computePrintUnitCostCents({
      parts, filamentRatesById: rates, machine_hourly_rate_cents: machine,
      extras_cost_cents: dollarsToCents(root.querySelector('#p-extras').value),
    });
    root.querySelector('#p-cost').textContent = `Unit cost: ${formatCents(c)}`;
  };
  const renderParts = () => {
    root.querySelector('#parts').innerHTML = parts.map((p, i) => {
      const fname = (filaments.find((f) => f.filament_id === p.filament_id) || {}).name || '?';
      return `<div class="list-item"><span>${p.part_name} <span class="chip">${fname}</span>
        <div class="muted">${p.grams}g · ${p.print_hours}h</div></span>
        <button class="btn ghost" style="width:auto;margin:0" data-dp="${i}">✕</button></div>`;
    }).join('');
    root.querySelectorAll('[data-dp]').forEach((b) => { b.onclick = () => { parts.splice(+b.getAttribute('data-dp'), 1); renderParts(); draftCost(); }; });
    draftCost();
  };
  root.querySelector('#p-extras').oninput = draftCost;

  root.querySelector('#add-part').onclick = () => {
    parts.push({
      part_name: root.querySelector('#pt-name').value.trim() || `part ${parts.length + 1}`,
      filament_id: root.querySelector('#pt-fil').value,
      grams: parseFloat(root.querySelector('#pt-g').value) || 0,
      print_hours: parseFloat(root.querySelector('#pt-h').value) || 0,
    });
    root.querySelector('#pt-name').value = ''; root.querySelector('#pt-g').value = '0'; root.querySelector('#pt-h').value = '0';
    renderParts();
  };

  root.querySelector('#save-product').onclick = async () => {
    const name = root.querySelector('#p-name').value.trim();
    if (!name) { ctx.toast('Name required'); return; }
    if (parts.length === 0) { ctx.toast('Add at least one part'); return; }
    const ids = await ctx.sync.makeIds();
    const print_product_id = ids.printProduct();
    const extras = dollarsToCents(root.querySelector('#p-extras').value);
    const computed = computePrintUnitCostCents({ parts, filamentRatesById: rates, machine_hourly_rate_cents: machine, extras_cost_cents: extras });
    await save(ctx, 'print_products', {
      print_product_id, name, extras_cost_cents: extras,
      computed_unit_cost_cents: computed, default_market_value_cents: 0, notes: '',
    });
    for (const p of parts) {
      await save(ctx, 'print_parts', { part_id: ids.part(), print_product_id, part_name: p.part_name, filament_id: p.filament_id, grams: p.grams, print_hours: p.print_hours });
    }
    await ctx.sync.commitIds();
    await ctx.syncNow();
    ctx.toast('Product saved');
    ctx.refresh();
  };

  root.querySelectorAll('[data-make]').forEach((btn) => {
    btn.onclick = async () => {
      const pid = btn.getAttribute('data-make');
      const n = parseInt(root.querySelector(`[data-n="${pid}"]`).value, 10) || 0;
      if (n <= 0) { ctx.toast('Enter a quantity'); return; }
      const product = products.find((p) => p.print_product_id === pid);
      const cost = unitCost(product, partsFor(pid));
      const existing = (await ctx.store.getAll('items')).find((i) => i.category === 'print' && i.print_product_id === pid);
      let item;
      if (existing) {
        item = restock(existing, n, cost);
      } else {
        const ids = await ctx.sync.makeIds();
        item = newItem({
          category: 'print', name: product.name, print_product_id: pid,
          quantity_on_hand: n, unit_cost_cents: cost,
          market_value_cents: product.default_market_value_cents || 0, acquisition: 'printed',
        }, ids.item());
        await ctx.sync.commitIds();
      }
      await save(ctx, 'items', item);
      await ctx.syncNow();
      ctx.toast(`Made ${n} × ${product.name} @ ${formatCents(cost)}`);
      ctx.refresh();
    };
  });
}
