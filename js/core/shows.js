// Roll up everything that happened at each show/event: what you sold, what you
// bought, trades, a payment-method split, and the net cash you walked away with.
// Multi-day shows (same name across dates) also get a per-day breakdown.
export function reportByShow({ sales = [], purchases = [], trades = [] }) {
  const emptyBuckets = () => ({
    sold: { lines: 0, units: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
    // Dice-challenge rolls are a subset of `sold`, broken out for tracking.
    dice: { rolls: 0, revenue_cents: 0, cost_cents: 0, profit_cents: 0 },
    bought: { items: 0, spent_cents: 0, market_cents: 0, gain_cents: 0 },
    traded: { count: 0, profit_cents: 0, cash_in_cents: 0, cash_out_cents: 0 },
  });

  const addSale = (b, s) => {
    b.sold.lines += 1;
    b.sold.units += s.quantity || 0;
    b.sold.revenue_cents += s.revenue_cents || 0;
    b.sold.cost_cents += s.cost_cents || 0;
    b.sold.profit_cents += s.profit_cents || 0;
    if (s.channel === 'dice') {
      b.dice.rolls += 1;
      b.dice.revenue_cents += s.revenue_cents || 0;
      b.dice.cost_cents += s.cost_cents || 0;
      b.dice.profit_cents += s.profit_cents || 0;
    }
  };
  const addPurchase = (b, p) => {
    b.bought.items += p.item_count || 0;
    b.bought.spent_cents += p.lot_total_cents || 0;
    b.bought.market_cents += p.market_total_cents || 0;
    // Only credit a below-market gain when the market value was recorded, so a
    // legacy purchase without it doesn't read as if you overpaid by the full price.
    if (p.market_total_cents) b.bought.gain_cents += p.market_total_cents - (p.lot_total_cents || 0);
  };
  const addTrade = (b, t) => {
    b.traded.count += 1;
    b.traded.profit_cents += t.trade_profit_cents || 0;
    if (t.cash_direction === 'i_pay') b.traded.cash_out_cents += t.cash_cents || 0;
    else b.traded.cash_in_cents += t.cash_cents || 0;
  };

  const map = new Map();
  const get = (event) => {
    const key = event || '(no show)';
    if (!map.has(key)) map.set(key, { event: key, ...emptyBuckets(), by_payment: {}, by_date: new Map(), first_date: null, last_date: null });
    return map.get(key);
  };
  const getDay = (r, date) => {
    const d = date || '(no date)';
    if (!r.by_date.has(d)) r.by_date.set(d, { date: d, ...emptyBuckets() });
    return r.by_date.get(d);
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
      addSale(r, s);
      addSale(getDay(r, s.date), s);
      if (s.payment_method) r.by_payment[s.payment_method] = (r.by_payment[s.payment_method] || 0) + (s.revenue_cents || 0);
    }
  }
  for (const p of purchases) {
    const r = get(p.event);
    stamp(r, p.date);
    addPurchase(r, p);
    addPurchase(getDay(r, p.date), p);
  }
  for (const t of trades) {
    const r = get(t.event);
    stamp(r, t.date);
    addTrade(r, t);
    addTrade(getDay(r, t.date), t);
  }

  const withTotals = (b) => ({
    ...b,
    net_cash_cents: b.sold.revenue_cents - b.bought.spent_cents + b.traded.cash_in_cents - b.traded.cash_out_cents,
    // How much the business grew in worth: realized sale profit + the paper gain
    // from buying below market + trade profit.
    value_added_cents: b.sold.profit_cents + b.bought.gain_cents + b.traded.profit_cents,
  });

  const rows = [...map.values()].map((r) => {
    const { by_date, ...rest } = r;
    const days = [...by_date.values()].map(withTotals).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { ...withTotals(rest), days };
  });
  rows.sort((a, b) => String(b.last_date || '').localeCompare(String(a.last_date || '')) || String(a.event).localeCompare(String(b.event)));
  return rows;
}
