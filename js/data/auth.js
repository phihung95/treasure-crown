// Email + password auth via Supabase Auth (GoTrue) over plain fetch — no SDK.
// The session is persisted in settings so a reload stays signed in; the access
// token is refreshed when it nears expiry and used to authorize data requests.
export function createAuth({ url, key, store }) {
  const authBase = url ? `${url.replace(/\/+$/, '')}/auth/v1` : '';
  let session = null;

  async function load() {
    if (session) return session;
    const s = await store.getSettings();
    session = s.session || null;
    return session;
  }
  async function save(s) { session = s; await store.setSettings({ session: s }); }

  function toSession(data, prevEmail) {
    const expires_ms = data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000;
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_ms, email: (data.user && data.user.email) || prevEmail || '' };
  }

  async function refresh() {
    const cur = await load();
    if (!cur || !cur.refresh_token || !url) return null;
    const res = await fetch(`${authBase}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cur.refresh_token }),
    });
    if (!res.ok) return cur; // keep the (stale) session offline; a data 401 will re-prompt
    await save(toSession(await res.json(), cur.email));
    return session;
  }

  return {
    async signIn(email, password) {
      if (!url) throw new Error('Not connected — enter your Supabase URL and key first.');
      const res = await fetch(`${authBase}/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error_description || data.msg || data.error || 'Wrong email or password');
      await save(toSession(data));
      return session;
    },
    // Create a new account. If the project has email confirmation off, GoTrue
    // returns a session immediately (confirmed:true); otherwise the user must
    // confirm via email before signing in (confirmed:false).
    async signUp(email, password) {
      if (!url) throw new Error('Not connected — enter your Supabase URL and key first.');
      const res = await fetch(`${authBase}/signup`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error_description || data.msg || data.error || 'Could not create account');
      if (data.access_token) { await save(toSession(data)); return { confirmed: true }; }
      return { confirmed: false };
    },
    async restore() { return load(); },          // signed in on this device if a session exists
    async signOut() { await save(null); },
    async token() {
      const cur = await load();
      if (!cur) return null;
      if (cur.expires_ms && cur.expires_ms - Date.now() < 60000) { await refresh(); }
      return session ? session.access_token : null;
    },
    email() { return session ? session.email : null; },
  };
}
