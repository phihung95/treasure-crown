// Import a collection report exported from Collectr (a CSV) and refresh the
// market value of matching inventory items. Pure logic only — no DOM, no store:
// the UI reads a file, calls this to build a preview, then applies the updates.
//
// Collectr's exact column names aren't guaranteed, so columns are detected by
// header keyword rather than fixed position. v1 updates market_value_cents only;
// it never touches cost basis, quantity, or acquisition.
import { fromCsv } from './csv.js';
import { toCents } from './money.js';

// Header keyword → field. Order matters: the most specific field claims a header
// first so, e.g., "Card #" maps to card_number while "Card Name" maps to name.
const FIELD_MATCHERS = [
  ['product_id', /(product\s*id|collectr\s*id|tcg\s*player\s*id|tcg\s*id)/i],
  ['card_number', /(card\s*(#|no\.?|num)|collector\s*(#|no\.?|num)|\bnumber\b|card\s*num)/i],
  ['name', /(card\s*name|product\s*name|item\s*name|title|\bname\b|\bproduct\b|\bitem\b)/i],
  ['grade', /(grade|\bpsa\b|\bbgs\b|\bcgc\b|\bsgc\b)/i],
  ['condition', /condition/i],
  ['set', /(set|expansion|series|\bgroup\b|edition)/i],
  ['quantity', /(qty|quantity|\bcount\b|owned|holdings|copies|# ?owned)/i],
  ['category', /(category|product\s*type|\btype\b|game)/i],
];
// Market value gets special handling so a "Paid"/"Cost" column is never mistaken
// for it: prefer a header containing "market", else any value/price/worth header,
// always excluding cost-basis columns.
const PRICE_INCLUDE = /(market|value|current|price|worth)/i;
const PRICE_EXCLUDE = /(paid|cost|purchase|buy|acquire|spent|profit)/i;

// "$1,234.56" / "1234.5" / "-" / "" → integer cents, or null when unreadable.
export function parseMoneyCents(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? toCents(n) : null;
}

// Map each detected field to the index of its header (or -1 if not present).
export function detectColumns(headers) {
  const cols = { name: -1, set: -1, card_number: -1, condition: -1, grade: -1, quantity: -1, price: -1, product_id: -1, category: -1 };
  const used = new Set();
  const norm = headers.map((h) => String(h || '').trim());
  for (const [field, re] of FIELD_MATCHERS) {
    for (let i = 0; i < norm.length; i += 1) {
      if (used.has(i) || !norm[i]) continue;
      if (re.test(norm[i])) { cols[field] = i; used.add(i); break; }
    }
  }
  // Price: skip already-claimed headers and cost-basis columns; prefer "market".
  let market = -1; let anyValue = -1;
  for (let i = 0; i < norm.length; i += 1) {
    if (used.has(i) || !norm[i] || PRICE_EXCLUDE.test(norm[i]) || !PRICE_INCLUDE.test(norm[i])) continue;
    if (/market/i.test(norm[i])) { market = i; break; }
    if (anyValue === -1) anyValue = i;
  }
  cols.price = market !== -1 ? market : anyValue;
  return cols;
}

// Parse the CSV text into normalized report rows plus the detected column map.
// ok=false (with warnings) when the essential name/price columns aren't found.
export function parseCollectrCsv(text) {
  const rows = fromCsv(text);
  if (rows.length < 2) return { ok: false, warnings: ['The file is empty or has no data rows.'], headers: rows[0] || [], columns: {}, columnNames: {}, rows: [] };
  const headers = rows[0].map((h) => String(h || '').trim());
  const cols = detectColumns(headers);
  const at = (row, field) => (cols[field] >= 0 ? String(row[cols[field]] ?? '').trim() : '');
  const out = rows.slice(1).map((row) => ({
    name: at(row, 'name'),
    set: at(row, 'set'),
    card_number: at(row, 'card_number'),
    condition: at(row, 'condition'),
    grade: at(row, 'grade'),
    category: at(row, 'category'),
    product_id: at(row, 'product_id'),
    quantity: parseInt(at(row, 'quantity'), 10) || 1,
    market_value_cents: parseMoneyCents(at(row, 'price')),
  })).filter((r) => r.name || r.market_value_cents != null);
  const warnings = [];
  if (cols.name < 0) warnings.push('Could not find a card-name column.');
  if (cols.price < 0) warnings.push('Could not find a market-value column.');
  const columnNames = {};
  for (const f of Object.keys(cols)) columnNames[f] = cols[f] >= 0 ? headers[cols[f]] : null;
  return { ok: cols.name >= 0 && cols.price >= 0, warnings, headers, columns: cols, columnNames, rows: out };
}

// Normalize a text token for matching: lowercase, punctuation → spaces, collapsed.
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// A card's condition token is its grade when graded, else its raw condition.
const condToken = (o) => norm(o.grade || o.condition || '');
// Strict key includes the set; loose key drops it (set naming differs between
// tools, so loose lets us still match when only the set label disagrees).
const strictKey = (o) => `${norm(o.name)}|${norm(o.set)}|${norm(o.card_number)}|${condToken(o)}`;
const looseKey = (o) => `${norm(o.name)}|${norm(o.card_number)}|${condToken(o)}`;

// Build the price-refresh plan: which inventory items get a new market value,
// the net change to total inventory value, and which report rows matched nothing.
// Nothing here mutates — the caller applies `updates` as normal item writes.
export function planPriceUpdate({ reportRows, items }) {
  // Report prices keyed strictly and loosely (last readable price for a key wins).
  const priceStrict = new Map();
  const priceLoose = new Map();
  for (const r of reportRows) {
    if (!r.name || r.market_value_cents == null) continue;
    priceStrict.set(strictKey(r), r.market_value_cents);
    priceLoose.set(looseKey(r), r.market_value_cents);
  }
  const itemKeys = new Set();
  const matchedReportKeys = new Set();
  const updates = [];
  let matchedCount = 0;
  let netDeltaCents = 0;
  for (const item of items) {
    const sk = strictKey(item);
    const lk = looseKey(item);
    itemKeys.add(sk); itemKeys.add(lk);
    let newCents = null;
    if (priceStrict.has(sk)) { newCents = priceStrict.get(sk); matchedReportKeys.add(sk); }
    else if (priceLoose.has(lk)) { newCents = priceLoose.get(lk); matchedReportKeys.add(lk); }
    if (newCents == null) continue;
    matchedCount += 1;
    const oldCents = item.market_value_cents || 0;
    if (newCents !== oldCents) {
      updates.push({ item, oldCents, newCents });
      netDeltaCents += (newCents - oldCents) * Math.max(item.quantity_on_hand || 0, 0);
    }
  }
  // Report rows whose card isn't in inventory at all (deduped by strict key).
  const seen = new Set();
  const unmatched = [];
  for (const r of reportRows) {
    if (!r.name) continue;
    const sk = strictKey(r);
    const lk = looseKey(r);
    if (itemKeys.has(sk) || itemKeys.has(lk)) continue;
    if (seen.has(sk)) continue;
    seen.add(sk);
    unmatched.push(r);
  }
  return { updates, matchedCount, changedCount: updates.length, unmatched, netDeltaCents, rowCount: reportRows.length };
}
