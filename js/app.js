/**
 * app.js — stato applicativo (Alpine.js) e orchestrazione.
 *
 * UX:
 *  - Wizard a step (Polo → Dipartimento → Corso → Anno) aperto quando serve.
 *  - Un calendario "corrente" per volta: il titolo in alto apre un menu a
 *    tendina per cambiare anno/aggiungerne altri.
 *  - Le materie si attivano/disattivano cliccando i "pill" sopra la griglia.
 *  - Notifiche locali 15 min prima della lezione (attivabili dalla topbar).
 */
const NUM_COLORI = CONFIG.numColori;

/** Hash FNV-1a stabile → indice della palette colori-materia. */
function hashColore(testo) {
  let h = 2166136261;
  for (let i = 0; i < testo.length; i++) {
    h ^= testo.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % NUM_COLORI;
}

function unichApp() {
  return {
    /* ============================== stato ============================== */
    caricamento: true,
    errore: null,
    messaggio: null,

    indice: null,
    stats: { poli: 0, strutture: 0, corsi: 0, calendariDiretti: 0 },
    scraping: null,

    // --- wizard ---
    wizardAperto: false,
    schermata: 'polo',        // polo | struttura | corso | anni
    poloScelto: '',
    strutturaScelta: '',
    corsoScelto: null,
    ricercaCorso: '',
    anniDelCorso: null,
    anniInCaricamento: false,

    // --- calendari ---
    selezioni: [],            // [{ linkCalendarioId, etichetta, corso, materieVisibili }]
    correnteId: null,         // calendario mostrato
    menuCalendari: false,     // dropdown topbar

    // --- calendario visibile ---
    lezioni: [],              // solo del calendario corrente
    da: null, a: null,
    vista: 'settimana',
    giorniVisibili: 7,
    menuVista: false,   // dropdown custom Orizzontale/Mese
    menuGiorni: false,  // dropdown custom 1/3/5/7 giorni
    dataRif: new Date(),
    giorni: [], ore: [],
    oraMin: 8, oraMax: 20,
    nascondiAnnullati: true,

    // --- notifiche ---
    permNotifiche: 'unsupported', // default|granted|denied|unsupported
    notificheOn: false,

    dettaglio: null,
    tema: 'auto',

    /* ============================ lifecycle ============================ */
    async init() {
      const stato = store.getStato();
      this.vista = stato.vista || 'settimana';
      this.giorniVisibili = stato.giorniVisibili ?? (window.innerWidth >= 900 ? 7 : 3);
      this.nascondiAnnullati = stato.nascondiAnnullati ?? true;
      this.selezioni = (stato.selezioni || []).map((s) => ({ ...s, materieVisibili: s.materieVisibili ?? null }));
      this.correnteId = stato.correnteId || this.selezioni[0]?.linkCalendarioId || null;
      this.notificheOn = stato.notifiche === true;

      this.indice = store.getIndice();
      if (this.indice) this.stats = statistiche(this.indice);
      this.caricamento = false;

      // Tema: il default segue il sistema e NON viene salvato finché l'utente
      // non sceglie esplicitamente (toggleTema).
      this.temaSalvato = store.getTema(); // 'auto' di default
      this.applicaTema(this.temaSalvato, false);
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',
        () => { if (this.temaSalvato === 'auto') this.applicaTema('auto', false); });

      if (this.correnteId) {
        this.caricaLezioniCorrente();
        if (navigator.onLine !== false) this.aggiornaLezioni({ silenzioso: true });
      }

      // Notifiche
      this.permNotifiche = initNotifiche();
      if (this.notificheOn && this.permNotifiche === 'granted') {
        sincronizzaNotifiche([]); // riprogramma da cache appena pronto
      }
    },

    /* =============================== tema ============================== */
    /** Due soli stati: chiaro/scuro. Il default è ciò che dice il sistema. */
    applicaTema(t, persisti = true) {
      const effettivo = t === 'auto'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'mocha' : 'latte')
        : t;
      this.temaAttuale = effettivo;
      if (persisti) store.setTema(effettivo);
      document.documentElement.setAttribute('data-theme', effettivo);
    },
    toggleTema() {
      this.applicaTema(this.temaAttuale === 'latte' ? 'mocha' : 'latte');
    },
    get temaEChi() { return this.temaAttuale === 'latte'; },

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
    get corsi() { return this.strutture.find((s) => s.nome === this.strutturaScelta)?.corsi || []; },
    get corsiFiltrati() {
      const q = (this.ricercaCorso || '').trim().toLowerCase();
      return q ? this.corsi.filter((c) => c.nome.toLowerCase().includes(q)) : this.corsi;
    },
    /** Il calendario corrente, come oggetto selezione. */
    get corrente() { return this.selezioni.find((s) => s.linkCalendarioId === this.correnteId) || null; },

    apriWizard() {
      this.menuCalendari = false;
      this.wizardAperto = true;
      this.ricercaCorso = '';
      this.schermata = this.indice ? 'polo' : 'polo';
      if (!this.indice && !this.scraping) this.aggiornaIndice();
    },
    chiudiWizard() { this.wizardAperto = false; },

    scegliPolo(nome) { this.poloScelto = nome; this.schermata = 'struttura'; },
    scegliStruttura(nome) {
      this.strutturaScelta = nome;
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
    /** Breadcrumb: si può tornare indietro sempre. */
    vaiA(step) {
      const ordine = ['polo', 'struttura', 'corso', 'anni'];
      if (ordine.indexOf(step) <= ordine.indexOf(this.schermata)) this.schermata = step;
    },

    /* ============================ selezioni ============================ */
    calendarioGiaScelto(id) { return this.selezioni.some((s) => s.linkCalendarioId === id); },

    aggiungiCalendario(cal) {
      if (this.calendarioGiaScelto(cal.linkCalendarioId)) return;
      this.selezioni.push({
        linkCalendarioId: cal.linkCalendarioId,
        etichetta: cal.etichetta,
        corso: this.corsoScelto?.nome || 'Corso',
        materieVisibili: null,
      });
      this.correnteId = cal.linkCalendarioId;
      this.salvaSelezioni();
      this.wizardAperto = false;
      this.aggiornaLezioni();
    },

    rimuoviCalendario(id) {
      this.selezioni = this.selezioni.filter((s) => s.linkCalendarioId !== id);
      if (this.correnteId === id) this.correnteId = this.selezioni[0]?.linkCalendarioId || null;
      this.salvaSelezioni();
      this.menuCalendari = false;
      this.caricaLezioniCorrente();
      if (this.correnteId && navigator.onLine !== false) this.aggiornaLezioni({ silenzioso: true });
    },

    /** Cambia calendario corrente dal menu a tendina. */
    usaCalendario(id) {
      if (this.correnteId === id) { this.menuCalendari = false; return; }
      this.correnteId = id;
      this.menuCalendari = false;
      this.salvaSelezioni();
      this.caricaLezioniCorrente();
      if (navigator.onLine !== false) this.aggiornaLezioni({ silenzioso: true });
    },

    salvaSelezioni() {
      store.setStato({
        ...store.getStato(),
        selezioni: this.selezioni.map(({ linkCalendarioId, etichetta, corso, materieVisibili }) =>
          ({ linkCalendarioId, etichetta, corso, materieVisibili })),
        correnteId: this.correnteId,
      });
    },

    /* ============================= lezioni ============================= */
    /** Lezioni del calendario corrente: subito dalla cache, poi aggiornate. */
    caricaLezioniCorrente() {
      const l = this.correnteId ? store.getLezioni(this.correnteId) : null;
      this.lezioni = l || [];
      this.ricalcola();
      this.syncNotifiche();
    },

    async aggiornaLezioni(opts = {}) {
      if (!this.correnteId) return;
      const id = this.correnteId;
      this.errore = null;
      const { da, a } = annoAccademicoCorrente();
      try {
        const lez = await api.getImpegni(id, new Date(da), new Date(a), {
          mostraAnnullati: !this.nascondiAnnullati,
          mostraIndisponibilita: true,
        });
        store.setLezioni(id, lez);
        if (this.correnteId === id) {
          this.lezioni = lez;
          this.ricalcola();
          this._saltaAllaPrimaLezione();
          this.syncNotifiche();
        }
        if (!opts.silenzioso) {
          this.messaggio = `Aggiornate ${lez.length} voci.`;
          setTimeout(() => (this.messaggio = null), 4000);
        }
      } catch (e) {
        this.errore = `Aggiornamento lezioni non riuscito: ${e.message}`;
      }
    },

    /* ========================= materie (pill) ========================== */
    /** Materie del calendario corrente, con colore e visibilità. */
    get materie() {
      if (!this.corrente) return [];
      const s = this.corrente;
      const mappa = new Map();
      for (const l of this.lezioni) {
        if (l.linkCalendarioId !== s.linkCalendarioId || l.indisponibilita) continue;
        const voci = (l.materie && l.materie.length)
          ? l.materie
          : [{ chiave: l.chiaveMateria, nome: l.insegnamento, annoCorso: l.annoCorso, codice: l.codice }];
        for (const v of voci) {
          const nome = v.nome || l.insegnamento;
          const anno = v.annoCorso ?? l.annoCorso;
          const id = `${nome}|${anno ?? ''}`;
          let voce = mappa.get(id);
          if (!voce) {
            voce = { id, insegnamento: nome, annoCorso: anno, docenti: l.docenti,
                     chiavi: new Set(), lezioni: new Set() };
            mappa.set(id, voce);
          }
          voce.chiavi.add(v.chiave);
          voce.lezioni.add(l.id);
        }
      }
      const ordinate = [...mappa.values()]
        .map((v) => ({ ...v, chiavo: [...v.chiavi], n: v.lezioni.size }))
        .sort((a, b) => a.insegnamento.localeCompare(b.insegnamento));

      // Colore stabile (hash + linear probing) e visibilità dal filtro.
      const usati = new Set();
      const vis = s.materieVisibili; // null = tutte
      for (const m of ordinate) {
        let idx = hashColore(`${m.insegnamento}|${m.annoCorso ?? ''}`);
        let t = 0;
        while (usati.has(idx) && t < NUM_COLORI) { idx = (idx + 1) % NUM_COLORI; t++; }
        usati.add(idx);
        m.indiceColore = idx;
        m.visibile = vis === null || m.chiavo.some((k) => vis.includes(k));
      }
      return ordinate;
    },

    /** Clicca un pill: mostra/nascondi la materia. */
    toggleMateria(m) {
      const s = this.corrente;
      if (!s) return;
      const tutte = new Set();
      for (const x of this.materie) x.chiavo.forEach((k) => tutte.add(k));
      const visibili = new Set(s.materieVisibili === null ? tutte : s.materieVisibili);
      const attiva = m.chiavo.every((k) => visibili.has(k));
      for (const k of m.chiavo) { attiva ? visibili.delete(k) : visibili.add(k); }
      s.materieVisibili = visibili.size === tutte.size ? null : [...visibili];
      this.salvaSelezioni();
      this.ricalcola();
      this.syncNotifiche();
    },

    /** true → tutte visibili; false → nessuna. */
    mostraTutteLeMaterie() {
      const s = this.corrente;
      if (!s) return;
      s.materieVisibili = null;
      this.salvaSelezioni();
      this.ricalcola();
      this.syncNotifiche();
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
      const s = this.corrente;
      return this.lezioni.filter((l) => {
        if (this.nascondiAnnullati && l.stato === 'A') return false;
        if (l.indisponibilita) return true;
        if (!s || s.materieVisibili === null) return true;
        const chiavi = (l.materie && l.materie.length) ? l.materie.map((m) => m.chiave) : [l.chiaveMateria];
        return chiavi.some((k) => s.materieVisibili.includes(k));
      });
    },

    /** Indice colore della materia di una lezione (per i blocchi in griglia). */
    coloreDiLezione(l) {
      const chiavi = (l.materie && l.materie.length) ? l.materie.map((m) => m.chiave) : [l.chiaveMateria];
      for (const m of this.materie) if (m.chiavo.some((k) => chiavi.includes(k))) return m.indiceColore;
      return null;
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

    /** Apre sulla prima data con lezioni (niente settimane vuote di default). */
    _saltaAllaPrimaLezione() {
      if (this.giorni.some((g) => g.lezioni.length)) return;
      const ora = Date.now();
      const prossime = this.lezioniFiltrate
        .filter((l) => !l.indisponibilita && new Date(l.fine) >= ora)
        .sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
      const prima = prossime[0] || this.lezioniFiltrate.find((l) => !l.indisponibilita);
      if (prima) { this.dataRif = new Date(prima.inizio); this.ricalcola(); }
    },

    /* ========================= navigazione data ======================== */
    vai(direzione) {
      this.dataRif = this.vista === 'mese'
        ? aggiungiMesi(this.dataRif, direzione)
        : aggiungiGiorni(this.dataRif, direzione * this.giorniVisibili);
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

    /* ============================== notifiche ========================== */
    get titleNotifiche() {
      if (this.permNotifiche === 'unsupported') return 'Notifiche non supportate';
      if (this.permNotifiche === 'denied') return 'Permesso notifiche negato (riattivalo dal browser)';
      return this.notificheOn ? 'Notifiche attive: disattiva' : 'Attiva promemoria 15 min prima';
    },
    /** Stato: off/on/bloccate; al click chiede il permesso e attiva. */
    async toggleNotifiche() {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        this.errore = 'Notifiche non supportate da questo browser.';
        return;
      }
      if (this.notificheOn) {
        this.notificheOn = false;
        store.setStato({ ...store.getStato(), notifiche: false });
        this.syncNotifiche();
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') {
        this.permNotifiche = await chiediPermesso(); // chiede il permesso
        perm = this.permNotifiche;
      }
      if (perm !== 'granted') {
        this.errore = 'Permesso notifiche negato: riattivalo dalle impostazioni del browser.';
        return;
      }
      this.permNotifiche = 'granted';
      this.notificheOn = true;
      store.setStato({ ...store.getStato(), notifiche: true });
      this.syncNotifiche();
      this.messaggio = 'Notifiche attivate: promemoria 15 minuti prima della lezione.';
      setTimeout(() => (this.messaggio = null), 4000);
    },

    syncNotifiche() {
      if (!this.notificheOn) { sincronizzaNotifiche([]); return; }
      const ora = Date.now();
      const fine = ora + CONFIG.orizzonteNotificheMs;
      const items = this.lezioniFiltrate
        .filter((l) => !l.indisponibilita && l.stato !== 'A')
        .map((l) => ({
          id: l.id,
          titolo: l.insegnamento,
          inizio: new Date(l.inizio).toISOString(),
          aula: l.aule.map((a) => a.codice || a.descrizione).join(', '),
        }))
        .filter((x) => {
          const t = new Date(x.inizio).getTime() - CONFIG.anticipoNotificaMs;
          return t > ora && new Date(x.inizio).getTime() < fine;
        });
      sincronizzaNotifiche(items);
    },

    /* ============================ dettaglio ============================ */
    apriDettaglio(l) { this.dettaglio = l; },
    chiudiDettaglio() { this.dettaglio = null; },
    formattaOra,
    formattaData,
  };
}
