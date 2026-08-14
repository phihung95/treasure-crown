import { parseCollectrCsv, planPriceUpdate } from '../../core/collectr.js';
import { formatCents, catLabel } from '../format.js';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Fields we surface in the "detected columns" readout, in a sensible reading order.
const SHOWN_FIELDS = [['name', 'Card name'], ['set', 'Set'], ['card_number', 'Card #'], ['grade', 'Grade'], ['condition', 'Condition'], ['price', 'Market value'], ['quantity', 'Quantity'], ['product_id', 'Product ID']];
const MAX_LIST = 100; // cap rendered rows so a huge report never freezes the view

export async function render(root, ctx) {
  root.innerHTML = `
    <h1>Import from Collectr</h1>
    <div class="card">
      <p class="muted" style="margin:0 0 10px">Export your collection from Collectr (PRO → export CSV), then load it here to refresh
        the <strong>market value</strong> of matching cards. Your cost, quantity, and buy history are never changed.</p>
      <p class="muted" style="margin:0 0 10px"><strong>1.</strong> Choose the CSV → <strong>2.</strong> review the preview of price changes → <strong>3.</strong> tap <strong>Apply</strong> to save. Nothing changes until you apply.</p>
      <input type="file" id="file" accept=".csv,text/csv,text/plain" hidden />
      <button class="btn secondary" id="pick">⤒ Choose Collectr CSV…</button>
      <div class="muted" id="fname" style="margin-top:8px" hidden></div>
    </div>
    <div id="result"></div>
  `;

  const $ = (s) => root.querySelector(s);
  const fileInput = $('#file');
  $('#pick').onclick = () => fileInput.click();

  let plan = null;

  const renderResult = (parsed) => {
    const box = $('#result');
    // Detected-column readout so the user can sanity-check the auto-mapping.
    const cols = SHOWN_FIELDS.map(([f, label]) => {
      const h = parsed.columnNames ? parsed.columnNames[f] : null;
      return `<div class="dl"><span>${label}</span><span class="${h ? '' : 'muted'}">${h ? esc(h) : 'not found'}</span></div>`;
    }).join('');
    const warn = (parsed.warnings || []).length
      ? `<div class="card" style="border-color:#d9a441;background:#fdf7e9"><strong>Heads up</strong><ul style="margin:6px 0 0;padding-left:18px">${parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
         <p class="muted" style="margin:8px 0 0">Send me your export's header row and I can tune the column detection.</p></div>`
      : '';
    let body = `${warn}<div class="card"><div class="panel-h">Detected columns</div>${cols}</div>`;

    if (parsed.ok) {
      const { updates, matchedCount, changedCount, unmatched, netDeltaCents, rowCount } = plan;
      const deltaCls = netDeltaCents > 0 ? 'pos' : netDeltaCents < 0 ? 'neg' : '';
      body += `<div class="card">
        <div class="panel-h">Preview</div>
        <div class="dl"><span>Rows in report</span><span>${rowCount}</span></div>
        <div class="dl"><span>Matched to inventory</span><span>${matchedCount}</span></div>
        <div class="dl"><span>Price changes</span><span>${changedCount}</span></div>
        <div class="dl"><span>Not in your inventory</span><span>${unmatched.length}</span></div>
        <div class="dl dl-total"><span>Net inventory value change</span><span class="${deltaCls}">${netDeltaCents >= 0 ? '+' : ''}${formatCents(netDeltaCents)}</span></div>
      </div>`;

      if (changedCount) {
        // Primary action FIRST, right under the summary, so the next step is obvious
        // without scrolling past the (possibly long) list of changes.
        body += `<div class="card" style="border-color:var(--gold-deep)">
          <p style="margin:0 0 10px"><strong>${changedCount} price${changedCount === 1 ? '' : 's'}</strong> will update. Nothing is saved until you tap below.</p>
          <button class="btn" id="apply">✓ Apply ${changedCount} price update${changedCount === 1 ? '' : 's'}</button>
        </div>`;
        const rows = updates.slice(0, MAX_LIST).map((u) => {
          const it = u.item;
          const meta = [it.set, it.card_number ? `#${it.card_number}` : '', it.grade || it.condition].filter(Boolean).join(' · ');
          const up = u.newCents > u.oldCents;
          return `<div class="sale-row"><div class="sale-main">
            <div class="sale-name">${esc(it.name)}</div>
            <div class="muted">${esc(meta)}</div></div>
            <span class="muted" style="text-align:right">${formatCents(u.oldCents)} → <strong class="${up ? 'pos' : 'neg'}">${formatCents(u.newCents)}</strong></span></div>`;
        }).join('');
        const more = changedCount > MAX_LIST ? `<div class="muted" style="padding:8px 0">…and ${changedCount - MAX_LIST} more</div>` : '';
        body += `<div class="card"><div class="panel-h">Price changes (${changedCount})</div>${rows}${more}</div>`;
      } else if (matchedCount) {
        body += `<div class="card"><p class="muted" style="margin:0">Every matched card is already up to date — nothing to change.</p></div>`;
      } else {
        // Nothing matched at all — the usual cause of "what's the next step?".
        body += `<div class="card"><p style="margin:0 0 6px"><strong>No cards matched your inventory.</strong></p>
          <p class="muted" style="margin:0">This import refreshes the <strong>market value</strong> of cards you already hold — it doesn't add new cards. None of the ${rowCount} rows in this file matched a card in your inventory, so there's nothing to apply. This usually means the card names, sets, or conditions are labelled differently than in your inventory.</p></div>`;
      }

      if (unmatched.length) {
        const rows = unmatched.slice(0, MAX_LIST).map((r) => {
          const meta = [r.set, r.card_number ? `#${r.card_number}` : '', r.grade || r.condition].filter(Boolean).join(' · ');
          return `<div class="sale-row"><div class="sale-main"><div class="sale-name">${esc(r.name)}</div><div class="muted">${esc(meta)}</div></div>
            <span class="muted">${r.market_value_cents != null ? formatCents(r.market_value_cents) : ''}</span></div>`;
        }).join('');
        const more = unmatched.length > MAX_LIST ? `<div class="muted" style="padding:8px 0">…and ${unmatched.length - MAX_LIST} more</div>` : '';
        body += `<div class="card"><div class="panel-h">In report, not in inventory (${unmatched.length})</div>
          <p class="muted" style="margin:0 0 8px">These didn't match any card you hold — added new cards, or a naming difference.</p>${rows}${more}</div>`;
      }
    }

    box.innerHTML = body;

    const applyBtn = $('#apply');
    if (applyBtn) applyBtn.onclick = async () => {
      applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
      let n = 0;
      for (const u of plan.updates) {
        const row = { ...u.item, market_value_cents: u.newCents };
        await ctx.store.put('items', row);
        await ctx.sync.enqueue({ kind: 'put', tab: 'items', row });
        n += 1;
      }
      await ctx.syncNow();
      ctx.toast(`Updated ${n} market price${n === 1 ? '' : 's'}`);
      box.innerHTML = `<div class="card"><div class="panel-h">Done</div>
        <p class="muted" style="margin:0 0 10px">Updated ${n} price${n === 1 ? '' : 's'}. Your Business Value now reflects the new market values.</p>
        <a class="btn" href="#/dashboard">Back to Home</a>
        <a class="btn secondary" href="#/inventory">View inventory</a></div>`;
    };
  };

  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    $('#fname').hidden = false; $('#fname').textContent = `Loaded: ${f.name}`;
    let text = '';
    try { text = await f.text(); } catch { ctx.toast('Could not read that file'); return; }
    const parsed = parseCollectrCsv(text);
    const items = await ctx.store.getAll('items');
    plan = parsed.ok ? planPriceUpdate({ reportRows: parsed.rows, items }) : null;
    renderResult(parsed);
    // Bring the freshly-rendered preview/next-step into view (esp. on mobile).
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}
