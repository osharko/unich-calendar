/**
 * store.js — persistenza su localStorage.
 * Contiene: preferenze utente, indice dei corsi, anni risolti per corso,
 * cache delle lezioni.
 *
 * Chiavi:
 *   unich:v1:stato     preferenze e calendari scelti
 *   unich:v1:indice    gerarchia Polo → Struttura → Corso (da unich.it)
 *   unich:v1:anni      { [urlCorso]: [{etichetta, linkCalendarioId, anno}] }
 *   unich:v1:cache     { [linkCalendarioId]: { aggiornatoIl, lezioni } }
 */

function leggi(chiave, fallback) {
  try {
    const raw = localStorage.getItem(chiave);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function scrivi(chiave, valore) {
  try {
    localStorage.setItem(chiave, JSON.stringify(valore));
    return true;
  } catch (e) {
    // Quota superata: tipico con la cache lezioni. Non deve rompere l'app.
    console.warn('[store] scrittura fallita', chiave, e?.name);
    return false;
  }
}

const store = {
  /* ------------------------------ stato ------------------------------ */
  statoDefault: () => ({
    selezioni: [],          // [{ linkCalendarioId, etichetta, corso, anno, colore, attivo }]
    vista: 'settimana',     // settimana | mese
    nascondiAnnullati: true,
  }),
  getStato() { return leggi(KEYS.stato, store.statoDefault()); },
  setStato(s) { return scrivi(KEYS.stato, s); },

  /* ------------------------------ indice ----------------------------- */
  getIndice() { return leggi(KEYS.indice, null); },
  setIndice(i) { return scrivi(KEYS.indice, i); },

  /* ------------------------------- anni ------------------------------ */
  getAnni() { return leggi(KEYS.anni, {}); },
  getAnniCorso(urlCorso) { return store.getAnni()[urlCorso] ?? null; },
  setAnniCorso(urlCorso, anni) {
    const tutti = store.getAnni();
    tutti[urlCorso] = { aggiornatoIl: new Date().toISOString(), anni };
    return scrivi(KEYS.anni, tutti);
  },

  /* ------------------------------ lezioni ---------------------------- */
  getCache() { return leggi(KEYS.cache, {}); },
  getLezioni(linkCalendarioId) {
    return store.getCache()[linkCalendarioId]?.lezioni ?? null;
  },
  /** true se la cache di questo calendario usa uno schema vecchio. */
  cacheStorica(linkCalendarioId) {
    const c = store.getCache()[linkCalendarioId];
    return !!c && c.schema !== CONFIG.schemaCache;
  },
  setLezioni(linkCalendarioId, lezioni) {
    const cache = store.getCache();
    cache[linkCalendarioId] = { aggiornatoIl: new Date().toISOString(), schema: CONFIG.schemaCache, lezioni };
    return scrivi(KEYS.cache, cache);
  },

  /* ------------------------------- pulizia --------------------------- */
  pulisciTutto() {
    [KEYS.stato, KEYS.indice, KEYS.anni, KEYS.cache].forEach((k) => localStorage.removeItem(k));
  },

  /* -------------------------------- tema ----------------------------- */
  getTema() { return localStorage.getItem(KEYS.tema) || 'auto'; },
  setTema(t) { localStorage.setItem(KEYS.tema, t); },
};
