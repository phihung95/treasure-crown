import { decrement } from './inventory.js';
import { deriveStatus } from './schema.js';
import { allocateByWeights, splitEven } from './money.js';

// Sell several items together for one bundle price. The price is split across
// the lines weighted by market value × qty (even split if no line has a market
// value), then each line is booked as its own sale (decrementing stock). Throws
// if any line oversells. Returns the sale rows + updated items to persist.
export function bookLotSale({ lines, lot_total_cents, payment_method, date, event, notes, channel }, ids) {
  const weights = lines.map((l) => (l.item.market_value_cents || 0) * (l.quantity || 1));
  let lineTotals;
  if (weights.some((w) => w > 0)) {
    lineTotals = allocateByWeights(lot_total_cents, weights);
  } else {
    const per = splitEven(lot_total_cents, lines.reduce((s, l) => s + (l.quantity || 1), 0));
    let cur = 0; lineTotals = lines.map((l) => { let sum = 0; for (let u = 0; u < (l.quantity || 1); u += 1) { sum += per[cur]; cur += 1; } return sum; });
  }
  const saleRows = []; const updatedItems = [];
  lines.forEach((l, i) => {
    const qty = l.quantity || 1;
    const { saleRow, updatedItem } = bookSale({
      item: l.item, quantity: qty, unit_price_cents: Math.round(lineTotals[i] / qty),
      payment_method, date, event, notes, channel,
    }, ids.sale());
    saleRows.push(saleRow); updatedItems.push(updatedItem);
  });
  return { saleRows, updatedItems };
}

export function bookSale({ item, quantity, unit_price_cents, payment_method, date, event, notes, channel }, txn_id) {
  const updatedItem = decrement(item, quantity);
  const revenue_cents = quantity * unit_price_cents;
  const cost_cents = quantity * item.unit_cost_cents;
  const saleRow = {
    txn_id,
    date: date || new Date().toISOString().slice(0, 10),
    event: event || '',
    type: 'sale',
    trade_id: '',
    item_id: item.item_id,
    item_name: item.name,
    category: item.category,
    quantity,
    unit_price_cents,
    unit_cost_cents: item.unit_cost_cents,
    revenue_cents,
    cost_cents,
    profit_cents: revenue_cents - cost_cents,
    payment_method: payment_method || '',
    notes: notes || '',
    // Only stamp a channel (e.g. 'dice' for the dice challenge) when there is one.
    // Regular sales omit the key entirely so they sync even before the backend
    // has a `channel` column — only tagged sales depend on it.
    ...(channel ? { channel } : {}),
  };
  return { saleRow, updatedItem };
}

// Record a sale for something NOT in inventory (a one-off). No stock changes;
// item_id is left blank and the cost basis is whatever the user enters (0 by
// default). Lets the operator ring up a card they never added to inventory.
export function bookCustomSale({ name, category, quantity, unit_price_cents, unit_cost_cents, payment_method, date, event, notes, channel }, txn_id) {
  const qty = quantity || 1;
  const unitCost = unit_cost_cents || 0;
  const revenue_cents = qty * unit_price_cents;
  const cost_cents = qty * unitCost;
  const saleRow = {
    txn_id,
    date: date || new Date().toISOString().slice(0, 10),
    event: event || '',
    type: 'sale',
    trade_id: '',
    item_id: '',
    item_name: (name && name.trim()) || 'One-off item',
    category: category || 'other',
    quantity: qty,
    unit_price_cents,
    unit_cost_cents: unitCost,
    revenue_cents,
    cost_cents,
    profit_cents: revenue_cents - cost_cents,
    payment_method: payment_method || '',
    notes: notes || '',
    ...(channel ? { channel } : {}),
  };
  return { saleRow };
}

// Reverse a booked sale: put the sold quantity back on the item's shelf. The
// cost basis is untouched (a void isn't a repurchase). Returns the item to
// re-save; if the item no longer exists, updatedItem is null.
export function voidSale(sale, item) {
  if (!item) return { updatedItem: null };
  const newQty = (item.quantity_on_hand || 0) + (sale.quantity || 0);
  return { updatedItem: { ...item, quantity_on_hand: newQty, status: deriveStatus(newQty) } };
}

// Edit a booked sale in place. Recomputes revenue/profit and reconciles stock
// for any quantity change (selling more pulls from the shelf; fewer returns to
// it). unit_cost stays whatever was locked at sale time. Throws if the change
// would oversell. Pass the fields to change; omitted ones keep their value.
export function editSale(sale, item, changes = {}) {
  const quantity = changes.quantity ?? sale.quantity;
  const unit_price_cents = changes.unit_price_cents ?? sale.unit_price_cents;
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity must be at least 1');
  if (!Number.isInteger(unit_price_cents) || unit_price_cents < 0) throw new Error('price must be 0 or more');

  const delta = quantity - (sale.quantity || 0); // extra units to pull from stock
  const newOnHand = (item ? item.quantity_on_hand : 0) - delta;
  if (item && newOnHand < 0) throw new Error('insufficient stock');

  const unit_cost = sale.unit_cost_cents || 0;
  const revenue_cents = quantity * unit_price_cents;
  const cost_cents = quantity * unit_cost;
  const updatedSale = {
    ...sale,
    quantity,
    unit_price_cents,
    revenue_cents,
    cost_cents,
    profit_cents: revenue_cents - cost_cents,
    payment_method: changes.payment_method ?? sale.payment_method,
    event: changes.event ?? sale.event,
    notes: changes.notes ?? sale.notes,
    channel: changes.channel ? 'dice' : '',
  };
  const updatedItem = item ? { ...item, quantity_on_hand: newOnHand, status: deriveStatus(newOnHand) } : null;
  return { updatedSale, updatedItem };
}
