/**
 * sw.js — service worker (PWA).
 *
 * 1) Cache app shell: cache-first con refresh in background.
 * 2) Dati remoti (API Cineca / proxy): network-first con fallback in cache.
 * 3) WEB PUSH: il Worker invia i payload JSON
 *      { type:'reminder'|'changed', title, body, cals:[...], tag }
 *    - notifichiamo sempre (recapito anche ad app chiusa: è il browser che
 *      sveglia il SW);
 *    - su 'changed' salviamo il meta in IndexedDB ('unich-push'.'meta'.'lastChange')
 *      e avvisiamo i client aperti (postMessage) così l'app si auto-rinfresca.
 *    I vecchi timer locali sono rimossi: il promemoria lo decide il server.
 */
const VERSIONE = 'unich-v18';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/vendor/alpine.min.js',
  './js/config.js',
  './js/version.js',
  './js/store.js',
  './js/api.js',
  './js/scraper.js',
  './js/calendar.js',
  './js/notify.js',
  './js/app.js',
  './icons/favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ------------------------------- meta DB -------------------------------- */

function metaDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('unich-push', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('meta');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function segnaCambio(cals) {
  try {
    const db = await metaDb();
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const prev = await new Promise((res) => {
      const g = store.get('lastChange');
      g.onsuccess = () => res(g.result); g.onerror = () => res(null);
    }) || { cals: [] };
    store.put({ at: Date.now(), cals: [...new Set((prev.cals || []).concat(cals || []))] }, 'lastChange');
    await new Promise((res) => { tx.oncomplete = res; tx.onabort = res; });
  } catch (e) {
    console.warn('[sw] segnaCambio', e?.message);
  }
}

/* ------------------------------ lifecycle ------------------------------- */

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* -------------------------------- push ---------------------------------- */

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Lezioni Ud’A', body: e.data?.text() || '' }; }
  const title = d.title || 'Lezioni Ud’A';
  const body = d.body || '';

  e.waitUntil((async () => {
    if (d.type === 'changed') {
      await segnaCambio(d.cals);
      const client = await self.clients.matchAll({ type: 'window' });
      client.forEach((c) => c.postMessage({ type: 'unich:changed', cals: d.cals || [] }));
    }
    await self.registration.showNotification(title, {
      body,
      tag: d.tag || (d.type === 'changed' ? 'unich-changed' : 'unich-reminder'),
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { cals: d.cals || [] },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((cs) => {
        const finestra = cs.find((c) => 'focus' in c);
        if (finestra) return finestra.focus();
        return self.clients.openWindow('./');
      })
  );
});

/* -------------------------------- fetch --------------------------------- */

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(request).then((hit) => {
        const fetchNuovo = fetch(request)
          .then((res) => {
            if (res.ok) caches.open(VERSIONE).then((c) => c.put(request, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || fetchNuovo;
      })
    );
    return;
  }

  // API/proxy: network-first, cache come riserva offline.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(VERSIONE).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request))
  );
});
