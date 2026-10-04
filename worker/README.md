# unich-proxy — Worker Cloudflare (proxy CORS + push cron)

Un unico Worker gratis fa due cose:
1. **proxy CORS** per `www.unich.it` (lo scraping della PWA);
2. **Push scheduler (cron 15 min)**: chiama l'API Cineca **una sola volta per
   calendario sottoscritto** (dedup: 100 studenti sullo stesso corso = 1
   fetch). **Non è un confronto di hash grezzo** (notificherebbe ogni giorno
   per il semplice scorrere della finestra): fa un **diff semantico** sulle
   sole lezioni *future* → notifica solo per aggiunte/annullamenti/spostamenti
   d'orario o aula. Anti-flap (>60% sparite = guasto Cineca: tace e congela lo
   snapshot), targeting per materie nascoste, reminder 8–25 min con dedup.
   Invia anche il canale di test `notification/test.json` e il canale release
   `notification/release.json` (entrambi in isolamento).

**Fuso orario**: le ore nei messaggi (reminder e changelog) usano `Europe/Rome`
di default, sovrascrivibile con la variabile d'ambiente `TZ` del Worker
(è un'app italiana: di base è sempre veritiera).

## Endpoint

| route | accesso | scopo |
|---|---|---|
| `/?url=…` | pubblico | proxy CORS (allowlist `*.unich.it`) |
| `POST /subscribe`, `POST /unsubscribe` | pubblico | iscrizione/rimozione push + prefs (calendari e materie visibili) |
| `GET /vapid` | pubblico | chiave pubblica VAPID |
| `GET /lastchange` | pubblico | `{at, cals}` dell'ultimo "calendario cambiato" inviato → la PWA all'apertura fa il sync automatico solo se più recente della cache |
| `GET /tick` | `x-cron-secret` | forza un giro di cron (stessa logica del cron `*/15`) |
| `GET /subs` | `x-cron-secret` | debug: sottoscrizioni registrate |

## Prerequisiti (una tantum)

1. **Chiavi VAPID**: `node scripts/gen-vapid.mjs` (nella root del sito).
   Copia `PUBLIC_KEY` in `js/config.js → vapidPublicKey` (già fatto).
2. **KV namespace**: dashboard Cloudflare → **Storage & Databases → KV → Create
   namespace**, nome `unich-push` (binding `PUSH`).

## Deploy (dashboard)

1. Workers & Pages → il worker `unich-proxy` → **Settings → Code**: incolla il
   contenuto di `worker.js` → **Deploy**.
2. **Settings → Binding → KV namespace**: aggiungi binding con nome esatto
   `PUSH` → namespace `unich-push` → Deploy.
3. **Settings → Variables**:
   - Variables: `VAPID_PUBLIC` = PUBLIC_KEY, `VAPID_SUBJECT` = `mailto:una-tua@email.it`
   - **Secrets**: `VAPID_PRIVATE` = PRIVATE_JWK (tutto il JSON)
     *(e opz. `CRON_SECRET` = stringa a caso, per il debug)*
   → Save and Deploy.
4. **Settings → Triggers → Cron Schedules**: aggiungi `*/15 * * * *`
   (ogni 15 min) → Save.

## Deploy (wrangler CLI, equivalente)

```bash
npm i -g wrangler && wrangler login
wrangler kv namespace create unich-push          # incolla l'id in wrangler.toml
wrangler deploy                                  # usa wrangler.toml + worker.js
# secrets:
wrangler secret put VAPID_PRIVATE
wrangler secret put VAPID_SUBJECT
```

## Verifica

```bash
# stato del servizio + subscribe (health)
curl https://unich-proxy.unich.workers.dev/
# forza il giro di cron ora (serve CRON_SECRET, se impostato)
curl -H "x-cron-secret: IL_TUO_SECRET" https://unich-proxy.unich.workers.dev/tick
# sottoscrizioni registrate (debug)
curl -H "x-cron-secret: IL_TUO_SECRET" https://unich-proxy.unich.workers.dev/subs
```

Il client (PWA) chiama `/subscribe` da solo quando l'utente attiva 🔔
(richiede PWA installata; iOS/Android/desktop standard).

## Note

- Allowlist proxy: solo `*.unich.it`; gli endpoint push sono aperti (serve per
  iscriversi) ma salvano **solo** token di consegna + preferenze materie.
- Il cron costa 1 richiesta KV + 1 fetch Cineca per calendario: con 30 corsi
  sottoscritti = ~2 richieste/min in media, ben dentro i limiti free.
- Sottoscrizioni morte (endpoint 404/410) vengono rimosse automaticamente.


## Canale di prova (notifiche test senza Cineca)

Nel repo c'è `notification/test.json` con un campo `message`. Il cron del Worker,
in **completa indipendenza** dai controlli Cineca (un try/catch separato), lo
legge da raw.githubusercontent: se l'hash del file cambia rispetto al giro
precedente, fa un **broadcast di test** a tutti gli abbonati col nuovo testo.

- Primo tick dopo deploy: salvata come *baseline*, non notifica.
- Modifichi `message` su GitHub → entro 15 min (o subito con `curl /tick`) arriva
  `🔔 Notifica di test: <message>` a chi ha il push attivo.
- `message` vuoto = nessun invio (ma baseline aggiornata).
- URL file sovrascrivibile con la variabile `TEST_URL` (se cambi repo/branch).

## Canale release (notifica di versione)

`notification/release.json` (`{ version, releasedAt, released, notes }`) viene
scritto da `node scripts/bump-version.mjs --notes "…;…"`. Il cron lo legge in
isolamento come il canale di prova:

- `released` (contatore crescente) diverso dal precedente + `notes` non vuote →
  broadcast `Unich-calendar aggiornato` con le note (max 10 righe, poi "… e altre N");
- note vuote → nessun invio (solo baseline aggiornata);
- primo tick → baseline silenziosa;
- URL sovrascrivibile con `RELEASE_URL`.

Flusso di rilascio: `bump-version.mjs --notes "…"` → `git push` →
`curl -H "x-cron-secret: …" …/tick` (altrimenti arriva entro 15 min dal cron).

## Sync-on-notify

Quando viene inviato davvero un push `changed`, il Worker salva in KV
(`lastchange`, TTL 180 gg) l'istante e i corsi coinvolti. La PWA, all'apertura,
legge `GET /lastchange` (più il meta IndexedDB scritto dal SW) e fa il sync
**solo** se è più recente della propria cache: niente refresh "alla cieca".
