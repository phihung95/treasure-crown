import { openStore } from '../data/store.js';
import { createApi } from '../data/api.js';
import { createSync } from '../data/sync.js';

const ROUTES = ['dashboard', 'inventory', 'buy', 'sell', 'trade', 'prints', 'settings'];

function setPill(state, text) {
  const pill = document.getElementById('sync-pill');
  pill.className = `pill ${state}`;
  pill.textContent = text;
}

async function boot() {
  const store = await openStore();
  let settings = await store.getSettings();
  const api = createApi({ url: settings.backend_url, token: settings.backend_token });
  const sync = createSync({ store, api });

  const ctx = {
    store, sync, api,
    get settings() { return settings; },
    async reloadSettings() { settings = await store.getSettings(); return settings; },
    toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.hidden = false;
      clearTimeout(ctx._tt); ctx._tt = setTimeout(() => { t.hidden = true; }, 1800);
    },
    async syncNow() {
      if (!settings.backend_url) { setPill('pending', 'local'); return; }
      try {
        setPill('pending', 'sync…');
        await sync.flush();
        setPill('ok', 'synced');
      } catch (e) { setPill('err', 'offline'); }
    },
    refresh() { route(); },
  };
  window.__tcc = ctx;

  if (settings.backend_url) {
    try {
      await sync.flush();      // push any changes queued offline last session first
      await sync.pull();       // then refresh local from the Sheet
      setPill('ok', 'synced');
    } catch { setPill('err', 'offline'); }
  } else { setPill('pending', 'local'); }

  async function route() {
    const name = (location.hash.replace('#/', '') || 'dashboard');
    const screen = ROUTES.includes(name) ? name : 'dashboard';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${screen}`);
    });
    const root = document.getElementById('screen');
    root.innerHTML = '';
    const mod = await import(`./screens/${screen}.js`);
    await mod.render(root, ctx);
  }

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/dashboard';
  await route();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
