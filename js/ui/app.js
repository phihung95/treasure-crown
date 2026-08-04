import { openStore } from '../data/store.js';
import { createApi } from '../data/api.js';
import { createSync } from '../data/sync.js';
import { createAuth } from '../data/auth.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const ROUTES = ['dashboard', 'shows', 'inventory', 'buy', 'sell', 'trade', 'prints', 'expenses', 'cash', 'settings'];

// On the hosted site, talk to Supabase through our OWN domain (/api proxy)
// instead of supabase.co directly — some managed networks/MDM block the
// supabase.co domain but allow our app's domain. On localhost dev there's no
// proxy, so hit Supabase directly (that machine isn't blocked).
const IS_LOCALHOST = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
function apiBaseFor(supaUrl) {
  return IS_LOCALHOST ? supaUrl : `${location.origin}/api`;
}
const LOGIN_CROWN = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><defs><linearGradient id="lgc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6c565"/><stop offset="1" stop-color="#b8912f"/></linearGradient></defs><path fill="url(#lgc)" d="M2.4 8 6 11l6-6.6L18 11l3.6-3-1.7 9.4H4.1L2.4 8Z"/><rect x="4" y="19.2" width="16" height="2.4" rx="1.2" fill="#17130b"/></svg>`;
const lgEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Full-screen email + password sign-in. On a fresh device it also collects the
// Supabase URL + anon key so the operator can connect and sign in in one step.
function renderLogin(store, settings) {
  const needsConfig = !settings.supabase_url || !settings.supabase_key;
  const ov = document.createElement('div');
  ov.className = 'login-screen';
  ov.innerHTML = `
    <form class="login-card" id="lg-form" autocomplete="on">
      <div class="login-brand">${LOGIN_CROWN}<span>Treasure Crown</span></div>
      <div class="login-sub" id="lg-sub">Sign in to your account</div>
      <div id="lg-conn" ${needsConfig ? '' : 'hidden'}>
        <label>Supabase project URL</label>
        <input id="lg-url" value="${lgEsc(settings.supabase_url || '')}" placeholder="https://xxxx.supabase.co" autocomplete="off" />
        <label>Supabase anon key</label>
        <input id="lg-key" value="${lgEsc(settings.supabase_key || '')}" placeholder="eyJhbGciOi…" autocomplete="off" />
      </div>
      <div id="lg-shop-wrap" hidden>
        <label>Shop name</label>
        <input id="lg-shop" placeholder="My Card Shop" autocomplete="organization" />
      </div>
      <label>Email</label>
      <input id="lg-email" type="email" autocomplete="username" placeholder="you@example.com" />
      <label>Password</label>
      <input id="lg-pass" type="password" autocomplete="current-password" placeholder="••••••••" />
      <div class="login-err" id="lg-err" hidden></div>
      <div class="login-note" id="lg-note" hidden></div>
      <button class="btn" type="submit" id="lg-btn">Sign in</button>
      <button type="button" class="login-link" id="lg-switch">New here? Create an account</button>
      ${needsConfig ? '' : '<button type="button" class="login-link" id="lg-toggle">Change connection</button>'}
    </form>`;
  document.body.appendChild(ov);
  const $ = (s) => ov.querySelector(s);
  let mode = 'signin';
  const toggle = $('#lg-toggle');
  if (toggle) toggle.onclick = () => { $('#lg-conn').hidden = !$('#lg-conn').hidden; };

  const setMode = (m) => {
    mode = m;
    const up = m === 'signup';
    $('#lg-sub').textContent = up ? 'Create your account' : 'Sign in to your account';
    $('#lg-btn').textContent = up ? 'Create account' : 'Sign in';
    $('#lg-switch').textContent = up ? 'Have an account? Sign in' : 'New here? Create an account';
    $('#lg-shop-wrap').hidden = !up;
    $('#lg-pass').setAttribute('autocomplete', up ? 'new-password' : 'current-password');
    $('#lg-err').hidden = true;
  };
  $('#lg-switch').onclick = () => setMode(mode === 'signin' ? 'signup' : 'signin');

  $('#lg-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#lg-btn'); const err = $('#lg-err'); const note = $('#lg-note');
    err.hidden = true; note.hidden = true; btn.disabled = true;
    btn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      let url = settings.supabase_url; let key = settings.supabase_key;
      if ($('#lg-url')) {
        url = $('#lg-url').value.trim(); key = $('#lg-key').value.trim();
        await store.setSettings({ supabase_url: url, supabase_key: key });
      }
      const auth = createAuth({ url: apiBaseFor(url), key, store });
      const email = $('#lg-email').value.trim();
      const pass = $('#lg-pass').value;
      if (mode === 'signup') {
        const shop = $('#lg-shop').value.trim();
        await store.setSettings({ pending_shop_name: shop || 'My Shop' });
        const { confirmed } = await auth.signUp(email, pass);
        if (confirmed) { location.reload(); return; }
        note.textContent = 'Account created — check your email to confirm, then sign in.';
        note.hidden = false; setMode('signin'); btn.disabled = false; btn.textContent = 'Sign in';
        return;
      }
      await auth.signIn(email, pass);
      location.reload();
    } catch (ex) {
      err.textContent = ex.message || (mode === 'signup' ? 'Could not create account' : 'Sign in failed'); err.hidden = false;
      btn.disabled = false; btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  };
}

function setPill(state, text) {
  const pill = document.getElementById('sync-pill');
  pill.className = `pill ${state} tap`;
  pill.textContent = text;
}

// A backend error means the server rejected us (e.g. bad token) — actionable.
// Anything else (no network) is the expected, safe offline state: writes are queued.
function isServerError(e) { return String((e && e.message) || '').startsWith('backend error'); }

async function boot() {
  const store = await openStore();
  let settings = await store.getSettings();
  // Fall back to the app's built-in public connection so a fresh device only
  // needs email + password. The anon key is safe to ship; RLS guards the data.
  const supaUrl = settings.supabase_url || SUPABASE_URL;
  const supaKey = settings.supabase_key || SUPABASE_ANON_KEY;
  const base = apiBaseFor(supaUrl);
  const auth = createAuth({ url: base, key: supaKey, store });
  // The account this user belongs to; stamped onto every write so data lands in
  // (and is readable only within) their tenant. Cached in settings for offline boots.
  let currentAccountId = settings.account_id || null;
  const api = createApi({ url: base, key: supaKey, getToken: () => auth.token(), getAccountId: () => currentAccountId });
  const sync = createSync({ store, api });

  // The backend is always configured (built-in), so sign-in just needs the
  // operator's email + password; a fresh device goes straight to that.
  const session = await auth.restore();
  if (!supaUrl || !session) { renderLogin(store, { ...settings, supabase_url: supaUrl, supabase_key: supaKey }); return; }

  // Resolve the signed-in user's account. A brand-new user has none yet, so
  // provision one (their first sign-in creates their workspace). Do this BEFORE
  // any sync so reads/writes are correctly scoped. Offline: keep the cached id.
  try {
    const remote = await api.getMyAccount();
    if (remote) currentAccountId = remote;
    else if (!currentAccountId) currentAccountId = await api.provisionAccount(settings.pending_shop_name || 'My Shop');
  } catch { /* offline or transient — fall back to the cached account_id */ }
  if (currentAccountId && (currentAccountId !== settings.account_id || settings.pending_shop_name)) {
    await store.setSettings({ account_id: currentAccountId, pending_shop_name: '' });
    settings = await store.getSettings();
  }

  const pending = async () => { try { return (await store.getAll('queue')).length; } catch { return 0; } };

  const ctx = {
    store, sync, api,
    get settings() { return settings; },
    async reloadSettings() { settings = await store.getSettings(); return settings; },
    // Remember the show for next time and add it to the saved list if it's new.
    async setCurrentShow(event) {
      const ev = (event || '').trim();
      if (!ev) return;
      const evs = settings.events || [];
      await store.setSettings({ current_show: ev, events: evs.includes(ev) ? evs : [...evs, ev] });
      settings = await store.getSettings();
    },
    toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.hidden = false;
      clearTimeout(ctx._tt); ctx._tt = setTimeout(() => { t.hidden = true; }, 1800);
    },
    async syncNow() {
      const n = await pending();
      if (!supaUrl) { setPill('local', n ? `Saved · ${n} local` : 'Saved locally'); return; }
      try {
        setPill('pending', n ? `Syncing ${n}…` : 'Syncing…');
        await sync.flush();
        setPill('ok', 'Synced');
      } catch (e) {
        const left = await pending();
        // Data is safe locally either way; only a server rejection needs the user's attention.
        if (isServerError(e)) setPill('err', 'Sync error · tap to retry');
        else setPill('pending', left ? `Saved · ${left} to sync` : 'Offline · saved locally');
      }
    },
    // Two-way sync: push our changes, THEN pull everyone else's — so two devices
    // at the same show stay in agreement. Flush-before-pull keeps unsynced local
    // edits from being clobbered. Screens call this so reports reflect all devices.
    async reconcile() {
      if (!supaUrl) return;
      try {
        setPill('pending', 'Syncing…');
        await sync.flush();
        await sync.pull();
        setPill('ok', 'Synced');
      } catch (e) {
        const left = await pending();
        if (isServerError(e)) setPill('err', 'Sync error · tap to retry');
        else setPill('pending', left ? `Saved · ${left} to sync` : 'Offline · saved locally');
      }
    },
    refresh() { route(); },
    auth,
    async signOut() { await auth.signOut(); location.reload(); },
  };
  window.__tcc = ctx;

  if (supaUrl) {
    try {
      setPill('pending', 'Syncing…');
      await sync.flush();      // push any changes queued offline last session first
      await sync.pull();       // then refresh local from Supabase
      setPill('ok', 'Synced');
    } catch (e) {
      const left = await pending();
      if (isServerError(e)) setPill('err', 'Sync error · tap to retry');
      else setPill('pending', left ? `Saved · ${left} to sync` : 'Offline · saved locally');
    }
  } else {
    const n = await pending();
    setPill('local', n ? `Saved · ${n} local` : 'Saved locally');
  }

  const pillEl = document.getElementById('sync-pill');
  if (pillEl) { pillEl.title = 'Tap to sync all devices'; pillEl.onclick = async () => { await ctx.reconcile(); route(); }; }

  // When the app comes back to the foreground (reopened / tab refocused), pull
  // the latest so a device that sat idle doesn't show stale numbers.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') { await ctx.reconcile(); route(); }
  });

  async function route() {
    const name = (location.hash.replace('#/', '') || 'dashboard');
    const screen = ROUTES.includes(name) ? name : 'dashboard';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${screen}`);
    });
    const moreBtn = document.getElementById('tab-more');
    if (moreBtn) moreBtn.classList.toggle('active', ['shows', 'cash', 'expenses', 'prints', 'settings'].includes(screen));
    const sheet = document.getElementById('more-sheet');
    if (sheet) sheet.hidden = true;
    const root = document.getElementById('screen');
    root.innerHTML = '';
    const mod = await import(`./screens/${screen}.js`);
    await mod.render(root, ctx);
  }

  window.addEventListener('hashchange', route);

  const moreBtn = document.getElementById('tab-more');
  const moreSheet = document.getElementById('more-sheet');
  if (moreBtn && moreSheet) {
    moreBtn.onclick = () => { moreSheet.hidden = !moreSheet.hidden; };
    moreSheet.onclick = (e) => { if (e.target === moreSheet) moreSheet.hidden = true; };
  }

  if (!location.hash) location.hash = '#/dashboard';
  await route();
}

boot();

// Register the offline service worker on real hosts only. On localhost it just
// serves stale cached modules and fights iterative development, so skip it there.
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
if ('serviceWorker' in navigator && !IS_LOCAL) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
