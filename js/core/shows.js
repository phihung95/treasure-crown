// Roll up everything that happened at each show/event: what you sold, what you
// bought, trades, a payment-method split, and the net cash you walked away with.
export function reportByShow({ sales = [], purchases = [], trades = [] }) {
  const map = new Map();
  const get = (event) => {
    const key = event || '(no show)';
    if (!map.has(key)) {
      map.set(key, {
        event: key,
        sold: { lines: 0, units: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
        // Dice-challenge rolls are a subset of `sold`, broken out for tracking.
        dice: { rolls: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
        bought: { items: 0, spent_cents: 0, market_cents: 0, gain_cents: 0 },
        traded: { count: 0, profit_cents: 0, cash_in_cents: 0, cash_out_cents: 0 },
        by_payment: {},
        first_date: null,
        last_date: null,
      });
    }
    return map.get(key);
  };
  const stamp = (r, date) => {
    if (!date) return;
    if (!r.first_date || date < r.first_date) r.first_date = date;
    if (!r.last_date || date > r.last_date) r.last_date = date;
  };

  for (const s of sales) {
    const r = get(s.event);
    stamp(r, s.date);
    if (s.type === 'sale') {
      r.sold.lines += 1;
      r.sold.units += s.quantity || 0;
      r.sold.revenue_cents += s.revenue_cents || 0;
      r.sold.cost_cents += s.cost_cents || 0;
      r.sold.profit_cents += s.profit_cents || 0;
      if (s.payment_method) r.by_payment[s.payment_method] = (r.by_payment[s.payment_method] || 0) + (s.revenue_cents || 0);
      if (s.channel === 'dice') {
        r.dice.rolls += 1;
        r.dice.revenue_cents += s.revenue_cents || 0;
        r.dice.cost_cents += s.cost_cents || 0;
        r.dice.profit_cents += s.profit_cents || 0;
      }
    }
  }
  for (const p of purchases) {
    const r = get(p.event);
    stamp(r, p.date);
    r.bought.items += p.item_count || 0;
    r.bought.spent_cents += p.lot_total_cents || 0;
    r.bought.market_cents += p.market_total_cents || 0;
    // Only credit a below-market gain when the market value was recorded, so a
    // legacy purchase without it doesn't read as if you overpaid by the full price.
    if (p.market_total_cents) r.bought.gain_cents += p.market_total_cents - (p.lot_total_cents || 0);
  }
  for (const t of trades) {
    const r = get(t.event);
    stamp(r, t.date);
    r.traded.count += 1;
    r.traded.profit_cents += t.trade_profit_cents || 0;
    if (t.cash_direction === 'i_pay') r.traded.cash_out_cents += t.cash_cents || 0;
    else r.traded.cash_in_cents += t.cash_cents || 0;
  }

  const rows = [...map.values()].map((r) => ({
    ...r,
    net_cash_cents: r.sold.revenue_cents - r.bought.spent_cents + r.traded.cash_in_cents - r.traded.cash_out_cents,
    // How much the business grew in worth: realized sale profit + the paper gain
    // from buying below market + trade profit.
    value_added_cents: r.sold.profit_cents + r.bought.gain_cents + r.traded.profit_cents,
  }));
  rows.sort((a, b) => String(b.last_date || '').localeCompare(String(a.last_date || '')) || String(a.event).localeCompare(String(b.event)));
  return rows;
}
