export function toCents(dollars) {
  return Math.round((Number(dollars) + Number.EPSILON) * 100);
}

export function fromCents(cents) {
  return Math.round(cents) / 100;
}

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${rem}`;
}

export function allocateByWeights(totalCents, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return splitEven(totalCents, n);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let remainder = totalCents - out.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (b.w - a.w) || (b.i - a.i));
  let k = 0;
  while (remainder > 0) {
    out[order[k % n].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return out;
}

export function splitEven(totalCents, n) {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const out = new Array(n).fill(base);
  let remainder = totalCents - base * n;
  for (let i = 0; i < n && remainder > 0; i += 1) {
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}
