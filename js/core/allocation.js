import { allocateByWeights, splitEven, pctOfCents } from './money.js';

// Sum of each line's market value across its quantity.
export function marketTotalCents(lines) {
  return lines.reduce((s, l) => s + (l.market_value_cents || 0) * (l.quantity || 1), 0);
}

// Suggested buy/trade-in offer: a percentage of total market value (e.g. 80%).
export function suggestedOfferCents(lines, percent) {
  return pctOfCents(marketTotalCents(lines), percent);
}

// The items a purchase created (to remove when reversing/editing a buy).
export function reversePurchase({ purchase, items }) {
  const created = items.filter((i) => i.source_purchase_id === purchase.purchase_id);
  return { itemDeletes: created.map((i) => i.item_id) };
}

export function allocatePurchase({ lot_total_cents, lines, method }) {
  if (method === 'per_item') {
    return {
      method_used: 'per_item',
      fallback: false,
      lines: lines.map((l) => ({
        ...l,
        line_total_cents: l.entered_price_cents || 0,
        unit_cost_cents: Math.round((l.entered_price_cents || 0) / l.quantity),
      })),
    };
  }

  let method_used = method;
  let fallback = false;
  if (method === 'by_market') {
    const missing = lines.some((l) => !l.market_value_cents || l.market_value_cents <= 0);
    if (missing) { method_used = 'even'; fallback = true; }
  }

  let lineTotals;
  if (method_used === 'by_market') {
    const weights = lines.map((l) => l.market_value_cents * l.quantity);
    lineTotals = allocateByWeights(lot_total_cents, weights);
  } else {
    const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);
    const perUnit = splitEven(lot_total_cents, totalUnits);
    lineTotals = [];
    let cursor = 0;
    for (const l of lines) {
      let sum = 0;
      for (let u = 0; u < l.quantity; u += 1) { sum += perUnit[cursor]; cursor += 1; }
      lineTotals.push(sum);
    }
  }

  return {
    method_used,
    fallback,
    lines: lines.map((l, i) => ({
      ...l,
      line_total_cents: lineTotals[i],
      unit_cost_cents: Math.round(lineTotals[i] / l.quantity),
    })),
  };
}
