# unich-calendar

Calendario delle lezioni dell'Università degli Studi "G. d'Annunzio" (Chieti–Pescara),
come **PWA statica** pubblicabile su GitHub Pages. Nessun server, tutto nel browser.

## Cosa fa

- Costruisce la gerarchia **Polo → Dipartimento/Scuola → Corso → Anno/percorso** leggendo
  il sito dell'ateneo, in modo **lazy**: una richiesta per l'elenco, una per il corso scelto.
- Scarica le lezioni dall'API pubblica Cineca e le mostra in una griglia
  **ore × giorni**, responsive e adatta al mobile.
- Permette di **scegliere quali materie visualizzare**: utile quando il calendario
  include molti corsi a scelta che non ti interessano.
- Salva tutto in `localStorage`: al riavvio ritrovi le scelte e puoi consultare
  offline, senza reinserire nulla.

## Uso

1. Apri il sito e premi **⟳ Aggiorna elenco** (solo la prima volta: i dati restano salvati).
2. Segui il wizard: Polo → Dipartimento/Scuola → Corso → Anno.
3. **Materie**: clicca i pill sopra la griglia per mostrare/nascondere gli
   insegnamenti (il colore del pallino è quello dei blocchi in calendario).
4. Il **titolo in alto** è il calendario corrente: cliccalo per cambiare anno,
   rimuoverlo o aggiungere un altro corso.
5. **🔔** attiva i promemoria 15 minuti prima della lezione (funziona mentre
   l'app è aperta/SW vivo; per il recapito ad app chiusa serve push da server,
   vedi AGENT.md §notifiche). **☀/☾** cambia tema; **⟳** aggiorna le lezioni.

## Servire in locale (senza python, senza server!)

I JS sono **script classici** (non moduli ES): basta un **doppio click su
`index.html`** (`file://`). Nessuna build, nessun server, nessun runtime.
Unica eccezione: il **service worker** (cache offline/PWA) funziona solo su
http/https — per testarlo:

```bash
node scripts/serve.mjs 8080     # server statico zero-dipendenze
# oppure nginx, caddy, php -S, `npx serve`, …
```

Test E2E headless (JS/DOM/rete reali; il CSS non viene renderizzato):

```bash
node scripts/serve.mjs 8123 &
podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
node scripts/test-lightpanda.mjs
```

## Proxy CORS (Cloudflare Worker)

`www.unich.it` non invia header CORS, quindi il browser non può scaricarne le pagine.
Serve un piccolo **Cloudflare Worker** che fa da ponte (piano gratuito). Il codice è
in `worker/worker.js` e le istruzioni in `worker/README.md`:

1. Cloudflare → Workers & Pages → Create Worker → incolla `worker/worker.js` → Deploy.
2. In `js/config.js` imposta `workerBase: 'https://unich-proxy.<tuo>.workers.dev'`.

Senza Worker, l'app usa di riserva il proxy pubblico `r.jina.ai`
(serve l'header `X-Return-Format: html`, già gestito in `js/config.js`).

## Deploy: GitHub Pages o Cloudflare Pages (indifferenti)

Entrambi vanno bene, sono **statici puri** (nessuna build):

- **GitHub Pages**: Settings → Pages → branch `main` / (root). Zero config.
- **Cloudflare Pages** (consigliato se usi già il Worker): collega il repo,
  *Build command* vuoto, *Output* `/`. In più: dominio tuo, HTTPS, preview per
  branch e deploy automatici. Stesso account del proxy → tutto in un posto.

Non serve affatto Pages: anche un Worker statico di Cloudflare o un S3 bucket
funzionerebbero. L'unica cosa che conta è che il **service worker** richieda HTTPS
(entrambi lo danno) e che `sw.js` resti alla root.

## Test automatici (Lightpanda)

Verifica end-to-end con browser headless (esegue JS/DOM/rete, non il CSS):

```bash
python3 -m http.server 8123 &
podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
node scripts/test-lightpanda.mjs
```

## Stack

- **Alpine.js** (locale, nessuna CDN) per la reattività.
- **Tailwind CSS v4** (compilato, `css/styles.css` committato).
- **Tema Catppuccin** (Latte / Mocha / Macchiato) via variabili CSS.
- **Service worker** per l'app shell e la consultazione offline.

## Sviluppo

Vedi [`AGENT.md`](AGENT.md) per l'analisi completa delle fonti dati, il vincolo CORS
e le decisioni di architettura.

```bash
python3 -m http.server 8000   # http://localhost:8000
```

Per ricompilare il CSS serve il Tailwind standalone CLI (nessun Node richiesto):

```bash
curl -sL -o /tmp/tailwindcss \
  https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-x64
chmod +x /tmp/tailwindcss
./scripts/build-css.sh
```

## Deploy su GitHub Pages

Pubblica il contenuto della root del repo (branch `main`, cartella `/`).
Tutti i percorsi sono relativi, quindi funziona anche in una sottocartella.

## Avvertenze

- Progetto **non ufficiale**, non affiliato all'ateneo.
- I dati provengono da fonti pubbliche (`unich.it` e API Cineca). Potrebbero cambiare
  formato senza preavviso; lo scraper è isolato in `js/scraper.js` per facilitare gli aggiornamenti.
- Lo scraping passa da un proxy di lettura gratuito con CORS aperto (`r.jina.ai`).
  Se non disponibile, si può sostituire con un Cloudflare Worker (vedi `AGENT.md`).
