/**
 * scraper.js — gerarchia Polo → Dipartimento/Scuola → Corso → Anno.
 *
 * Modalità LAZY (nessuno scraping massivo):
 *   1 richiesta  → indice completo unich.it (poli, dipartimenti, corsi)
 *   1 richiesta  → solo il corso scelto (anni/percorsi → linkCalendarioId)
 *
 * Poiché www.unich.it non invia header CORS, le pagine passano da un proxy di
 * lettura con CORS aperto (vedi AGENT.md §2.2). Lo scraper gira NEL BROWSER.
 *
 * Struttura HTML di riferimento (Drupal):
 *   <h2>Polo di Chieti</h2>
 *   <h2>Dipartimento ...</h2>        ← dentro accordion-item / paragraph
 *     <a href=".../calendario-lezioni/<corso>">L-19 Filosofia ...</a>
 *   <a href="...cineca.it/calendarioPubblico/linkCalendarioId=...">Lettorato</a>
 */
import { CONFIG } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LINK_CALENDARIO_RE = /linkCalendarioId=([a-f0-9]{24})/i;
const PAGE_CORSO_RE = /\/didattica\/frequentare\/calendario-lezioni\/(.+)$/;

/* ================================================================== */
/* Rete                                                               */
/* ================================================================== */

/** Scarica una pagina unich.it tramite proxy, con retry e backoff. */
export async function fetchPagina(url) {
  const endpoint = CONFIG.proxy(url);
  let ultimoErrore;

  for (let tentativo = 1; tentativo <= CONFIG.proxyMaxRetry; tentativo++) {
    try {
      const res = await fetch(endpoint, { headers: CONFIG.proxyHeaders() });
      if (res.status === 429 || res.status === 503) {
        await sleep(1500 * tentativo * tentativo);
        throw new Error(`rate limit (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const testo = await res.text();
      if (!testo || testo.length < 500) throw new Error('risposta vuota');
      return testo;
    } catch (e) {
      ultimoErrore = e;
      if (tentativo < CONFIG.proxyMaxRetry) await sleep(1200 * tentativo);
    }
  }
  throw new Error(`Impossibile scaricare ${url}: ${ultimoErrore?.message}`);
}

const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');

/* ================================================================== */
/* Parsing                                                            */
/* ================================================================== */

/** Da un anchor Cineca ricava { etichetta, linkCalendarioId, anno, percorso }. */
function corsoDaAnchor(a) {
  const href = a.getAttribute('href') || '';
  const m = href.match(LINK_CALENDARIO_RE);
  if (!m) return null;
  const etichetta = a.textContent.replace(/\s+/g, ' ').trim() || 'Calendario';
  return {
    etichetta,
    linkCalendarioId: m[1],
    anno: parseInt(etichetta.match(/\d/)?.[0] ?? '', 10) || null,
    percorso: etichetta.match(/\(([^)]+)\)/)?.[1] || null,
  };
}

/**
 * Parsa la pagina indice: restituisce poli[] con strutture[] e i loro corsi.
 * I corsi NON hanno ancora i linkCalendarioId (si ottengono con parseCorso).
 */
export function parseIndice(html) {
  const doc = parseHtml(html);
  const contenuto =
    doc.querySelector('.node__content, .block-field-blocknodepagefield-contenuto, main') ||
    doc.body;

  const poli = [];
  let polo = null;

  for (const h of contenuto.querySelectorAll('h2')) {
    const titolo = h.textContent.replace(/\s+/g, ' ').trim();
    if (!titolo) continue;

    if (/^Polo\b/i.test(titolo)) {
      polo = { nome: titolo, strutture: [] };
      poli.push(polo);
      continue;
    }
    if (/^Naviga la sezione$/i.test(titolo)) break;
    if (!polo) continue;

    // Blocco della struttura: accordion (con .accordion-body) o paragraph semplice.
    const blocco =
      h.closest('.accordion-item, .paragraph--type--semplice, .paragraph') || h.parentElement;
    const corpo = blocco?.querySelector('.accordion-body') || blocco || h.parentElement;

    const struttura = { nome: titolo, corsi: [] };
    const visti = new Set();

    for (const a of corpo.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const testo = a.textContent.replace(/\s+/g, ' ').trim();
      if (!testo || href.startsWith('#')) continue;

      // Link diretto Cineca: corso con un solo calendario (es. Lettorato).
      const diretto = corsoDaAnchor(a);
      if (diretto) {
        if (!visti.has(diretto.linkCalendarioId)) {
          visti.add(diretto.linkCalendarioId);
          struttura.corsi.push({ nome: testo, url: null, calendari: [diretto] });
        }
        continue;
      }

      // Link a pagina corso interna (relativa o assoluta su unich.it).
      let m = href.match(PAGE_CORSO_RE);
      if (!m && /^https?:\/\/(www\.)?unich\.it\//.test(href)) m = href.match(PAGE_CORSO_RE);
      if (!m) continue;

      const url = new URL(href, 'https://www.unich.it').href;
      if (visti.has(url)) continue;
      visti.add(url);
      struttura.corsi.push({ nome: testo, url, calendari: null });
    }

    if (struttura.corsi.length) polo.strutture.push(struttura);
  }

  return poli.filter((p) => p.strutture.length);
}

/**
 * Parsa una pagina corso: anni/percorsi → linkCalendarioId (ordinati per anno).
 */
export function parseCorso(html) {
  const doc = parseHtml(html);
  const contenuto = doc.querySelector('.node__content, main') || doc.body;
  const calendari = [];
  const visti = new Set();

  for (const a of contenuto.querySelectorAll('a[href]')) {
    const c = corsoDaAnchor(a);
    if (c && !visti.has(c.linkCalendarioId)) {
      visti.add(c.linkCalendarioId);
      calendari.push(c);
    }
  }
  calendari.sort((x, y) => (x.anno ?? 99) - (y.anno ?? 99));
  return calendari;
}

/** Normalizza un titolo di corso per il confronto (per l'euristica sugli anni). */
const normalizza = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Se la pagina corso non elenca gli anni, prova a risalire ai calendari
 * Cineca via /api/LinkCalendario/searchCalendarioPubblico non è possibile
 * (richiede auth). Come fallback lasciamo l'elenco vuoto e lo segnaliamo.
 */
export function isPaginaCorsoUtile(html) {
  return parseCorso(html).length > 0;
}

/* ================================================================== */
/* Orchestrazione lazy                                                */
/* ================================================================== */

/**
 * Passo 1 — scarica e parsa l'indice (una sola richiesta).
 * @returns {{poli: Array, generatoIl: string, fonte: string}}
 */
export async function caricaIndice() {
  const html = await fetchPagina(CONFIG.catalogoUrl);
  const poli = parseIndice(html);
  if (!poli.length) {
    throw new Error('l\'indice non contiene corsi: formato della pagina inatteso (proxy?)');
  }
  return {
    generatoIl: new Date().toISOString(),
    fonte: CONFIG.catalogoUrl,
    poli: parseIndice(html),
  };
}

/**
 * Passo 2 — risolve gli anni di un singolo corso (una sola richiesta).
 * @returns {Array<{etichetta, linkCalendarioId, anno, percorso}>}
 */
export async function caricaAnniCorso(urlCorso) {
  if (!urlCorso) return [];
  const html = await fetchPagina(urlCorso);
  return parseCorso(html);
}

/** Statistiche sintetiche dell'indice, per la UI. */
export function statistiche(indice) {
  let strutture = 0, corsi = 0, calendariDiretti = 0;
  for (const p of indice?.poli || []) {
    strutture += p.strutture.length;
    for (const s of p.strutture) {
      corsi += s.corsi.length;
      for (const c of s.corsi) if (c.calendari) calendariDiretti++;
    }
  }
  return { poli: indice?.poli?.length || 0, strutture, corsi, calendariDiretti };
}
