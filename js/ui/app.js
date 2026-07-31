import { openStore } from '../data/store.js';
import { createApi } from '../data/api.js';
import { createSync } from '../data/sync.js';

const ROUTES = ['dashboard', 'shows', 'inventory', 'buy', 'sell', 'trade', 'prints', 'settings'];

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
  const api = createApi({ url: settings.supabase_url, key: settings.supabase_key });
  const sync = createSync({ store, api });

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
      if (!settings.supabase_url) { setPill('local', n ? `Saved · ${n} local` : 'Saved locally'); return; }
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
    refresh() { route(); },
  };
  window.__tcc = ctx;

  if (settings.supabase_url) {
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
  if (pillEl) { pillEl.title = 'Tap to sync now'; pillEl.onclick = () => ctx.syncNow(); }

  async function route() {
    const name = (location.hash.replace('#/', '') || 'dashboard');
    const screen = ROUTES.includes(name) ? name : 'dashboard';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${screen}`);
    });
    const moreBtn = document.getElementById('tab-more');
    if (moreBtn) moreBtn.classList.toggle('active', ['shows', 'prints', 'settings'].includes(screen));
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
