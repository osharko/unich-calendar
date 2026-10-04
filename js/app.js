/**
 * app.js — stato applicativo (Alpine.js) e orchestrazione.
 *
 * UX:
 *  - Wizard a step (Polo → Dipartimento → Corso → Anno) aperto quando serve.
 *  - Un calendario "corrente" per volta: il titolo in alto apre un menu a
 *    tendina per cambiare anno/aggiungerne altri.
 *  - Le materie si attivano/disattivano cliccando i "pill" cliccabili (sotto la griglia).
 *  - Notifiche push reali via Worker (promemoria + cambi calendario); camapana
 *    in topbar che guida all'installazione della PWA quando serve.
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

/** Minuti → ore con formato compatto ("0", "2", "12,5"). */
function oreH(min) {
  const h = Math.round((min / 60) * 10) / 10;
  return String(h).replace('.', ',');
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
    giorniVisibili: 5,       // 5 = Lun–Ven, 7 = Lun–Dom (toggle col pulsante)
    menuVista: false,   // dropdown custom Orizzontale/Mese
    dataRif: new Date(),
    giorni: [], ore: [],
    oraMin: 8, oraMax: 20,
    nascondiAnnullati: true,
    // "Adesso": cambia ogni minuto → le chip {erogate}/{totali}h e
    // l'effetto "lezione in corso" restano aggiornati senza refresh.
    oraAdesso: Date.now(),

    // --- notifiche push ---
    permNotifiche: 'unsupported', // granted|denied|default|unsupported
    notificheOn: false,
    pwaAtiva: false,              // app installata (push richiede standalone)
    installEvt: null,             // beforeinstallprompt (se il browser lo offre)
    mostraInstallGuida: false,    // modale di installazione
    _pushTimer: null,             // debounce sync preferenze

    dettaglio: null,
    tema: 'auto',
    build: window.APP_BUILD || {},   // da js/version.js (rigenerato a ogni rilascio)

    /* ============================ lifecycle ============================ */
    async init() {
      const stato = store.getStato();
      this.vista = stato.vista || 'settimana';
      // Default 5 giorni; una scelta esplicita dell'utente (dropdown) prevale.
      this.giorniVisibili = stato.giorniVisibili ?? 5;
      this.nascondiAnnullati = stato.nascondiAnnullati ?? true;
      this.selezioni = (stato.selezioni || []).map((s) => ({ ...s, materieVisibili: s.materieVisibili ?? null }));
      this.correnteId = stato.correnteId || this.selezioni[0]?.linkCalendarioId || null;
      this.notificheOn = stato.notifiche === true;

      this.indice = store.getIndice();
      if (this.indice) this.stats = statistiche(this.indice);
      this.caricamento = false;

      // Primo accesso: se non c'è indice in cache, il download parte da sé
      // (non serve premere "Aggiorna elenco"). Se offline, si riproverà al
      // prossimo reload / ritorno online.
      if (!this.indice) {
        if (navigator.onLine !== false) this.aggiornaIndice();
        else addEventListener('online', () => !this.indice && this.aggiornaIndice(), { once: true });
      }

      // Tema: il default segue il sistema e NON viene salvato finché l'utente
      // non sceglie esplicitamente (toggleTema).
      this.temaSalvato = store.getTema(); // 'auto' di default
      this.applicaTema(this.temaSalvato, false);
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',
        () => { if (this.temaSalvato === 'auto') this.applicaTema('auto', false); });

      if (this.correnteId) {
        this.caricaLezioniCorrente();
        // Niente refresh "alla cieca" all'avvio: ci si aggiorna solo se un push
        // 'changed' del Worker è più recente della cache locale (vedi notify.js).
        this.verificaCambioDaPush();
      }

      // Notifiche: stato reale al boot (senza toccare nulla).
      this.permNotifiche = statoPermesso();
      this.pwaAtiva = pwaInstallata();

      // SELF-HEAL a ogni apertura (niente più reinstallazioni manuali):
      //  1) forza il controllo di aggiornamento del service worker;
      //  2) con notifiche attive: risincronizza le prefs verso il Worker e
      //     ri-sottoscrivi se la subscription è persa (reinstall/reset permessi).
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((r) => r?.update?.()).catch(() => {});
      }
      if (this.notificheOn) this.riprendiPush();
      addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.installEvt = e;
      });
      addEventListener('appinstalled', () => {
        this.pwaAtiva = true;
        this.installEvt = null;
        this.messaggio = 'App installata ✓. Ora puoi attivare le notifiche (🔔).';
        setTimeout(() => (this.messaggio = null), 7000);
      });
      // Il Worker, via service worker, avvisa quando un calendario è cambiato.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (e) => {
          if (e.data?.type === 'unich:changed') {
            this.messaggio = 'Un calendario è cambiato: in aggiornamento…';
            this.caricaLezioniCorrente();
            this.aggiornaLezioni({ silenzioso: true });
          }
        });
      }

      // Orologio dell'app: ogni minuto (e al ritorno in primo piano) aggiorna
      // "adesso" → chip {erogate}/{totali}h e lezioni in corso sempre veritiere.
      const segnaOra = () => { this.oraAdesso = Date.now(); };
      setInterval(segnaOra, 60000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) segnaOra();
      });

      // Pull-to-refresh: solo dall'alto, solo verso il basso (ptrStart/Move/End).
      document.addEventListener('touchstart', (e) => this.ptrStart(e), { passive: true });
      document.addEventListener('touchmove', (e) => this.ptrMove(e), { passive: false });
      document.addEventListener('touchend', () => this.ptrEnd(), { passive: true });
      document.addEventListener('touchcancel', () => { this._ptrY = null; this.ptr.dy = 0; }, { passive: true });
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
      this.schedulePushSync();   // push: porta calendari/materie al Worker
    },

    /* ============================= lezioni ============================= */
    /** Lezioni del calendario corrente: subito dalla cache, poi aggiornate. */
    caricaLezioniCorrente() {
      const l = this.correnteId ? store.getLezioni(this.correnteId) : null;
      this.lezioni = l || [];
      this.ricalcola();
      // Cache scritta con schema vecchio (mancano campi tipo "sede"): ri-fetch
      // silenzioso, una tantum, senza chiedere nulla all'utente.
      if (this.correnteId && navigator.onLine !== false && store.cacheStorica(this.correnteId)) {
        this.aggiornaLezioni({ silenzioso: true });
      }
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
      const ora = this.oraAdesso; // reattività: le ore erogate cambiano col tempo
      const mappa = new Map();
      for (const l of this.lezioni) {
        if (l.linkCalendarioId !== s.linkCalendarioId || l.indisponibilita) continue;
        const voci = (l.materie && l.materie.length)
          ? l.materie
          : [{ chiave: l.chiaveMateria, nome: l.insegnamento, annoCorso: l.annoCorso, codice: l.codice }];
        // Ore della lezione: da durataMinuti (o ricavate dalle date nelle
        // cache vecchie). Annullate = mai erogate e mai conteggiate.
        const dur = l.durataMinuti
          || Math.max(0, Math.round((new Date(l.fine) - new Date(l.inizio)) / 60000));
        const t0 = new Date(l.inizio).getTime();
        const t1 = new Date(l.fine).getTime();
        const annullata = l.stato === 'A';
        const iniziata = !annullata && t0 <= ora;
        const inCorso = !annullata && t0 <= ora && t1 > ora;
        for (const v of voci) {
          const nome = v.nome || l.insegnamento;
          const anno = v.annoCorso ?? l.annoCorso;
          // Raggruppiamo PER SOLO NOME: la stessa lezione può comparire in
          // più dettagli (anni/percorsi diversi) → un solo badge, non 3.
          const id = nome;
          let voce = mappa.get(id);
          if (!voce) {
            voce = { id, insegnamento: nome, anni: new Set(), docenti: l.docenti,
                     chiavi: new Set(), lezioni: new Set(),
                     oreTot: 0, oreEro: 0, inCorso: false };
            mappa.set(id, voce);
          }
          voce.chiavi.add(v.chiave);
          if (anno != null) voce.anni.add(anno);
          // Le ore si sommano solo la PRIMA volta che la lezione entra nel
          // gruppo (una lezione può avere più voci dallo stesso nome).
          if (!voce.lezioni.has(l.id)) {
            voce.lezioni.add(l.id);
            if (!annullata) voce.oreTot += dur;
            if (iniziata) voce.oreEro += dur;
            if (inCorso) voce.inCorso = true;
          }
        }
      }
      const ordinate = [...mappa.values()]
        .map((v) => ({
          ...v,
          chiavo: [...v.chiavi],
          n: v.lezioni.size,
          // Chip "{erogate}/{pianificate}h": ore pubblicate nel calendario e
          // ore già trascorse adesso (una lezione iniziata conta tutta).
          oreLabel: `${oreH(v.oreEro)}/${oreH(v.oreTot)}h`,
          tip: `${oreH(v.oreEro)} h erogate su ${oreH(v.oreTot)} h pubblicate · `
             + `${v.lezioni.size} lezioni`
             + (v.inCorso ? ' · ⏳ lezione in corso' : ''),
          annoCorso: v.anni.size === 1 ? [...v.anni][0] : null,
          annoLabel: v.anni.size
            ? [...v.anni].sort((a, b) => a - b).map((a) => a + '°').join(' / ') + (v.anni.size > 1 ? ' anno' : ' anno')
            : '',
        }))
        .sort((a, b) => a.insegnamento.localeCompare(b.insegnamento));

      // Colore stabile (hash + linear probing) e visibilità dal filtro.
      const usati = new Set();
      const vis = s.materieVisibili; // null = tutte
      for (const m of ordinate) {
        let idx = hashColore(m.insegnamento);
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
    },

    /** true → tutte visibili; false → nessuna. */
    mostraTutteLeMaterie() {
      const s = this.corrente;
      if (!s) return;
      s.materieVisibili = null;
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

    /**
     * Titolo di una lezione calcolato a render-time: nomi dei dettagli
     * deduplicati (la cache vecchia può contenere "X + X + X" pre-fix; così
     * è corretto anche senza aspettare il re-fetch).
     */
    titoloLezione(l) {
      if (!l) return '';
      const nomi = [...new Set(((l.materie || []).map((m) => m && m.nome).filter(Boolean)))];
      return nomi.length ? nomi.join(' + ') : (l.insegnamento || '');
    },

    /**
     * Tutte le informazioni disponibili per una lezione, come righe etichetta/
     * valore (fonti Cineca: details didattici, aula, sede, tipo attivita…).
     * I campi assenti (o nelle cache vecchie) semplicemente non compaiono.
     */
    dettaglioVoci(l) {
      if (!l) return [];
      const righe = [];
      const add = (etichetta, valore) => {
        if (valore === null || valore === undefined || valore === '' || (Array.isArray(valore) && !valore.length)) return;
        righe.push({ etichetta, valore: String(valore) });
      };
      add('Quando', `${this.formattaData(l.inizio, { weekday: 'long', day: 'numeric', month: 'long' })}, ${this.formattaOra(l.inizio)} – ${this.formattaOra(l.fine)}`);
      add('Corso di studio', l.corsoStudi);
      add('Tipo attività', l.tipoAttivita);
      if (l.annoCorso) add('Anno di corso', `${l.annoCorso}°`);
      add('Percorso', Array.isArray(l.percorsi) && l.percorsi.length ? l.percorsi.join('; ') : l.percorso);
      add('Sede', l.sede);
      add('Docenti', l.docenti?.join(', '));
      add('Aule', l.aule?.map((a) => [a.descrizione || a.codice, a.edificio, a.piano].filter(Boolean).join(' · ')).join('; '));
      add('Edifici', Array.isArray(l.edifici) && l.edifici.length ? l.edifici.join('; ') : null);
      add('Partizione', l.partizione);
      add('Codice', l.codice);
      add('CFU', l.cfu);
      add('Tipologia', l.tipoInsegnamento);
      add('Modalità', l.modalitaDidattica);
      add('Durata', l.durataMinuti ? `${Math.round(l.durataMinuti / 60 * 2) / 2} h` : null);
      if (l.stato === 'A') add('Stato', '⚠ Lezione annullata');
      if (l.stato === 'S') add('Stato', '⏸ Lezione sospesa');
      add('Nota', l.notaSospensione);
      return righe;
    },

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
    /** ‹ › scorrono SEMPRE di una settimana intera (7 giorni), anche in 5gg. */
    vai(direzione) {
      this.dataRif = this.vista === 'mese'
        ? aggiungiMesi(this.dataRif, direzione)
        : aggiungiGiorni(this.dataRif, direzione * 7);
      this.ricalcola();
    },
    oggi() { this.dataRif = new Date(); this.ricalcola(); },
    cambiaVista(v) {
      this.vista = v;
      store.setStato({ ...store.getStato(), vista: v });
      this.ricalcola();
    },
    /** Pulsante: alterna 5 giorni (Lun–Ven) ↔ 7 giorni (Lun–Dom). */
    toggleGiorniVisibili() {
      this.giorniVisibili = this.giorniVisibili === 5 ? 7 : 5;
      store.setStato({ ...store.getStato(), giorniVisibili: this.giorniVisibili });
      this.ricalcola();
    },

    /* ============================ piattaforma ========================== */
    get isiOS() {
      const ua = navigator.userAgent || '';
      return /iP(hone|ad|od)/.test(ua) ||
        (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    },
    /** Badge "installa": PWA non installata e il push sarebbe possibile
     *  (iPhone lo offre solo in standalone → va comunque mostrato lì). */
    get pushProntaMaNonInstallata() {
      try { return !this.pwaAtiva && (this.isiOS || pushDisponibile()); } catch { return false; }
    },

    /* ============================== notifiche ==========================
     * Web Push reale tramite il Worker (cron 15 min):
     *  - "lezione tra ~15 min" (dedup server, rispetta le materie visibili);
     *  - "calendario cambiato" quando l'hash Cineca muta.
     * La campanella fa da gate: se la PWA non è installata apre la guida
     * (con "Installa ora" diretto quando il browser offre beforeinstallprompt).
     * ------------------------------------------------------------------- */
    get titleNotifiche() {
      if (this.notificheOn) return 'Notifiche attive: tocca per disattivare';
      if (!this.pwaAtiva) return 'Installa l\'app (PWA) per ricevere le notifiche';
      if (!pushDisponibile()) return 'Notifiche push non supportate da questo browser';
      return 'Attiva notifiche (promemoria + cambi calendario)';
    },

    /** Preferenze da inviare al Worker: calendari + materie visibili. */
    prefsPush() {
      return {
        calendars: this.selezioni.map((s) => ({
          i: s.linkCalendarioId, l: s.etichetta, n: s.corso, m: s.materieVisibili,
        })),
      };
    },

    async toggleNotifiche() {
      // disattivazione
      if (this.notificheOn) {
        this.notificheOn = false;
        store.setStato({ ...store.getStato(), notifiche: false });
        try { await pushDisattiva(); } catch { /* ignora */ }
        this.messaggio = 'Notifiche disattivate.';
        setTimeout(() => (this.messaggio = null), 4000);
        return;
      }
      // GATE 1 — PWA installata. Su iPhone, nella scheda del browser,
      // Notification/PushManager NON esistono nemmeno: il push web vive solo
      // nella PWA standalone. Quindi la guida all'installazione deve venire
      // PRIMA di ogni controllo di supporto, altrimenti su iOS si legge
      // "non supportato" senza mai mostrare come rimediare.
      this.pwaAtiva = pwaInstallata();
      if (!this.pwaAtiva) { this.mostraInstallGuida = true; return; }
      // GATE 2 — capacità reali (in standalone) + Worker configurato
      if (!pushDisponibile() || !CONFIG.workerBase) {
        this.errore = 'Notifiche push non supportate da questo browser (o Worker non configurato).';
        return;
      }
      try {
        await pushAttiva(this.prefsPush());
        this.notificheOn = true;
        this.permNotifiche = 'granted';
        store.setStato({ ...store.getStato(), notifiche: true });
        this.messaggio = 'Notifiche attive: promemoria e cambi, anche ad app chiusa.';
        setTimeout(() => (this.messaggio = null), 5000);
      } catch (e) {
        this.permNotifiche = Notification.permission;
        this.errore = `Attivazione notifiche fallita: ${e.message}`;
      }
    },

    /** Installazione diretta (Chrome/Edge/Android); su iOS resta la guida. */
    async installNow() {
      if (!this.installEvt) return;
      this.installEvt.prompt();
      try { await this.installEvt.userChoice; } catch { /* ignora */ }
      this.installEvt = null;
    },

    /** Debounce: risincronizza le preferenze sul Worker dopo cambi locali. */
    schedulePushSync() {
      if (!this.notificheOn) return;
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => {
        pushSincronizzaPrefs(this.prefsPush())
          .catch((e) => console.warn('[push] sync prefs:', e?.message));
      }, 2500);
    },

    /**
     * Ri-allaccia il push all'avvio senza interventi manuali:
     *  - se la subscription c'è → re-invia le prefs (calendari/materie) al Worker;
     *  - se è sparita (reinstallazione PWA, reset permessi) ma il permesso è
     *    ancora 'granted' → si ri-sottoscrive in silenzio.
     */
    async riprendiPush() {
      if (!pushDisponibile() || !CONFIG.workerBase) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await pushSincronizzaPrefs(this.prefsPush());
        else if (pwaInstallata() && Notification.permission === 'granted') {
          await pushAttiva(this.prefsPush());
        }
      } catch (e) {
        console.warn('[push] self-heal:', e?.message);
      }
    },

    /**
     * Sync automatico all'apertura, attivato SOLO da una notifica di cambio.
     * Due fonti, per robustezza:
     *  1. meta IndexedDB scritto dal SW al push (immediato, locale);
     *  2. GET /lastchange sul Worker (funziona anche se il SW non è partito
     *     o l'IndexedDB non è stato scritto — tipico su iOS con app chiusa).
     * Se una delle due è più recente della cache locale → sync silenzioso.
     */
    async verificaCambioDaPush() {
      if (!this.correnteId) return;
      const cache = store.getCache()[this.correnteId];
      const eta = cache?.aggiornatoIl ? new Date(cache.aggiornatoIl).getTime() : 0;

      let at = 0;
      try {
        const meta = await leggiUltimoCambio();
        if (meta?.at) at = Math.max(at, meta.at);
      } catch { /* niente: passa alla fonte 2 */ }

      if (CONFIG.workerBase && navigator.onLine !== false) {
        try {
          const res = await fetch(`${CONFIG.workerBase}/lastchange`, { cache: 'no-store' });
          if (res.ok) {
            const remoto = await res.json();
            if (remoto?.at) at = Math.max(at, remoto.at);
          }
        } catch { /* offline: si riproverà alla prossima apertura */ }
      }

      if (at > eta) {
        this.messaggio = 'Notifica di aggiornamento ricevuta: sincronizzo…';
        this.aggiornaLezioni({ silenzioso: true });
      }
    },

    /* ======================= pull-to-refresh ============================
     * Trascinamento dal bordo alto (solo a scroll in cima, solo verso il
     * basso): rilascio oltre soglia → sync silenzioso con anello rotante. */
    ptr: { dy: 0, attivo: false },
    _ptrY: null,
    ptrStart(e) {
      if (this.ptr.attivo || this._ptrY !== null) return;
      if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) return;
      this._ptrY = e.touches?.[0]?.clientY ?? null;
    },
    ptrMove(e) {
      if (this._ptrY === null) return;
      const y = e.touches?.[0]?.clientY;
      if (y == null) return;
      const dy = y - this._ptrY;
      if (dy <= 0) { this.ptr.dy = 0; return; }
      // resistenza progressiva (max 70px visivi) + niente bounce nativo
      this.ptr.dy = Math.min(70, dy * 0.5);
      if (e.cancelable) e.preventDefault();
    },
    async ptrEnd() {
      const tiro = this.ptr.dy;
      this._ptrY = null;
      this.ptr.dy = 0;
      if (tiro < 45 || this.ptr.attivo) return;
      if (!this.correnteId || navigator.onLine === false) return;
      this.ptr.attivo = true;
      try {
        await this.aggiornaLezioni({ silenzioso: true });
        this.messaggio = 'Calendario sincronizzato ✓';
      } catch { /* errore già mostrato da aggiornaLezioni */ }
      finally { setTimeout(() => (this.ptr.attivo = false), 400); }
    },

    /* ============================ dettaglio ============================ */
    apriDettaglio(l) { this.dettaglio = l; },
    chiudiDettaglio() { this.dettaglio = null; },
    formattaOra,
    formattaData,
  };
}
