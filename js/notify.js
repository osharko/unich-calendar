/**
 * notify.js — Web Push reale via Cloudflare Worker (push recapitato anche ad
 * app chiusa; sui sistemi "default" iOS/Android/desktop richiede PWA installata).
 *
 * Flusso: l'app, quando l'utente attiva la campanella, si iscrive via
 * pushManager e invia subscription + preferenze (calendari + materie visibili)
 * a <workerBase>/subscribe. Il cron del Worker calcola promemoria e cambi.
 *
 * Il service worker, ricevendo un push di tipo "changed", segna in IndexedDB
 * (db 'unich-push', chiave 'lastChange') quando è avvenuto: all'avvio l'app
 * confronta quel timestamp con l'età della cache e, se serve, aggiorna —
 * niente refresh periodici "alla cieca".
 */
/* CONFIG è globale: notify.js è un script classico caricato dopo config.js. */

/* --------------------------- capacità/contesto --------------------------- */

/** Web Push disponibile? (Notification + serviceWorker + PushManager) */
function pushDisponibile() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

/** L'app è in esecuzione come PWA installata? (trattamento uniforme dei OS) */
function pwaInstallata() {
  if (typeof window === 'undefined') return false;
  try { if (matchMedia('(display-mode: standalone)').matches) return true; } catch { /* x */ }
  if (navigator.standalone === true) return true;           // iOS
  return matchMedia('(display-mode: minimal-ui)').matches;  // alcuni Android
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
function statoPermesso() {
  return pushDisponibile() ? Notification.permission : 'unsupported';
}
async function chiediPermesso() {
  if (!pushDisponibile()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

/* ------------------------------ subscription ----------------------------- */

function b64uToUint8(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Attiva il push: subscribe + invio preferenze al Worker. */
async function pushAttiva(prefs) {
  const perm = await chiediPermesso();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Permesso notifiche negato: riattivalo dalle impostazioni del browser.'
    : 'Permesso notifiche non concesso.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToUint8(CONFIG.vapidPublicKey),
    });
  }
  await inviaPrefs(sub, prefs);
  return true;
}

/** Disattiva: disiscrive dal Worker e a livello locale. */
async function pushDisattiva() {
  const sub = await getSubscription();
  if (!sub) return;
  try {
    await fetch(`${CONFIG.workerBase}/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* il locale sotto basta */ }
  try { await sub.unsubscribe(); } catch { /* ignore */ }
}

/** Risincronizza le preferenze (calendari/materie) senza re-permettere nulla. */
async function pushSincronizzaPrefs(prefs) {
  const sub = await getSubscription();
  if (!sub) return;
  await inviaPrefs(sub, prefs);
}

async function inviaPrefs(sub, prefs) {
  const res = await fetch(`${CONFIG.workerBase}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), prefs }),
  });
  if (!res.ok) throw new Error(`subscribe HTTP ${res.status}`);
}

/* ------------------------- "c'è stato un cambio?" ------------------------ */

/**
 * Legge da IndexedDB il meta scritto dal service worker alla ricezione di un
 * push "changed". Restituisce { at, cals } o null.
 */
function leggiUltimoCambio() {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open('unich-push', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('meta');
      rq.onerror = () => resolve(null);
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          const g = db.transaction('meta', 'readonly').objectStore('meta').get('lastChange');
          g.onsuccess = () => resolve(g.result || null);
          g.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
