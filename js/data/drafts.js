// Per-device draft persistence for the Buy / Sell / Trade builders. Drafts live
// in the local settings (meta) store — never synced — so an accidental reload,
// crash, or navigation at a show doesn't lose in-progress entries. Cleared once
// the entry is recorded.
export async function loadDraft(store, key) {
  const s = await store.getSettings();
  return s[`draft_${key}`] || null;
}
export async function saveDraft(store, key, data) {
  await store.setSettings({ [`draft_${key}`]: data });
}
export async function clearDraft(store, key) {
  await store.setSettings({ [`draft_${key}`]: null });
}
