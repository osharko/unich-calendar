/**
 * api.js — client per l'API Cineca "University Planner".
 *
 * CORS: aperto (access-control-allow-origin: *), quindi chiamabile dal browser.
 * Riferimenti completi in AGENT.md §2.1.
 */

async function post(endpoint, body) {
  const res = await fetch(`${CONFIG.apiBase}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${endpoint} → HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function get(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CONFIG.apiBase}${endpoint}${qs ? '?' + qs : ''}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`API ${endpoint} → HTTP ${res.status}`);
  return res.json();
}

/** Il clienteId è stabile, ma lo ricaviamo dal dominio e lo memoizziamo. */
async function getClienteId() {
  const chiave = `${KEYS.version}:clienteId`;
  let cache = null;
  try { cache = sessionStorage.getItem(chiave); } catch { /* storage non disponibile */ }
  if (cache) return cache;
  try {
    const r = await get('/Clienti/cercaPerDominio', { dominio: CONFIG.dominio });
    try { sessionStorage.setItem(chiave, r.id); } catch { /* ignore */ }
    return r.id;
  } catch {
    return CONFIG.clienteIdDefault;
  }
}

const api = {
  getClienteId,

  /** Metadati di un calendario pubblico (titolo, corsi, anni, ...). */
  async getCalendario(linkCalendarioId) {
    return post('/LinkCalendario/searchCalendarioPubblico', {
      linkCalendarioId,
      filter: {}, // obbligatorio
    });
  },

  /** Anni accademici pubblici. */
  async getAnniAccademici() {
    return get('/AnniAccademici/getAnniAccademiciPublic');
  },

  /** Lezioni (impegni) di un calendario in un intervallo di date. */
  async getImpegni(linkCalendarioId, da, a, opts = {}) {
    const clienteId = await getClienteId();
    const raw = await post('/Impegni/getImpegniCalendarioPubblico', {
      linkCalendarioId,
      clienteId,
      mostraImpegniAnnullati: opts.mostraAnnullati ?? false,
      mostraIndisponibilitaTotali: opts.mostraIndisponibilita ?? true,
      dataInizio: da.toISOString(),
      dataFine: a.toISOString(),
    });
    return raw.map((i) => normalizzaImpegno(i, linkCalendarioId));
  },
};

/* ==========================================================================
   Normalizzazione
   L'API restituisce oggetti enormi (~2,5 MB/mese): teniamo solo l'essenziale
   per stare nel budget di localStorage.
   ========================================================================== */

/** Hash stabile (FNV-1a) → ora i colori materia si calcolano in app.js. */


function normalizzaImpegno(i, linkCalendarioId) {
  const evento = i.evento || {};
  const dettagli = evento.dettagliDidattici || [];
  // Un impegno può essere condiviso da più insegnamenti (es. corso integrato).
  // I dettagli possono ripetersi: deduplichiamo per chiave.
  const visti = new Set();
  const materie = [];
  for (const dd of dettagli) {
    const chiave = dd.id || dd.codice || dd.nome;
    if (!chiave || visti.has(chiave)) continue;
    visti.add(chiave);
    materie.push({
      chiave,
      nome: dd.nome || dd.descrizione || '',
      codice: dd.codice || null,
      annoCorso: dd.annoCorso ?? null,
    });
  }

  const dd = dettagli[0] || {};
  const nome = i.nome || dd.nome || evento.nome || (i.causaleIndisponibilita ?? 'Senza titolo');
  // Titolo mostrato: se condiviso, unisce i nomi dei vari insegnamenti.
  // Dedup dei nomi: un impegno può avere lo stesso insegnamento ripetuto su
  // più dettagli (es. L-19 + L-5) → "STORIA MODERNA", non "X + X + X".
  const insegnamento = materie.length
    ? ([...new Set(materie.map((m) => m.nome).filter(Boolean))].join(' + ') || nome)
    : nome;

  // Chiave stabile della materia: gli id dei dettagli, ordinati, concatenati.
  // (l'id del dettaglio è costante tra tutti gli impegni della stessa materia)
  const chiaveMateria = materie.length
    ? materie.map((m) => m.chiave).sort().join('|')
    : (dd.codice || insegnamento);

  const docenti = (i.docenti || []).map((d) =>
    [d.nome, d.cognome].filter(Boolean).join(' ').trim() || d.descrizione || 'Docente'
  );
  const aule = (i.aule || []).map((a) => ({
    codice: a.codice || '',
    descrizione: a.descrizione || '',
    edificio: a.edificio?.descrizione || '',
    comune: a.edificio?.comune || '',
    piano: a.piano?.descrizione || '',
  }));

  return {
    id: i.id,
    linkCalendarioId,
    inizio: i.dataInizio,
    fine: i.dataFine,
    indisponibilita: !!i.indisponibilita,
    causale: i.causaleIndisponibilita || null,
    stato: i.stato || 'P', // P pubblicato, A annullato, S sospeso
    nome,
    nomeEn: i.nome_EN || dd.nome_EN || null,
    insegnamento,
    chiaveMateria,
    materie,
    codice: dd.codice || null,
    annoCorso: i.annoCorso ?? dd.annoCorso ?? null,
    docenti,
    aule,
    percorso: (i.percorsi || [])[0]?.descrizione || null,
    partizione: i.fattoreDiPartizione?.descrizione || null,
  };
}
