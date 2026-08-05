import { decrement } from './inventory.js';
import { newItem, deriveStatus } from './schema.js';

// Compute how to reverse a trade: put the given cards back on the shelf, and
// list the received items + give-sale rows to delete. The trade row itself is
// deleted by the caller. Does not check reversibility — the caller guards that
// none of the received items were already sold.
export function reverseTrade({ trade, sales, items }) {
  const giveSales = sales.filter((s) => s.trade_id === trade.trade_id && s.type === 'trade_give');
  const received = items.filter((i) => i.source_trade_id === trade.trade_id);
  const itemUpdates = [];
  for (const gs of giveSales) {
    const it = items.find((i) => i.item_id === gs.item_id);
    if (it) {
      const q = (it.quantity_on_hand || 0) + (gs.quantity || 0);
      itemUpdates.push({ ...it, quantity_on_hand: q, status: deriveStatus(q) });
    }
  }
  return { itemUpdates, itemDeletes: received.map((i) => i.item_id), saleDeletes: giveSales.map((s) => s.txn_id) };
}

export function reconcileTrade({ giveLines, getLines, cash_cents, cash_direction }) {
  const give_total_cents = giveLines.reduce((s, l) => s + l.agreed_value_cents * l.quantity, 0);
  const get_total_cents = getLines.reduce((s, l) => s + l.agreed_value_cents * l.quantity, 0);
  const cashToMe = cash_direction === 'customer_pays_me' ? cash_cents : 0;
  const cashFromMe = cash_direction === 'i_pay' ? cash_cents : 0;
  const delta_cents = (get_total_cents + cashToMe) - (give_total_cents + cashFromMe);
  return { give_total_cents, get_total_cents, delta_cents };
}

export function processTrade({ giveLines, getLines, cash_cents, cash_direction, date, event, notes }, ids) {
  const trade_id = ids.trade();
  const when = date || new Date().toISOString().slice(0, 10);
  const saleRows = [];
  const updatedItems = [];
  const newItems = [];

  for (const line of giveLines) {
    const updated = decrement(line.item, line.quantity);
    const revenue_cents = line.quantity * line.agreed_value_cents;
    const cost_cents = line.quantity * line.item.unit_cost_cents;
    saleRows.push({
      txn_id: ids.sale(),
      date: when,
      event: event || '',
      type: 'trade_give',
      trade_id,
      item_id: line.item.item_id,
      item_name: line.item.name,
      category: line.item.category,
      quantity: line.quantity,
      unit_price_cents: line.agreed_value_cents,
      unit_cost_cents: line.item.unit_cost_cents,
      revenue_cents,
      cost_cents,
      profit_cents: revenue_cents - cost_cents,
      payment_method: '',
      notes: notes || '',
    });
    updatedItems.push(updated);
  }

  for (const line of getLines) {
    newItems.push(newItem({
      ...line.fields,
      quantity_on_hand: line.quantity,
      unit_cost_cents: line.agreed_value_cents,
      // A card taken in keeps its full market value (what it's worth), so it
      // counts toward inventory/business value — its cost is the credited amount.
      // Fall back to the credited value if no market was recorded (never 0).
      market_value_cents: line.market_value_cents ?? line.agreed_value_cents,
      acquisition: 'traded_in',
      source_trade_id: trade_id,
      acquired_date: when,
    }, ids.item()));
  }

  const { give_total_cents, get_total_cents } = reconcileTrade({ giveLines, getLines, cash_cents, cash_direction });
  const tradeRow = {
    trade_id,
    date: when,
    event: event || '',
    give_total_cents,
    get_total_cents,
    cash_cents: cash_cents || 0,
    cash_direction: cash_direction || 'customer_pays_me',
    trade_profit_cents: saleRows.reduce((s, r) => s + r.profit_cents, 0),
    notes: notes || '',
  };

  return { tradeRow, saleRows, newItems, updatedItems };
}
