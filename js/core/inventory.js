import { deriveStatus } from './schema.js';

export function restock(existingItem, addQuantity, addUnitCostCents) {
  const oldQty = existingItem.quantity_on_hand;
  const newQty = oldQty + addQuantity;
  const blended = newQty === 0
    ? 0
    : Math.round((oldQty * existingItem.unit_cost_cents + addQuantity * addUnitCostCents) / newQty);
  return { ...existingItem, quantity_on_hand: newQty, unit_cost_cents: blended, status: deriveStatus(newQty) };
}

export function decrement(item, quantity) {
  if (quantity > item.quantity_on_hand) throw new Error('insufficient stock');
  const newQty = item.quantity_on_hand - quantity;
  return { ...item, quantity_on_hand: newQty, status: deriveStatus(newQty) };
}
