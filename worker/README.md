# unich-proxy — Worker Cloudflare (proxy CORS + push cron)

Un unico Worker gratis fa due cose:
1. **proxy CORS** per `www.unich.it` (lo scraping della PWA);
2. **push scheduler**: ogni 15 min chiama l'API Cineca **una sola volta per
   calendario sottoscritto** (dedup: 100 studenti sullo stesso corso = 1 fetch),
   calcola l'hash degli eventi prossimi e, se cambia, manda un
   `Web Push` "calendario aggiornato" a chi è sottoscritto; invia anche il
   promemoria "lezione tra ~15 min" (dedup per evento, nel rispetto delle
   materie nascoste da ogni studente).

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
