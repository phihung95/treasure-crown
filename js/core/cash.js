// Physical cash that flowed through recorded transactions — CASH payments only
// (Zelle/Venmo/etc. don't change the cash box). Cash sales add; cash buys and
// cash paid out on trades subtract; cash taken in on trades adds. Pass `event`
// to scope it to a single show.
export function transactionCashCents({ sales = [], purchases = [], trades = [] }, event) {
  const match = (e) => event == null || (e || '') === event;
  let c = 0;
  for (const s of sales) if (s.type === 'sale' && s.payment_method === 'cash' && match(s.event)) c += s.revenue_cents || 0;
  for (const p of purchases) if (p.payment_method === 'cash' && match(p.event)) c -= p.lot_total_cents || 0;
  for (const t of trades) {
    if (!match(t.event)) continue;
    if (t.cash_direction === 'i_pay') c -= t.cash_cents || 0; // I paid cash out
    else c += t.cash_cents || 0;                              // customer paid me cash
  }
  return c;
}

// Manual adjustments: opening float + cash added − cash removed (deposits).
export function manualCashCents(cashEvents = []) {
  let c = 0;
  for (const ev of cashEvents) {
    const amt = ev.amount_cents || 0;
    c += ev.kind === 'remove' ? -amt : amt; // 'open' / 'add' add; 'remove' subtracts
  }
  return c;
}

// Total cash on hand right now: what the app has tracked + your manual adjustments.
export function cashOnHand({ sales, purchases, trades, cashEvents }) {
  return transactionCashCents({ sales, purchases, trades }) + manualCashCents(cashEvents);
}

// Money the business holds from trading, across ALL payment methods (cash, Zelle,
// Cash App, …) plus manual cash adjustments — not just physical cash. Every sale
// adds its full proceeds, buys and cash paid out on trades subtract, cash taken in
// on trades adds. Pair with inventory-at-market for a business value that never
// drops when you sell (the item leaves inventory but its money is added back here).
export function moneyHeldCents({ sales = [], purchases = [], trades = [], cashEvents = [] }) {
  let m = 0;
  for (const s of sales) if (s.type === 'sale') m += s.revenue_cents || 0;
  for (const p of purchases) m -= p.lot_total_cents || 0;
  for (const t of trades) {
    if (t.cash_direction === 'i_pay') m -= t.cash_cents || 0; // I paid cash out
    else m += t.cash_cents || 0;                              // customer paid me cash
  }
  return m + manualCashCents(cashEvents);
}
