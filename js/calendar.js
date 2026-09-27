/**
 * calendar.js — utilità date e costruzione della griglia "timetable".
 *
 * Layout: ORE sulle ascisse, GIORNI sulle ordinate.
 * Su mobile la griglia ruota in verticale (giorni in alto, ore a sinistra),
 * che è la forma più leggibile per un calendario settimanale.
 */

/* ------------------------------- date ------------------------------- */

const MS_MIN = 60 * 1000;

function inizioGiorno(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inizioSettimana(d) {
  const x = inizioGiorno(d);
  const giorno = (x.getDay() + 6) % 7; // lunedì = 0
  x.setDate(x.getDate() - giorno);
  return x;
}

function aggiungiGiorni(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function aggiungiMesi(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function stessoGiorno(a, b) {
  return inizioGiorno(a).getTime() === inizioGiorno(b).getTime();
}

function formattaOra(d) {
  return new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formattaData(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(d).toLocaleDateString('it-IT', opts);
}

function iso(d) {
  return new Date(d).toISOString();
}

/** Range (da, a, nGiorni) per la vista corrente. */
function rangeVista(dataRif, vista, nGiorni = 7) {
  if (vista === 'mese') {
    const da = inizioSettimana(new Date(dataRif.getFullYear(), dataRif.getMonth(), 1));
    const a = aggiungiGiorni(inizioSettimana(new Date(dataRif.getFullYear(), dataRif.getMonth() + 1, 0)), 7);
    return { da, a, nGiorni: Math.round((a - da) / 86400000) };
  }
  // Vista settimana: parte dal giorno di riferimento (non dal lunedì) se
  // si mostrano meno di 7 giorni, così "oggi" è sempre la prima colonna.
  const da = nGiorni >= 7 ? inizioSettimana(dataRif) : inizioGiorno(dataRif);
  return { da, a: aggiungiGiorni(da, nGiorni), nGiorni };
}

/* ------------------------------ griglia ------------------------------ */

const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/**
 * Costruisce le colonne (giorni) del timetable.
 * @returns {{giorni: Array, ore: number[], oraMin: number, oraMax: number, slotMin: number}}
 */
function buildColonne(lezioni, da, a, opts = {}) {
  const oraMin = opts.oraMin ?? 8;
  const oraMax = opts.oraMax ?? 20;
  const nGiorni = opts.nGiorni ?? 7;

  const giorni = [];
  for (let i = 0; i < nGiorni; i++) {
    const data = aggiungiGiorni(da, i);
    giorni.push({
      data,
      key: inizioGiorno(data).toISOString(),
      nome: GIORNI[(data.getDay() + 6) % 7],
      numero: data.getDate(),
      oggi: stessoGiorno(data, new Date()),
      lezioni: [],
    });
  }

  const ore = [];
  for (let h = oraMin; h <= oraMax; h++) ore.push(h);

  return { giorni, ore, oraMin, oraMax, slotMin: 60 };
}

/**
 * Determina l'intervallo orario effettivo da mostrare in base alle lezioni.
 * Se non ci sono lezioni, usa il default 8–20.
 */
function intervalloOrario(lezioni, opts = {}) {
  const defMin = opts.oraMin ?? 8;
  const defMax = opts.oraMax ?? 20;
  // Solo lezioni reali: le indisponibilità possono avere date "sentinel" incoerenti.
  const reali = (lezioni || []).filter((l) => !l.indisponibilita);
  if (!reali.length) return { oraMin: defMin, oraMax: defMax };

  let min = 24, max = 0;
  for (const l of reali) {
    const i = new Date(l.inizio);
    const f = new Date(l.fine);
    const startH = i.getHours() + i.getMinutes() / 60;
    // La fine va arrotondata per eccesso se ci sono minuti (es. 14:30 → 15).
    let endH = f.getHours() + f.getMinutes() / 60;
    if (f.getMinutes() > 0) endH = Math.floor(endH) + 1;
    min = Math.min(min, startH);
    max = Math.max(max, endH);
  }
  return {
    oraMin: Math.max(0, Math.floor(min) - (opts.margine ?? 1)),
    oraMax: Math.min(24, Math.ceil(max) + (opts.margine ?? 1)),
  };
}

/**
 * Dispone le lezioni nei giorni e calcola il posizionamento verticale
 * (percentuale sull'intervallo orario) e l'eventuale affiancamento
 * orizzontale quando si sovrappongono.
 */
function disponiLezioni(lezioni, colonne, oraMin, oraMax) {
  const giorni = Array.isArray(colonne) ? colonne : colonne.giorni;
  const perGiorno = new Map(giorni.map((g) => [g.key, []]));
  const span = Math.max(1, oraMax - oraMin);

  for (const l of lezioni) {
    if (l.indisponibilita) continue;
    const key = inizioGiorno(l.inizio).toISOString();
    const bucket = perGiorno.get(key);
    if (!bucket) continue;

    const i = new Date(l.inizio);
    const f = new Date(l.fine);
    const startH = i.getHours() + i.getMinutes() / 60;
    const endH = f.getHours() + f.getMinutes() / 60 || startH + 1;

    bucket.push({
      ...l,
      _top: ((startH - oraMin) / span) * 100,
      _altezza: (Math.max(0.25, endH - startH) / span) * 100,
      _col: 0,
      _nCol: 1,
    });
  }

  // Affiancamento dei blocchi sovrapposti (colonne multiple).
  for (const [, bucket] of perGiorno) {
    bucket.sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
    let gruppo = [];
    let fineGruppo = -Infinity;

    const chiudi = () => {
      if (!gruppo.length) return;
      // Assegna colonne greedy.
      const colonne = [];
      for (const ev of gruppo) {
        const s = new Date(ev.inizio).getTime();
        let c = colonne.findIndex((fine) => fine <= s);
        if (c === -1) { c = colonne.length; colonne.push(0); }
        colonne[c] = new Date(ev.fine).getTime();
        ev._col = c;
      }
      for (const ev of gruppo) ev._nCol = colonne.length;
      gruppo = [];
    };

    for (const ev of bucket) {
      const s = new Date(ev.inizio).getTime();
      if (s >= fineGruppo && gruppo.length) chiudi();
      gruppo.push(ev);
      fineGruppo = Math.max(fineGruppo, new Date(ev.fine).getTime());
    }
    chiudi();
  }

  return giorni.map((g) => ({ ...g, lezioni: perGiorno.get(g.key) || [] }));
}
