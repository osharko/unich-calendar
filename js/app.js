/**
 * app.js — stato applicativo (Alpine.js) e orchestrazione.
 *
 * Due flussi:
 *  A) WIZARD di configurazione, una schermata alla volta:
 *     Polo → Dipartimento → Corso → Anno
 *  B) CALENDARIO, con selezione delle MATERIE da visualizzare.
 *
 * Scraping lazy: 1 richiesta per l'indice, 1 per gli anni del corso scelto.
 */
import { CONFIG, annoAccademicoCorrente } from './config.js';
import { COLORI_MATERIA } from './palette.js';
import { store } from './store.js';
import { api } from './api.js';
import { caricaIndice, caricaAnniCorso, statistiche } from './scraper.js';
import {
  rangeVista, intervalloOrario, buildColonne, disponiLezioni,
  aggiungiGiorni, aggiungiMesi, formattaData, formattaOra,
  coloreLezione, stessoGiorno,
} from './calendar.js';

/** Hash FNV-1a stabile → indice della palette colori-materia. */
function hashColore(testo) {
  let h = 2166136261;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % COLORI_MATERIA.length;
}

export function unichApp() {
  return {
    /* ============================== stato ============================== */
    caricamento: true,
    errore: null,
    messaggio: null,

    indice: null,
    stats: { poli: 0, strutture: 0, corsi: 0, calendariDiretti: 0 },
    scraping: null,

    // --- wizard ---
    schermata: 'polo',        // polo | struttura | corso | anni
    poloScelto: '',
    strutturaScelta: '',
    corsoScelto: null,        // oggetto corso
    ricercaCorso: '',         // filtro testo nello step corso
    anniDelCorso: null,
    anniInCaricamento: false,

    // --- calendario ---
    selezioni: [],
    lezioni: [],
    da: null, a: null,
    vista: 'settimana',
    giorniVisibili: 3,        // 1 | 3 | 5 | 7 (adattato allo schermo all'avvio)
    dataRif: new Date(),
    giorni: [], ore: [],
    oraMin: 8, oraMax: 20,
    nascondiAnnullati: true,
    mostraMaterie: false,     // pannello di selezione materie
    wizardAperto: false,      // wizard di configurazione aperto

    dettaglio: null,
    tema: 'auto',
    palette: CONFIG.palette,

    /* ============================ lifecycle ============================ */
    async init() {
      this.applicaTema(store.getTema());
      const stato = store.getStato();
      this.vista = stato.vista || 'settimana';
      this.nascondiAnnullati = stato.nascondiAnnullati ?? true;
      // Default responsive: pochi giorni su mobile, settimana intera su desktop.
      this.giorniVisibili = stato.giorniVisibili ?? (window.innerWidth >= 900 ? 7 : 3);
      this.selezioni = (stato.selezioni || []).map((s) => ({
        ...s,
        attivo: s.attivo !== false,
        // Set delle materie visibili; null = tutte visibili.
        materieVisibili: s.materieVisibili || null,
      }));

      this.indice = store.getIndice();
      if (this.indice) this.stats = statistiche(this.indice);

      this.caricamento = false;

      if (this.selezioni.length) {
        this.caricaDaCache();
        if (navigator.onLine !== false) this.aggiornaLezioni({ silenzioso: true });
      }
    },

    /* =============================== tema ============================== */
    applicaTema(t) {
      this.tema = t;
      store.setTema(t);
      const root = document.documentElement;
      root.setAttribute('data-theme',
        t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'mocha' : 'latte') : t);
    },

    /* ============================== indice ============================= */
    async aggiornaIndice() {
      if (this.scraping) return;
      this.errore = null;
      this.scraping = { messaggio: 'Scarico l\'elenco dei corsi…' };
      try {
        const indice = await caricaIndice();
        this.indice = indice;
        this.stats = statistiche(indice);
        store.setIndice(indice);
        this.messaggio = `Elenco aggiornato: ${this.stats.corsi} corsi.`;
      } catch (e) {
        this.errore = `Elenco non disponibile: ${e.message}`;
      } finally {
        this.scraping = null;
        setTimeout(() => (this.messaggio = null), 5000);
      }
    },

    /* ============================== wizard ============================= */
    get poli() { return this.indice?.poli || []; },
    get strutture() { return this.poli.find((p) => p.nome === this.poloScelto)?.strutture || []; },
    get corsi() {
      return this.strutture.find((s) => s.nome === this.strutturaScelta)?.corsi || [];
    },

    /** Corsi dello step corrente, con filtro di ricerca. */
    get corsiFiltrati() {
      const q = (this.ricercaCorso || '').trim().toLowerCase();
      return q ? this.corsi.filter((c) => c.nome.toLowerCase().includes(q)) : this.corsi;
    },

    apriWizard() {
      this.mostraMaterie = false;
      this.wizardAperto = true;
      this.ricercaCorso = '';
      this.schermata = 'polo';
    },

    /** Vai a uno step del breadcrumb solo se il percorso è già stato scelto. */
    vaiA(step) {
      const ordine = ['polo', 'struttura', 'corso', 'anni'];
      const idx = ordine.indexOf(step);
      // Puoi andare indietro sempre; avanti solo se hai già scelto quanto serve.
      if (idx <= ordine.indexOf(this.schermata)) { this.schermata = step; return; }
      if (step === 'struttura' && this.poloScelto) this.schermata = step;
      else if (step === 'corso' && this.strutturaScelta) this.schermata = step;
      else if (step === 'anni' && this.corsoScelto) this.schermata = step;
    },

    scegliPolo(nome) {
      this.poloScelto = nome;
      this.strutturaScelta = '';
      this.corsoScelto = null;
      this.anniDelCorso = null;
      this.schermata = 'struttura';
    },
    scegliStruttura(nome) {
      this.strutturaScelta = nome;
      this.corsoScelto = null;
      this.anniDelCorso = null;
      this.ricercaCorso = '';
      this.schermata = 'corso';
    },
    async scegliCorso(corso) {
      this.corsoScelto = corso;
      this.anniDelCorso = null;
      this.schermata = 'anni';

      if (corso.calendari) { this.anniDelCorso = corso.calendari; return; }

      const cached = store.getAnniCorso(corso.url);
      if (cached) { this.anniDelCorso = cached.anni; return; }

      this.anniInCaricamento = true;
      this.errore = null;
      try {
        const anni = await caricaAnniCorso(corso.url);
        this.anniDelCorso = anni;
        store.setAnniCorso(corso.url, anni);
        if (!anni.length) this.errore = 'Nessun anno pubblicato per questo corso.';
      } catch (e) {
        this.errore = `Anni non caricati: ${e.message}`;
        this.anniDelCorso = [];
      } finally {
        this.anniInCaricamento = false;
      }
    },

    indietro() {
      this.schermata = { struttura: 'polo', corso: 'struttura', anni: 'corso' }[this.schermata] || 'polo';
    },

    apriCalendario() {
      this.mostraMaterie = false;
      this.wizardAperto = false;
    },

    /* ============================ selezioni ============================ */
    calendarioGiaScelto(id) { return this.selezioni.some((s) => s.linkCalendarioId === id); },

    aggiungiCalendario(cal) {
      if (this.calendarioGiaScelto(cal.linkCalendarioId)) return;
      this.selezioni.push({
        linkCalendarioId: cal.linkCalendarioId,
        etichetta: cal.etichetta,
        corso: this.corsoScelto?.nome || 'Corso',
        colore: this.selezioni.length % CONFIG.palette.length,
        attivo: true,
        materieVisibili: null,
      });
      this.salvaSelezioni();
      this.mostraMaterie = false;
      this.wizardAperto = false;   // torna al calendario
      this.aggiornaLezioni();
    },

    rimuoviCalendario(id) {
      this.selezioni = this.selezioni.filter((s) => s.linkCalendarioId !== id);
      this.salvaSelezioni();
      this.caricaDaCache();
    },

    toggleSelezione(id) {
      const s = this.selezioni.find((x) => x.linkCalendarioId === id);
      if (s) { s.attivo = !s.attivo; this.salvaSelezioni(); this.caricaDaCache(); }
    },

    salvaSelezioni() {
      store.setStato({
        ...store.getStato(),
        selezioni: this.selezioni.map(({ linkCalendarioId, etichetta, corso, colore, attivo, materieVisibili }) =>
          ({ linkCalendarioId, etichetta, corso, colore, attivo, materieVisibili })),
      });
    },

    /* ============================= lezioni ============================= */
    caricaDaCache() {
      const tutte = [];
      for (const s of this.selezioni) {
        if (!s.attivo) continue;
        const l = store.getLezioni(s.linkCalendarioId);
        if (l) tutte.push(...l.map((x) => ({ ...x, _sel: s })));
      }
      this.lezioni = tutte;
      this.ricalcola();
      if (tutte.length) this._saltaAllaPrimaLezione();
    },

    async aggiornaLezioni(opts = {}) {
      const attive = this.selezioni.filter((s) => s.attivo);
      if (!attive.length) return;
      this.errore = null;
      const { da, a } = annoAccademicoCorrente();

      try {
        const risultati = await Promise.all(
          attive.map(async (s) => ({
            sel: s,
            lez: await api.getImpegni(s.linkCalendarioId, new Date(da), new Date(a), {
              mostraAnnullati: !this.nascondiAnnullati,
              mostraIndisponibilita: true,
            }),
          }))
        );
        for (const { sel, lez } of risultati) store.setLezioni(sel.linkCalendarioId, lez);
        this.lezioni = risultati.flatMap(({ sel, lez }) => lez.map((l) => ({ ...l, _sel: sel })));
        this.ricalcola();
        this._saltaAllaPrimaLezione();
        if (!opts.silenzioso) {
          this.messaggio = `Aggiornate ${this.lezioni.length} voci.`;
          setTimeout(() => (this.messaggio = null), 4000);
        }
      } catch (e) {
        this.errore = `Aggiornamento lezioni non riuscito: ${e.message}`;
      }
    },

    /* ============================= materie ============================= */
    /**
     * Elenco delle materie distinte, per il pannello di selezione.
     * Raggruppa per (selezione, nome, annoCorso): i dettagli didattici diversi
     * della stessa materia (percorsi/partizioni) confluiscono in una voce sola,
     * mantenendo l'insieme delle chiavi per il filtro.
     */
    get materie() {
      const mappa = new Map();
      for (const s of this.selezioni) {
        const visibili = s.materieVisibili; // array di chiavi; null = tutte
        for (const l of this.lezioni.filter((x) => x.linkCalendarioId === s.linkCalendarioId)) {
          if (l.indisponibilita) continue;
          const voci = (l.materie && l.materie.length)
            ? l.materie
            : [{ chiave: l.chiaveMateria, nome: l.insegnamento, annoCorso: l.annoCorso, codice: l.codice }];

          for (const v of voci) {
            const nome = v.nome || l.insegnamento;
            const anno = v.annoCorso ?? l.annoCorso;
            const id = `${s.linkCalendarioId}|${nome}|${anno ?? ''}`;
            let voce = mappa.get(id);
            if (!voce) {
              voce = {
                id, selId: s.linkCalendarioId, colore: s.colore,
                insegnamento: nome, annoCorso: anno,
                codice: v.codice || l.codice, docenti: l.docenti,
                chiavi: new Set(),
                lezioni: new Set(),   // id lezione, per non contare i duplicati
              };
              mappa.set(id, voce);
            }
            voce.chiavi.add(v.chiave);
            voce.lezioni.add(l.id);
          }
        }
      }

      const ordinate = [...mappa.values()]
        .map((v) => {
          const sel = this.selezioni.find((s) => s.linkCalendarioId === v.selId);
          return {
            ...v,
            chiavo: [...v.chiavi],
            n: v.lezioni.size,
            visibile: sel?.materieVisibili === null ||
              [...v.chiavi].some((k) => (sel?.materieVisibili || []).includes(k)),
          };
        })
        .sort((a, b) => a.selId.localeCompare(b.selId) || a.insegnamento.localeCompare(b.insegnamento));

      // Indice colore stabile: hash del nome materia, così una materia mantiene
      // lo stesso colore anche cambiando calendari. Linear probing anti-collisione.
      const usati = new Set();
      for (const m of ordinate) {
        let idx = hashColore(`${m.selId}|${m.insegnamento}|${m.annoCorso ?? ''}`);
        let t = 0;
        while (usati.has(idx) && t < COLORI_MATERIA.length) { idx = (idx + 1) % COLORI_MATERIA.length; t++; }
        usati.add(idx);
        m.indiceColore = idx;
      }
      return ordinate;
    },

    /** Mappa chiaveMateria → indice colore, per colorare le lezioni. */
    get coloriPerChiave() {
      const mappa = new Map();
      for (const m of this.materie) for (const k of m.chiavo) mappa.set(k, m.indiceColore);
      return mappa;
    },

    /** Indice colore di una lezione = colore della sua materia (o del calendario). */
    coloreDiLezione(l) {
      const mappa = this.coloriPerChiave;
      const chiavi = (l.materie && l.materie.length) ? l.materie.map((m) => m.chiave) : [l.chiaveMateria];
      const idx = chiavi.map((k) => mappa.get(k)).find((x) => x !== undefined);
      return idx === undefined ? null : idx;
    },

    /** Tutte le chiavi-materia di una selezione. */
    chiaviDiSel(selId) {
      const set = new Set();
      for (const l of this.lezioni) {
        if (l.linkCalendarioId !== selId || l.indisponibilita) continue;
        const voci = (l.materie && l.materie.length) ? l.materie : [{ chiave: l.chiaveMateria }];
        for (const v of voci) set.add(v.chiave);
      }
      return [...set];
    },

    toggleMateria(m) {
      const s = this.selezioni.find((x) => x.linkCalendarioId === m.selId);
      if (!s) return;
      const tutte = this.chiaviDiSel(s.linkCalendarioId);
      const visibili = new Set(s.materieVisibili === null ? tutte : s.materieVisibili);
      const attiva = m.chiavo.every((k) => visibili.has(k));
      for (const k of m.chiavo) attiva ? visibili.delete(k) : visibili.add(k);
      s.materieVisibili = visibili.size === tutte.length ? null : [...visibili];
      this.salvaSelezioni();
      this.ricalcola();
    },

    /** true → tutte visibili; false → nessuna. */
    tutteMaterie(soloVisibili) {
      for (const s of this.selezioni) {
        s.materieVisibili = soloVisibili ? null : [];
      }
      this.salvaSelezioni();
      this.ricalcola();
    },

    /* ============================= griglia ============================= */
    ricalcola() {
      const lez = this.lezioniFiltrate.filter((l) => !l.indisponibilita);
      const { oraMin, oraMax } = intervalloOrario(lez);
      this.oraMin = oraMin; this.oraMax = oraMax;

      const n = this.vista === 'mese' ? 7 : this.giorniVisibili;
      const { da, a, nGiorni } = rangeVista(this.dataRif, this.vista, n);
      this.da = da; this.a = a;

      const colonne = buildColonne(lez, da, a, { oraMin, oraMax, nGiorni });
      this.giorni = disponiLezioni(lez, colonne, oraMin, oraMax);
      this.ore = colonne.ore;
    },

    get lezioniFiltrate() {
      return this.lezioni.filter((l) => {
        if (this.nascondiAnnullati && l.stato === 'A') return false;
        const s = l._sel;
        if (!s) return true;
        if (l.indisponibilita) return true; // festivi sempre visibili
        const visibili = s.materieVisibili; // null = tutte
        if (visibili === null) return true;
        // Visibile se ALMENO UNA delle sue materie è selezionata.
        const chiavi = (l.materie && l.materie.length)
          ? l.materie.map((m) => m.chiave)
          : [l.chiaveMateria];
        return chiavi.some((k) => visibili.includes(k));
      });
    },

    get indisponibilita() {
      const out = [];
      for (const g of this.giorni) {
        const t = this.lezioni.find((l) => l.indisponibilita && stessoGiorno(l.inizio, g.data));
        if (t) out.push({ giorno: g, causale: t.causale });
      }
      return out;
    },

    get titoloPeriodo() {
      if (this.vista === 'mese') return this.dataRif.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const ultimo = aggiungiGiorni(this.a, -1);
      if (this.giorniVisibili === 1) return formattaData(this.da, { weekday: 'long', day: 'numeric', month: 'long' });
      return `${formattaData(this.da, { day: 'numeric', month: 'short' })} – ${formattaData(ultimo, { day: 'numeric', month: 'short' })}`;
    },
    get altezzaOra() { return 56; },

    /**
     * Se la vista corrente è vuota ma ci sono lezioni altrove,
     * salta alla data della prima lezione (per non aprire su una settimana vuota).
     */
    _saltaAllaPrimaLezione() {
      if (this.giorni.some((g) => g.lezioni.length)) return;
      const ora = Date.now();
      const prossime = this.lezioniFiltrate
        .filter((l) => !l.indisponibilita && new Date(l.fine) >= ora)
        .sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
      const prima = prossime[0] || this.lezioniFiltrate.find((l) => !l.indisponibilita);
      if (prima) {
        this.dataRif = new Date(prima.inizio);
        this.ricalcola();
      }
    },

    /* ========================= navigazione data ======================== */
    vai(direzione) {
      this.dataRif = this.vista === 'mese'
        ? aggiungiMesi(this.dataRif, direzione)
        : aggiungiGiorni(this.dataRif, direzione * (this.vista === 'settimana' ? this.giorniVisibili : 7));
      this.ricalcola();
    },
    oggi() { this.dataRif = new Date(); this.ricalcola(); },
    cambiaVista(v) {
      this.vista = v;
      store.setStato({ ...store.getStato(), vista: v });
      this.ricalcola();
    },
    cambiaGiorniVisibili(n) {
      this.giorniVisibili = Number(n);
      store.setStato({ ...store.getStato(), giorniVisibili: this.giorniVisibili });
      this.ricalcola();
    },

    /* ============================ interazione ========================== */
    apriDettaglio(l) { this.dettaglio = l; },
    chiudiDettaglio() { this.dettaglio = null; },
    coloreLezione(l) { return coloreLezione(l); },
    formattaOra,
    formattaData,

    /* ============================== export ============================= */
    esportaIcs() {
      const pad = (n) => String(n).padStart(2, '0');
      const f = (d) => {
        const x = new Date(d);
        return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}00Z`;
      };
      const esc = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
      const righe = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//unich-calendar//IT', 'CALSCALE:GREGORIAN'];
      for (const l of this.lezioniFiltrate) {
        if (l.indisponibilita) continue;
        righe.push('BEGIN:VEVENT', `UID:${l.id}@unich-calendar`, `DTSTAMP:${f(new Date())}`,
          `DTSTART:${f(l.inizio)}`, `DTEND:${f(l.fine)}`, `SUMMARY:${esc(l.insegnamento)}`,
          `LOCATION:${esc(l.aule.map((a) => a.descrizione).join(', '))}`,
          `DESCRIPTION:${esc([...l.docenti, l.aule.map((a) => a.codice).join(' ')].filter(Boolean).join(' — '))}`,
          'END:VEVENT');
      }
      righe.push('END:VCALENDAR');
      const blob = new Blob([righe.join('\r\n')], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'unich-calendario.ics';
      a.click();
      URL.revokeObjectURL(a.href);
    },
  };
}
