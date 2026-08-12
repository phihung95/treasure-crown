// A realistic sample shop for demoing the app — inventory, sales, a trade, buys,
// and expenses across a couple of sources. Loaded into a fresh DEMO account only
// (never a real one). `ids` is a makeIds() result so every row gets a proper id.
import { newItem } from '../core/schema.js';

const SHOW = 'Community Card Show';

export function buildDemoData(ids) {
  const it = (f) => newItem(f, ids.item());

  // A card taken in via the demo trade (linked to the trade below).
  const tradeId = ids.trade();

  const items = [
    it({ category: 'single', name: 'Charizard ex', set: 'Obsidian Flames', card_number: '223/197', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 8000, market_value_cents: 12000, acquired_date: '2026-08-02' }),
    it({ category: 'single', name: 'Umbreon VMAX (Alt Art)', set: 'Evolving Skies', card_number: '215/203', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 32000, market_value_cents: 45000 }),
    it({ category: 'single', name: 'Miraidon ex', set: 'Paradox Rift', card_number: '244/182', condition: 'NM', quantity_on_hand: 2, unit_cost_cents: 1500, market_value_cents: 2200 }),
    it({ category: 'single', name: 'Gengar ex', set: 'Pokémon 151', card_number: '109/165', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 1000, market_value_cents: 1800 }),
    it({ category: 'slab', name: 'Charizard', set: 'Base Set', card_number: '4/102', grade: 'PSA 9', grader: 'PSA', quantity_on_hand: 1, unit_cost_cents: 40000, market_value_cents: 55000 }),
    it({ category: 'sealed', name: 'Prismatic Evolutions Elite Trainer Box', quantity_on_hand: 3, unit_cost_cents: 5000, market_value_cents: 8000 }),
    it({ category: 'sealed', name: 'Surging Sparks Booster Box', quantity_on_hand: 1, unit_cost_cents: 9000, market_value_cents: 13000 }),
    it({ category: 'single', name: 'Monkey D. Luffy (Leader)', set: 'OP-01 Romance Dawn', card_number: 'OP01-001', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 6000, market_value_cents: 9000 }),
    it({ category: 'single', name: 'Roronoa Zoro', set: 'OP-01 Romance Dawn', card_number: 'OP01-025', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 2000, market_value_cents: 3500 }),
    it({ category: 'single', name: 'Nami', set: 'OP-01 Romance Dawn', card_number: 'OP01-016', condition: 'LP', quantity_on_hand: 3, unit_cost_cents: 800, market_value_cents: 1500 }),
    it({ category: 'single', name: 'Pikachu', set: 'Base Set', card_number: '58/102', condition: 'LP', quantity_on_hand: 4, unit_cost_cents: 400, market_value_cents: 1000 }),
    it({ category: 'single', name: 'Sylveon ex (traded in)', set: 'Prismatic Evolutions', card_number: '156/131', condition: 'NM', quantity_on_hand: 1, unit_cost_cents: 8500, market_value_cents: 10000, acquisition: 'traded_in', source_trade_id: tradeId, acquired_date: '2026-08-02' }),
  ];

  const sale = (name, category, qty, price, cost, method, date, event) => ({
    txn_id: ids.sale(), date, event, type: 'sale', trade_id: '', item_id: '', item_name: name, category,
    quantity: qty, unit_price_cents: price, unit_cost_cents: cost, revenue_cents: price * qty, cost_cents: cost * qty,
    profit_cents: (price - cost) * qty, payment_method: method, notes: '',
  });
  const sales = [
    sale('Pikachu', 'single', 1, 1500, 400, 'cash', '2026-08-02', SHOW),
    sale('Nami', 'single', 2, 1800, 800, 'zelle', '2026-08-02', SHOW),
    sale('Gengar ex', 'single', 1, 2500, 1000, 'cash', '2026-08-02', SHOW),
    sale('Roronoa Zoro', 'single', 1, 4000, 2000, 'cashapp', '2026-08-03', SHOW),
    sale('Miraidon ex', 'single', 1, 2500, 1500, 'cash', '2026-08-08', 'Facebook Marketplace'),
    // The give side of the demo trade below (a sale of type trade_give).
    { txn_id: ids.sale(), date: '2026-08-02', event: SHOW, type: 'trade_give', trade_id: tradeId, item_id: '', item_name: 'Blastoise ex', category: 'single', quantity: 1, unit_price_cents: 12000, unit_cost_cents: 8000, revenue_cents: 12000, cost_cents: 8000, profit_cents: 4000, payment_method: '', notes: 'demo trade' },
  ];

  const purchases = [
    { purchase_id: ids.purchase(), date: '2026-08-02', event: SHOW, lot_total_cents: 20000, market_total_cents: 26000, payment_method: 'cash', allocation_method: 'by_market', item_count: 5, notes: 'collection lot · demo' },
    { purchase_id: ids.purchase(), date: '2026-08-03', event: SHOW, lot_total_cents: 8000, market_total_cents: 10500, payment_method: 'zelle', allocation_method: 'by_market', item_count: 3, notes: 'demo lot' },
  ];

  const trades = [
    { trade_id: tradeId, date: '2026-08-02', event: SHOW, give_total_cents: 12000, get_total_cents: 8500, cash_cents: 3500, cash_direction: 'customer_pays_me', trade_profit_cents: 4000, notes: 'credit 85% of market · demo' },
  ];

  const expenses = [
    { expense_id: ids.expense(), date: '2026-08-02', amount_cents: 5000, category: 'booth', note: 'Table fee', event: SHOW },
    { expense_id: ids.expense(), date: '2026-08-02', amount_cents: 3000, category: 'supplies', note: 'Sleeves + toploaders', event: SHOW },
  ];

  return { items, sales, purchases, trades, expenses };
}
