import { decrement } from './inventory.js';
import { deriveStatus } from './schema.js';

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
    channel: changes.channel ? 'dice' : '',
  };
  const updatedItem = item ? { ...item, quantity_on_hand: newOnHand, status: deriveStatus(newOnHand) } : null;
  return { updatedSale, updatedItem };
}
