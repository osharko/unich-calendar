# Cloudflare Worker — proxy CORS per unich.it

Il sito `www.unich.it` non invia header CORS, quindi il browser non può
scaricarne le pagine direttamente. Questo Worker fa da ponte e le restituisce
con gli header CORS corretti.

## Deploy rapido (dashboard, gratis)

1. Vai su https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker**.
2. Incolla il contenuto di `worker.js`, assegna un nome (es. `unich-proxy`) e **Deploy**.
3. Annota l'URL: `https://unich-proxy.<tuo-sottodominio>.workers.dev`.
4. In `js/config.js` imposta:

   ```js
   workerBase: 'https://unich-proxy.<tuo-sottodominio>.workers.dev',
   ```

## Deploy con Wrangler (CLI)

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker/worker.js --name unich-proxy
```

## Test

```bash
curl -i "https://unich-proxy.<tuo-sottodominio>.workers.dev/?url=https%3A%2F%2Fwww.unich.it%2Fdidattica%2Ffrequentare%2Fcalendario-lezioni" \
  -H "Origin: https://tuoutente.github.io"
# Attesi: HTTP 200 e header access-control-allow-origin
```

## Sicurezza

Il Worker proxa **solo** i domini in `DOMINI_CONSENTITI` (allowlist unich.it),
quindi non diventa un proxy aperto. In `ORIGINI_CONSENTITE` puoi restringere
le origini; con `'*'` funziona da qualsiasi dominio.
