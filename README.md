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

1. Apri il sito: **l'elenco dei corsi si scarica da solo** al primo avvio
   (una sola richiesta; poi resta salvato sul dispositivo). Il pulsante
   **⟳ Aggiorna elenco** serve solo per ri-sincronizzarlo in futuro.
2. Segui il wizard: Polo → Dipartimento/Scuola → Corso → Anno.
3. **Materie**: clicca i pill sotto la griglia per mostrare/nascondere gli
   insegnamenti (il colore del pallino è quello dei blocchi in calendario).
4. Il **titolo in alto** è il calendario corrente: cliccalo per cambiare anno,
   rimuoverlo o aggiungere un altro corso.
   ⚠️ Su **iOS** non esiste il pulsante "Installa ora" (Apple non implementa
   `beforeinstallprompt`): la guida mostra i passi manuali *Condividi →
   Aggiungi a schermata Home*; l'icona corretta è già servita via
   `apple-touch-icon` (180px, opaca).
5. Il calendario parte **sempre da lunedì**: il pulsante **🗓** alterna 5 giorni
   (Lun–Ven) ↔ 7 giorni (Lun–Dom); **‹ ›** scorrono sempre di una settimana.
   **☀/☾** cambia tema; **⟳** aggiorna le lezioni.
6. **🔔 Notifiche push** (promemoria "lezione tra ~15 min" + "calendario
   aggiornato", recapitate **anche ad app chiusa**): richiede la PWA installata —
   se non lo è, la campanella guida all'installazione (pulsante diretto dove il
   browser lo offre). Dietro c'è il cron del Worker: segui `worker/README.md`
   per attivare KV + VAPID + cron (dopo il primo deploy del Worker aggiornato).

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

## Cloudflare Worker: proxy CORS + push

Lo stesso Worker gratuito fa due cose (`worker/worker.js`):

1. **Proxy CORS** per `www.unich.it` (allowlist: solo domini d'ateneo) — senza
   di esso il browser non può scaricare indice dei corsi e anni.
2. **Push scheduler** con **Cron ogni 15 min**: un solo fetch Cineca per
   calendario sottoscritto (dedup tra studenti), confronto hash e invio di
   Web Push "calendario aggiornato" + promemoria "lezione tra ~15 min"
   (rispetta le materie nascoste di ciascuno). Recapita **anche ad app chiusa**.

**Attivo**: `https://unich-proxy.unich.workers.dev` (in `js/config.js`).
Il Worker deployato è però la versione vecchia (solo proxy): per abilitare il
push followa `worker/README.md` (incollare il nuovo codice + KV namespace +
chiavi VAPID + cron trigger, ~5 minuti, sempre gratis). Se `workerBase` è
vuoto lo scraping è disabilitato (nessun fallback esterno).

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
- Lo scraping passa da un Worker Cloudflare gratuito (allowlist unich.it).
  Se non disponibile, si può sostituire con un Cloudflare Worker (vedi `AGENT.md`).
