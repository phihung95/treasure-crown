import { reportByShow } from './shows.js';

// Roll up all business activity whose date falls in [start, end] (inclusive,
// 'YYYY-MM-DD' strings), across every show, into one set of totals — the flows
// behind the dashboard's period view (sold / bought / traded / value added /
// net cash / expenses). Snapshot figures (inventory value) are handled elsewhere
// since they describe "now", not a window. Pure: the caller computes the range.
export function aggregatePeriod({ sales = [], purchases = [], trades = [], expenses = [], start, end }) {
  const inRange = (d) => !!d && (!start || d >= start) && (!end || d <= end);
  const rows = reportByShow({
    sales: sales.filter((s) => inRange(s.date)),
    purchases: purchases.filter((p) => inRange(p.date)),
    trades: trades.filter((t) => inRange(t.date)),
  });
  const acc = {
    sold: { lines: 0, units: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
    dice: { rolls: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
    bought: { items: 0, spent_cents: 0, market_cents: 0, gain_cents: 0 },
    traded: { count: 0, profit_cents: 0, cash_in_cents: 0, cash_out_cents: 0 },
    net_cash_cents: 0, value_added_cents: 0,
  };
  for (const r of rows) {
    for (const k of ['sold', 'dice', 'bought', 'traded']) for (const f of Object.keys(acc[k])) acc[k][f] += r[k][f];
    acc.net_cash_cents += r.net_cash_cents;
    acc.value_added_cents += r.value_added_cents;
  }
  acc.expenses_cents = expenses.filter((e) => inRange(e.date)).reduce((s, e) => s + (e.amount_cents || 0), 0);
  acc.shows = rows.length;
  return acc;
}

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
