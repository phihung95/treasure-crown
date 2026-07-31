export function createApi({ url, token, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  async function call(payload) {
    if (!url) throw new Error('backend not configured');
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, ...payload }),
    });
    if (!res.ok) throw new Error(`backend error: ${res.status}`);
    return res.json();
  }
  return {
    pull() { return call({ action: 'pull' }); },
    push(ops) { return call({ action: 'push', ops }); },
  };
}
