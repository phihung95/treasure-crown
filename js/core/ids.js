export function formatId(prefix, n) {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function makeCounter(initial = {}) {
  const counts = { ...initial };
  return {
    next(prefix) {
      counts[prefix] = (counts[prefix] || 0) + 1;
      return formatId(prefix, counts[prefix]);
    },
    snapshot() {
      return { ...counts };
    },
  };
}
