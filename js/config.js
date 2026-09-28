/**
 * config.js — costanti ateneo e della PWA.
 * Valori verificati sul campo (vedi AGENT.md §2).
 */
const CONFIG = {
  // API Cineca "University Planner" (CORS aperto)
  apiBase: 'https://unich.prod.up.cineca.it/api',
  dominio: 'unich.prod.up.cineca.it',
  // clienteId del sito Cineca: lo si ottiene da /api/Clienti/cercaPerDominio
  // ma è stabile, quindi lo teniamo come default e lo rivalidiamo a runtime.
  clienteIdDefault: '5a65a9ebd9fe4f6d0ccf9df6',
  clienteCodice: 'unich',

  // Sorgente della gerarchia (scraping via proxy)
  catalogoUrl: 'https://www.unich.it/didattica/frequentare/calendario-lezioni',

  // Proxy CORS: Cloudflare Worker (codice in worker/worker.js, deploy nelle note).
  // www.unich.it non invia header CORS → il Worker fa da ponte (allowlist unich.it).
  //   GET <workerBase>/?url=<url codificata>
  // Lo stesso Worker espone anche il push: /subscribe, /unsubscribe, /vapid
  // e un cron ogni 15 min (promemoria + cambi calendario). Richiede che in
  // js/config.js la chiave sotto coincide con il secret VAPID del Worker.
  workerBase: 'https://unich-proxy.unich.workers.dev',
  proxy: (url) => `${CONFIG.workerBase}/?url=${encodeURIComponent(url)}`,

  // Chiave pubblica VAPID (rigenerabile con: node scripts/gen-vapid.mjs).
  vapidPublicKey: 'BIGT-2PCL-yPuN9PQ-IgxxTjqAMrcem8iRMVKmS_aPS24PzU0XczbiYyAhn69W66eVAGEMoJT9yC4vfheSzH5sc',

  // Ritardo tra le richieste al proxy (comunque < rate limit del Worker).
  proxyDelayMs: 3200,
  proxyMaxRetry: 3,

  // Numero di colori fissi nella palette materie (--mat-0..N-1, css/app.css),
  // generati da scripts/gen-palette.mjs con variante light/dark.
  numColori: 50,

  // Notifiche: promemoria 15 min prima, finestra di programmazione 3 giorni.
  anticipoNotificaMs: 15 * 60 * 1000,
  orizzonteNotificheMs: 3 * 24 * 60 * 60 * 1000,
};

/** Chiavi localStorage, versionate per poter invalidare la cache in futuro. */
const KEYS = {
  version: 'unich:v1',
  stato: 'unich:v1:stato',       // scelte utente + preferenze
  indice: 'unich:v1:indice',     // gerarchia Polo → Struttura → Corso
  anni: 'unich:v1:anni',         // anni/percorsi risolti per singolo corso
  cache: 'unich:v1:cache',       // lezioni per linkCalendarioId
  tema: 'unich:v1:tema',
};

/** Range di default: anno accademico corrente (ago → ago successivo). */
function annoAccademicoCorrente(oggi = new Date()) {
  // L'anno accademico inizia a settembre; cambiando mese di ottobre (indice 9)
  // si è già nell'anno accademico successivo.
  const y = oggi.getMonth() >= 8 ? oggi.getFullYear() : oggi.getFullYear() - 1;
  return { da: new Date(y, 7, 1), a: new Date(y + 1, 8, 30) };
}
