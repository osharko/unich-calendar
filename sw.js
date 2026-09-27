/**
 * sw.js — service worker (PWA).
 *
 * 1) Cache app shell: cache-first, con refresh in background.
 * 2) Dati remoti (API Cineca / proxy): network-first con fallback in cache.
 * 3) Promemoria lezione: timer locali (15 min prima). L'app invia la lista con
 *    postMessage { type:'unich:promemoria', items:[{id,titolo,inizio,aula}] }.
 *    I timer sopravvivono finché il SW è vivo; alla riattivazione li ricostruiamo
 *    dall'IndexedDB. NB: recapito garantito AD APP CHIUSA richiederebbe Web Push
 *    da server (Cloudflare Cron): vedi AGENT.md §notifiche.
 */
const VERSIONE = 'unich-v7';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/vendor/alpine.min.js',
  './js/config.js',
  './js/store.js',
  './js/api.js',
  './js/scraper.js',
  './js/calendar.js',
  './js/notify.js',
  './js/app.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ------------------------- persistenza promemoria ------------------------ */

function apriDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('unich-notify', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('cfg');
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function salvaPromemoria(items) {
  const db = await apriDB();
  return new Promise((resolve) => {
    const tx = db.transaction('cfg', 'readwrite');
    tx.objectStore('cfg').put(items, 'lista');
    tx.oncomplete = tx.onabort = () => resolve();
  });
}
async function leggiPromemoria() {
  try {
    const db = await apriDB();
    return await new Promise((resolve) => {
      const rq = db.transaction('cfg', 'readonly').objectStore('cfg').get('lista');
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => resolve([]);
    });
  } catch { return []; }
}

/* ------------------------------- timer ---------------------------------- */

let timers = new Map();

function azzeraTimers() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

/** Programma i timer: fuoco = inizio - anticipo (min 1s da ora, se futuro). */
async function programma(items) {
  azzeraTimers();
  const ANTICIPO = 15 * 60 * 1000;
  const ORA = 24 * 60 * 60 * 1000; // setTimeout max ~24 giorni; oltre, rinvi
  const adesso = Date.now();
  for (const it of items) {
    const fuoco = new Date(it.inizio).getTime() - ANTICIPO;
    const attesa = fuoco - adesso;
    if (attesa < 0 || attesa > 2 ** 31 - 1) continue;
    timers.set(it.id, setTimeout(() => notificare(it), Math.max(1000, attesa)));
    void ORA;
  }
  await salvaPromemoria(items);
}

async function notificare(it) {
  const corpo = [
    new Date(it.inizio).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    it.aula ? `· ${it.aula}` : '',
  ].filter(Boolean).join(' ');
  await self.registration.showNotification(`Lezione tra 15 min: ${it.titolo}`, {
    body: corpo,
    tag: `lez-${it.id}`,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  });
}

/* ------------------------------- lifecycle ------------------------------ */

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
      // Ricostruisci i timer dal DB (SW appena ripartito).
      .then(async () => {
        const items = await leggiPromemoria();
        if (items.length) await programma(items);
      })
  );
});

self.addEventListener('message', (e) => {
  const d = e.data;
  if (d && d.type === 'unich:promemoria') e.waitUntil(programma(d.items || []));
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
