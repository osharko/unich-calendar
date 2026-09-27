/**
 * sw.js — service worker (PWA).
 * Strategia:
 *  - App shell (HTML/CSS/JS/icone): cache-first, aggiornata in background.
 *  - API Cineca e proxy di scraping: network-first con fallback in cache.
 * I dati utente (scelte, catalogo, lezioni) stanno in localStorage,
 * quindi restano disponibili offline a prescindere.
 */
const VERSIONE = 'unich-v4';
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
  './js/app.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      // addAll fallisce se un file manca: aggiungo singolarmente e ignoro i buchi.
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

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // App shell: stesso origine.
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

  // Dati remoti (API Cineca / proxy): network-first, cache di riserva.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(VERSIONE).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request))
  );
});
