export const CATEGORIES = ['single', 'slab', 'sealed', 'print', 'other'];
export const PAYMENT_METHODS = ['cash', 'zelle', 'venmo', 'cashapp'];
// Raw-card conditions, near-mint to damaged. Blank = unspecified.
export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

export function deriveStatus(quantity_on_hand) {
  return quantity_on_hand > 0 ? 'active' : 'depleted';
}

export function newItem(fields, id) {
  const qty = fields.quantity_on_hand ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  return {
    item_id: id,
    category: fields.category ?? 'other',
    name: fields.name ?? '',
    set: fields.set ?? '',
    card_number: fields.card_number ?? '',
    rarity_variant: fields.rarity_variant ?? '',
    language: fields.language ?? '',
    grade: fields.grade ?? '',
    grader: fields.grader ?? '',
    cert_number: fields.cert_number ?? '',
    condition: fields.condition ?? '',
    product_type: fields.product_type ?? '',
    print_product_id: fields.print_product_id ?? '',
    quantity_on_hand: qty,
    unit_cost_cents: fields.unit_cost_cents ?? 0,
    market_value_cents: fields.market_value_cents ?? 0,
    acquisition: fields.acquisition ?? 'bought',
    source_trade_id: fields.source_trade_id ?? '',
    source_purchase_id: fields.source_purchase_id ?? '',
    acquired_date: fields.acquired_date ?? today,
    date_added: fields.date_added ?? today,
    status: deriveStatus(qty),
    notes: fields.notes ?? '',
  };
}

export function validateItem(item) {
  const problems = [];
  if (!CATEGORIES.includes(item.category)) problems.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!item.name || String(item.name).trim() === '') problems.push('name is required');
  if (!Number.isInteger(item.quantity_on_hand) || item.quantity_on_hand < 0) problems.push('quantity_on_hand must be an integer >= 0');
  if (!Number.isInteger(item.unit_cost_cents) || item.unit_cost_cents < 0) problems.push('unit_cost_cents must be an integer >= 0');
  return problems;
}
