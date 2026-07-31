export function periodKey(dateISO, period) {
  if (period === 'month') return dateISO.slice(0, 7);
  return dateISO;
}

function keyFor(row, period) {
  return period === 'show' ? (row.event || '(no show)') : periodKey(row.date, period);
}

export function aggregate({ sales, items, period }) {
  const revenueByKey = {};
  const profitByKey = {};
  const byCategory = {};
  const ensureCat = (c) => (byCategory[c] ||= { revenue_cents: 0, profit_cents: 0, inventory_cost_cents: 0, inventory_market_cents: 0 });

  for (const row of sales) {
    const key = keyFor(row, period);
    if (row.type === 'sale') {
      revenueByKey[key] = (revenueByKey[key] || 0) + row.revenue_cents;
      ensureCat(row.category).revenue_cents += row.revenue_cents;
    }
    profitByKey[key] = (profitByKey[key] || 0) + row.profit_cents;
    ensureCat(row.category).profit_cents += row.profit_cents;
  }

  let cost_cents = 0;
  let market_cents = 0;
  for (const it of items) {
    if (it.quantity_on_hand <= 0) continue;
    const c = it.quantity_on_hand * it.unit_cost_cents;
    const m = it.quantity_on_hand * it.market_value_cents;
    cost_cents += c;
    market_cents += m;
    ensureCat(it.category).inventory_cost_cents += c;
    ensureCat(it.category).inventory_market_cents += m;
  }

  return { revenueByKey, profitByKey, inventory: { cost_cents, market_cents }, byCategory };
}
