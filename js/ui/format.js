import { formatCents, toCents } from '../core/money.js';
export { formatCents };
export function dollarsToCents(str) {
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? toCents(n) : 0;
}
export function centsInputValue(cents) { return (Math.round(cents) / 100).toFixed(2); }
const CAT = { single: 'Single', slab: 'Slab', sealed: 'Sealed', print: '3D Print', other: 'Other' };
const PAY = { cash: 'Cash', zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App' };
export function catLabel(c) { return CAT[c] || c; }
export function payLabel(p) { return PAY[p] || p; }
