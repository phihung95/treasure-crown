// Distinct show / event names to suggest in the Buy/Sell/Trade show box —
// gathered from actual synced transactions (sales, purchases, trades) plus this
// device's saved list. Because the transactions are the same on every device,
// all devices suggest the same names, so multi-day / two-person shows stay
// tagged consistently and roll up together.
import { SOURCE_PRESETS } from './sources.js';

export async function showNames(store, settings) {
  const set = new Set((settings.events || []).filter(Boolean));
  for (const tab of ['sales', 'purchases', 'trades']) {
    for (const row of await store.getAll(tab)) {
      if (row.event) set.add(row.event);
    }
  }
  // Offer common online/local sources as quick-picks even before they're used.
  for (const name of Object.keys(SOURCE_PRESETS)) set.add(name);
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
}
