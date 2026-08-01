import { decrement } from './inventory.js';

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
