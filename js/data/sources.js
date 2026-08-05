// A "source" is where a deal happened — an in-person card show, an online
// marketplace, a local pickup, etc. Internally it's still the transaction's
// `event` string; a source just adds a *type* on top so the app can tailor the
// view (in-person shows get a cash drawer; online sources don't).
//
// Types are stored per-name in local settings (`source_types`), so no schema
// change is needed. Cross-device this is best-effort until it's promoted to a
// synced table alongside the other backend work.
export const SOURCE_TYPES = [
  ['show', 'In-person show'],
  ['online', 'Online'],
  ['local', 'Local / pickup'],
  ['other', 'Other'],
];

// Common online/local sources offered as quick-picks, pre-typed so a fresh pick
// already behaves right (no cash drawer for an online marketplace).
export const SOURCE_PRESETS = {
  'Facebook Marketplace': 'online',
  'eBay': 'online',
  'Whatnot': 'online',
  'Local pickup': 'local',
};

// A source's type: an explicit user choice wins, then a preset default, then
// 'show' — so every existing show keeps its day breakdown and cash drawer.
export function sourceType(name, settings) {
  const map = (settings && settings.source_types) || {};
  return map[name] || SOURCE_PRESETS[name] || 'show';
}

export function sourceTypeLabel(type) {
  const f = SOURCE_TYPES.find(([k]) => k === type);
  return f ? f[1] : 'In-person show';
}

// Physical shows get the cash-drawer reconcile; online/local/other don't.
export function hasCashDrawer(type) {
  return type === 'show';
}
