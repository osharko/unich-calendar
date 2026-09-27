# AGENT.md — unich-calendar

Documento di contesto per agenti/developer che lavorano su questo progetto.
Contiene le scoperte tecniche sulle fonti dati, i vincoli e le decisioni di architettura.

---

## 1. Obiettivo

Frontend statico (PWA) che mostra il **calendario delle lezioni** dell'Università
degli Studi "G. d'Annunzio" (Chieti–Pescara) in una griglia **ore sulle ascisse ×
giorni sulle ordinate** (vista "timetable"), responsive e consultabile offline.

Requisiti:

1. **PWA**: le scelte dell'utente (corsi/anni) e i dati restano in locale (`localStorage`),
   consultabile offline senza re-inserire le scelte.
2. **Visualizzazione** nel calendario dei corsi scelti.
3. **Compatibilità con tutti i corsi e tutti gli anni** (requisito ultimo e più difficile).

Vincoli di progetto:

- Pubblicazione su **GitHub Pages** → niente server a pagamento, tutto client-side.
- Stack minimale: **HTML + Alpine.js + Tailwind CSS + Catppuccin** (no framework con compiler).
- Responsiveness mobile come priorità.

---

## 2. Le due fonti dati

### 2.1 API Cineca "University Planner" (le lezioni)

Le pagine di calendario dell'ateneo puntano a un'app AngularJS:

```
https://unich.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=<ID>
```

L'app usa internamente un'API **LoopBack** sotto `https://unich.prod.up.cineca.it/api/...`.
**CORS aperto** (`access-control-allow-origin: *`), quindi è chiamabile direttamente dal browser.

Endpoint rilevanti (tutti verificati):

| Metodo | Endpoint | Scopo |
|---|---|---|
| `GET` | `/api/Clienti/cercaPerDominio?dominio=unich.prod.up.cineca.it` | Trova il `clienteId` |
| `GET` | `/api/Clienti/getInfoPublic` | Configurazione ateneo |
| `POST` | `/api/LinkCalendario/searchCalendarioPubblico` | Metadati di un link calendario |
| `POST` | `/api/Impegni/getImpegniCalendarioPubblico` | **Le lezioni** |
| `GET` | `/api/AnniAccademici/getAnniAccademiciPublic` | Anni accademici |
| `GET` | `/api/Corsi/getPerAutoCompletePublic?lookupFields=descrizione` | Catalogo corsi |
| `GET` | `/api/UnitaOrganizzative/getPerAutoCompletePublic?lookupFields=descrizione` | Dipartimenti/unità |

Identificativi ateneo (costanti, in `js/config.js`):

```js
clienteId  = "5a65a9ebd9fe4f6d0ccf9df6"
dominio    = "unich.prod.up.cineca.it"
```

#### Chiamata metadati calendario

```http
POST /api/LinkCalendario/searchCalendarioPubblico
Content-Type: application/json

{ "linkCalendarioId": "5e8b074b7b901c0018993e06", "filter": {} }
```

Risposta (estratto):

```json
{
  "id": "5e8b074b7b901c0018993e06",
  "payload": {
    "titolo": "Corso di Laurea in Filosofia e Scienze Dell'Educazione 2 Anno",
    "corsi": ["67bfc04c81bb76001fb712cf"],
    "anniCorso": [2],
    "unitaOrganizzative": ["5acb2cf993e81a000f36c33f"],
    "lang": "it",
    "inizioAnnoAccademico": "2025-09-30T22:00:00.000Z"
  }
}
```

Nota: `filter` è obbligatorio (altrimenti HTTP 400). `filter: {}` è sufficiente.

#### Chiamata lezioni

```http
POST /api/Impegni/getImpegniCalendarioPubblico
Content-Type: application/json

{
  "linkCalendarioId": "5e8b074b7b901c0018993e06",
  "clienteId": "5a65a9ebd9fe4f6d0ccf9df6",
  "mostraImpegniAnnullati": false,
  "mostraIndisponibilitaTotali": false,
  "dataInizio": "2026-10-01T00:00:00.000Z",
  "dataFine":   "2026-10-31T23:59:59.000Z"
}
```

Risposta: **array**. Ogni elemento è un *impegno* (lezione **oppure** indisponibilità/festivo).

Campi utili per ogni lezione:

| Campo | Significato |
|---|---|
| `dataInizio` / `dataFine` | Inizio/fine **assoluti** (UTC, già timezone-aware). Usare questi per posizionare l'evento. |
| `orarioInizio` / `orarioFine` | Ora "da orologio" come **Europe/Rome** (campo legacy, NON usare per il calcolo). |
| `indisponibilita` | `true` = festività/chiusura (non è una lezione) |
| `stato` | `P` = pubblicato, `A` = annullato, `S` = sospeso |
| `nome` / `nome_EN` | Titolo attività |
| `annoCorso` | Anno di corso |
| `evento.dettagliDidattici[]` | Insegnamento: `nome`, `codice`, `corsoId`, `annoCorso`, `unitaOrganizzativaId` |
| `docenti[]` | `{ id, nome, cognome }` |
| `aule[]` | `{ id, codice, descrizione, edificio: { descrizione, comune }, piano }` |
| `fattoreDiPartizione.descrizione` | Partizione (gruppo) |
| `percorsi[]` | Percorso (es. "CORSO GENERICO") |
| `serieId` | Lezioni ricorrenti |

#### Dettaglio importante sul fuso orario

`dataInizio` è in UTC. Verificato:

```
dataInizio = 2026-10-01T12:00:00.000Z   → in Italia (CEST, UTC+2) = 01/10/2026 14:00
orarioInizio = 1970-01-01T13:00:00.000Z → legacy, non significativo per il calcolo
```

Quindi: **per rendere le date locali correttamente basta passare `dataInizio`/`dataFine`
a `new Date()` in JS**, che applica automaticamente il fuso del dispositivo.

#### Peso dei dati

Un mese di calendario può pesare **~2,5 MB di JSON** (~100 KB gzip) perché ogni
impegno include oggetti annidati completi (aula, edificio, servizi, ecc.).

→ **Bisogna normalizzare** gli impegni in un modello leggero prima di salvarli
(in `localStorage` ci stanno pochi MB). Vedi `js/api.js` → `normalizeImpegno()`.

#### Note

- Richieste con range ampi restituiscono un volume enorme → conviene comunque
  filtrare per mese/settimana all'occorrenza.
- `mostraIndisponibilitaTotali: true` aggiunge festività/chiusure.
- Gli endpoint `*UP` e `getByIds` richiedono autenticazione (401) → **non usarli**.

### 2.2 Sito `www.unich.it` (la gerarchia Polo → Dipartimento → Corso → Anno)

Pagina indice: `https://www.unich.it/didattica/frequentare/calendario-lezioni`

Struttura (Drupal):
- H2 `Polo di Chieti` / `Polo di Pescara` (macro-gruppo).
- Sotto ogni polo, sezioni H2 `Scuola/Dipartimento ...` (accordion).
- Sotto ogni sezione, `<a>` che puntano o a una **pagina corso** interna
  (`/didattica/frequentare/calendario-lezioni/...`) o direttamente a un link Cineca.

Esempio pagina corso (`.../l-19-l-5-filosofia-e-scienze`):

```html
<a href="https://unich.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=68e8bdfcc451e5001ec50b8c">1 anno</a>
<a href="...">2 anno</a>
<a href="...">3 anno (percorso L-19)</a>
<a href="...">3 anno (percorso L-5)</a>
```

→ **Anno/percorso = `linkCalendarioId`**, che è ciò che serve all'API Cineca.

#### Il problema CORS (fondamentale)

`www.unich.it` **non invia header `Access-Control-Allow-Origin`**. Un browser su
`osharko.github.io` **non può** scaricare direttamente quelle pagine: CORS è una
regola di sicurezza del browser e **non si può aggirare dal FE**. (Con `curl` da
terminale funziona perché `curl` non applica la same-origin policy.)

**Soluzione: Cloudflare Worker proxy** (deployato e attivo):
`https://unich-proxy.unich.workers.dev`

```js
// L'app chiede: GET <worker>/?url=<url-unich-codificata>
fetch("https://unich-proxy.unich.workers.dev/?url=" +
      encodeURIComponent("https://www.unich.it/didattica/frequentare/calendario-lezioni"));
```

Il Worker (codice in `worker/worker.js`, deploy in `worker/README.md`):
- scarica la pagina lato server (dove CORS non si applica) e la re-invia con
  `access-control-allow-origin: *` e cache edge 1h;
- ha un'**allowlist** di soli domini `unich.it`, quindi non è un proxy aperto;
- è configurato in `js/config.js` → `CONFIG.workerBase` (vuoto = scraping
  disabilitato: l'app mostra un errore, non c'è più alcun fallback esterno).

Verificato dopo il deploy (2026-09-27): HTTP 200 + header CORS su GET e
preflight `OPTIONS`; `example.com` respinto con 403; pagine indice/corso
restituiscono l'HTML originale (parsing identico a `curl`).

Lo **scraper gira quindi a runtime nel browser** (`js/scraper.js`) ed è **lazy**:

| Passo utente | Richieste |
|---|---|
| Carica elenco (indice) | **1** (poli, dipartimenti e corsi di tutti) |
| Scegli dipartimento | 0 (corsi già in memoria) |
| Scegli corso → anni/percorsi | **1** (0 se già in cache) |
| Aggiungi un anno | 0 |

Configurare un corso costa quindi **2 richieste**, non una per tutti i 77 corsi.
I risultati (indice e anni per corso) sono salvati in `localStorage`, quindi i
riaccessi sono gratuiti. L'indice si scarica **da solo al primo avvio**; il tasto
**"Aggiorna elenco"** serve solo per ri-sincronizzarlo.

#### Note sugli anni

I calendari linkati dal sito sono **già dell'anno accademico in corso** (il sito
ufficiale aggiorna i link). Quindi "1° anno, 2° anno, ..." corrisponde
automaticamente all'anno accademico corrente, senza logica aggiuntiva.

Alcuni corsi hanno più percorsi per lo stesso anno (es. "3 anno (percorso L-19)"
e "3 anno (percorso L-5)"): vengono mostrati come voci separate.

---

## 3. Architettura

```
index.html                 UI (Alpine.js), unica pagina
sw.js                      service worker (PWA, cache app shell)
manifest.webmanifest       manifest PWA
js/
  config.js                costanti ateneo + proxy + notifiche
  store.js                 localStorage: scelte, indice, anni per corso, cache lezioni, tema
  api.js                   client API Cineca + normalizzazione impegni
  scraper.js               scraping lazy unich.it via proxy → indice + anni corso
  calendar.js              costruzione griglia "timetable" + utilità date
  notify.js                notifiche locali (ponte app ↔ service worker)
  app.js                   stato Alpine, wizard, materie, orchestrazione
css/
  app.css                  sorgente Tailwind + tema Catppuccin
  styles.css               output compilato (committato, servito da GH Pages)
js/vendor/alpine.min.js    Alpine 3 locale (offline, niente CDN)
worker/
  worker.js                Cloudflare Worker (proxy CORS verso unich.it)
  README.md                istruzioni di deploy
icons/                     icone PWA
scripts/
  build-css.sh             compila Tailwind (standalone CLI)
  gen-palette.mjs          (ri)genera i 50 colori --mat-N in css/app.css
  demodulize.mjs           (storia) convertì i moduli ES in script classici
  serve.mjs                server statico zero-dipendenze (solo per test SW/PWA)
  test-lightpanda.mjs      E2E con browser headless via CDP
```

### Vincolo: NESSUN modulo ES

Tutti i `js/*.js` sono **script classici** caricati con `<script src>` in ordine
di dipendenze (config → store → api → scraper → calendar → notify → app).
Motivo: i moduli ES **non partono da `file://`** (il browser blocca gli import
cross-file per CORS); con i classici basta un doppio click sul file.
Se aggiungi un file: dichiaralo come `<script>` in fondo a `index.html`
nell'ordine giusto (lo scope globale condiviso fa da "module system").

### Flusso dati (lazy)

1. Primo accesso: se non c'è l'**indice** in cache, `init()` lo scarica
   **automaticamente** (**1 richiesta**: poli, dipartimenti e corsi) mostrando
   uno skeleton; il tasto "Aggiorna elenco" resta solo per ri-sincronizzare.
2. L'utente sceglie Polo → Dipartimento (i corsi sono già in memoria, 0 richieste).
3. Sceglie il corso → si caricano i suoi **anni/percorsi** (**1 richiesta**, poi cache).
4. Aggiunge l'anno → `linkCalendarioId`.
5. `api.getImpegni(linkCalendarioId, da, a)` → normalizza → cache in `localStorage`.
6. `calendar.disponiLezioni()` dispone le lezioni: **colonne = giorni**, **righe = ore**.
7. L'utente filtra le **materie** da visualizzare.
8. Offline: si legge tutto da `localStorage` tramite il service worker.

### Modello normalizzato di una lezione

```js
{
  id, linkCalendarioId,
  inizio: "2026-10-01T12:00:00.000Z",  // ISO (si interpreta nel fuso locale)
  fine:   "2026-10-01T14:00:00.000Z",
  nome, nomeEn, stato,                 // P/A/S
  insegnamento,                        // titolo (unisce le materie se condiviso)
  chiaveMateria,                       // id dettaglio/i, stabile
  materie: [{ chiave, nome, codice, annoCorso }],  // una lezione può averne più di una
  codice, annoCorso,
  docenti: ["Mario Rossi"],
  aule: [{ codice, descrizione, edificio, comune }],
  percorso, partizione,
  colore: 3                            // indice palette, stabile per insegnamento
}
```

I festivi/chiusure (`indisponibilita: true`) vengono tenuti separati e mostrati
come sfondo/striscia, non come lezioni.

---

## 4. Design

- **Tema**: Catppuccin via variabili CSS (`--ctp-*`): Latte (chiaro) / Mocha /
  Macchiato, switch + preferenza di sistema. Niente colori hardcoded nei componenti.
- **Layout**: griglia CSS `.timetable-grid` con colonne `minmax(82px,1fr)` su
  mobile e nessuna minima su desktop; scala ore `sticky` a sinistra.
  Selettore 1/3/5/7 giorni (default: 3 mobile, 7 desktop).
- **Colori materia**: palette **fissa di 50 colori** (`--mat-0..49`) generata da
  `scripts/gen-palette.mjs` in DUE varianti: set scuro/saturo per il tema chiaro
  (Latte) e set pastello per i temi scuri (Mocha/Macchiato), stesso ordine di
  hue. L'indice è un **hash FNV-1a** della materia (nome|anno) con linear probing
  anti-collisione: stabile anche cambiando calendario. Pill, pallini e blocchi
  usano sempre `var(--mat-N)`.

### Notifiche (promemoria lezione)

Attuale: **notifiche locali** gestite dal service worker (`sw.js` + `js/notify.js`).
- Stato `notificheOn` in topbar (🔔/🔕). L'app invia al SW la lista delle lezioni
  visibili entro ~3 giorni con `postMessage({type:'unich:promemoria', items})`.
- Il SW programma `setTimeout` a `inizio − 15 min` e persiste la lista in
  IndexedDB (`unich-notify`) per ricostruire i timer alla riattivazione.
- **Limiti**: il recapito *garantito ad app chiusa* non è possibile senza push
  da server: il SW viene terminato e i timer non sopravvivono a lungo.
- **Upgrade reale (gratis su Cloudflare)**: Worker + **Cron Triggers** (es. ogni
  15 min) che calcola le lezioni imminenti e invia **Web Push** (VAPID) agli
  abbonati; il client fa solo `PushManager.subscribe()` e mostra la notifica
  nell'handler `push`. Con Pages + Worker proxy sullo stesso account, tutto
  resta in un unico ecosistema gratuito.

## Test con browser headless (Lightpanda)

Lightpanda (`docker.io/lightpanda/browser`) **non rende CSS/visuali**, ma esegue
JS e DOM reali con fetch di rete: ottimo per verifica end-to-end della logica.

```bash
python3 -m http.server 8123 &
podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
node scripts/test-lightpanda.mjs   # 10 asserzioni: wizard→lezioni→materie→vista
```

Per la verifica visiva usare un browser reale.

---

## 5. Sviluppo

Requisiti: nessun Node/npm obbligatorio. Per ricompilare il CSS serve il
**Tailwind standalone CLI** (binario singolo):

```bash
# scarica una volta (esempio v4)
curl -sL -o /tmp/tailwindcss \
  https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-x64
chmod +x /tmp/tailwindcss

# compila
./scripts/build-css.sh          # → css/styles.css (minificato)
```

Per provare in locale:

```bash
python3 -m http.server 8000     # serve la root del repo
# apri http://localhost:8000
```

> Il service worker richiede HTTPS (o `localhost`), quindi non funziona con `file://`.

---

## 7. Interfaccia

- **Wizard di configurazione** a step, una schermata alla volta con breadcrumb:
  Polo → Dipartimento/Scuola → Corso → Anno. Ogni passo mostra solo le voci
  della scelta precedente.
- **Materie**: dopo aver aggiunto un calendario, il pulsante *Materie* apre
  l'elenco degli insegnamenti con checkbox. Deselezionando una materia le sue
  lezioni spariscono dal calendario. Le materie sono raggruppate per nome + anno
  (i dettagli didattici con percorsi/partizioni diversi confluiscono in una voce).
- **Calendario** responsive: selettore 1 / 3 / 5 / 7 giorni. Su mobile il default
  è 3 giorni (così le colonne restano leggibili senza scroll), su desktop 7.
  La scala delle ore è fissa (`sticky`) durante lo scroll orizzontale.
  L'intervallo orario si adatta automaticamente alle lezioni del periodo.

---

## 6. Roadmap

- [x] Analisi API Cineca + vincolo CORS
- [x] Cloudflare Worker proxy (`worker/worker.js`), deployato su unich-proxy.unich.workers.dev
- [x] Scraper indice + anni corso, lazy
- [x] Client API + normalizzazione + cache
- [x] Wizard a step (Polo → Dipartimento → Corso → Anno)
- [x] Selezione materie da visualizzare
- [x] Palette fissa 50 colori materia (scripts/gen-palette.mjs) con varianti light/dark
- [x] Test E2E con Lightpanda (scripts/test-lightpanda.mjs, 13 asserzioni)
- [x] Repo GitHub + deploy Pages (branch main /) o Cloudflare Pages
- [x] Notifiche locali (timer SW, 15 min prima, toggle in topbar)
- [ ] Web Push reali via Cloudflare Cron + VAPID (recapito ad app chiusa)
- [ ] Filtri aggiuntivi (docente, aula) e ricerca nel calendario
- [ ] Test su corsi/anni diversi (requisito 3)
- [ ] Install prompt PWA e rifiniture accessibilità (ARIA, tastiera)
