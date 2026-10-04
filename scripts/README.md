# scripts/ — test, build e rilasci

Nessuna dipendenza npm: solo Node (≥ 20) e, per il CSS, il binario standalone
di Tailwind.

## Test

| comando | cosa verifica |
|---|---|
| `node scripts/test-changelog-unit.mjs` | unit: diff semantico + righe changelog (annullate/spostate/aula/nuove, cap 10) |
| `node scripts/test-push-harness.mjs` | integrazione in-memory del Worker: reminder + dedup, anti-flap, broadcast test, **release**, canale test (KV/fetch mockkati) |
| `node scripts/test-lightpanda.mjs` | **E2E reale** su Lightpanda: wizard, griglia 5/7 gg, chip ore, sync su notifica, pull-to-refresh, gate PWA, tema |
| `node scripts/test-proxy.mjs` | ogni richiesta passa dal Worker allowlist, zero `r.jina.ai` |

Setup per i test con browser (serve per lightpanda e proxy):

```bash
node scripts/serve.mjs 8123 &
podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
node scripts/test-lightpanda.mjs
```

Lightpanda esegue JS/DOM/rete reali ma **non renderizza il CSS**: le asserzioni
sono di logica, non visive. Alcune render pesanti (vista Mese) possono
interrompere il CDP: è un limite dell'engine, il test lo segnala con ⚠ e
prosegue.

## Build CSS

```bash
curl -sL -o /tmp/opencode/tailwindcss \
  https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-x64
chmod +x /tmp/opencode/tailwindcss
TAILWIND_BIN=/tmp/opencode/tailwindcss scripts/build-css.sh
```

Sorgente `css/app.css` → output `css/styles.css` **committato** (serve a
`file://`, dove non gira nessuna build). Se aggiungi una classe Tailwind nuova
in `index.html` e non viene applicata → hai dimenticato di ricompilare.

## Rilasci

```bash
node scripts/bump-version.mjs                                  # solo marcatore footer
node scripts/bump-version.mjs --notes "Fix fuso; Nuova chip ore"  # + push "app aggiornata"
node scripts/bump-version.mjs --no-notify                      # rilascio silenzioso
```

`bump-version.mjs` scrive `js/version.js` (data/commit visibili nel footer) e,
se ricevute note, `notification/release.json` (contatore `released` + righe):
al prossimo `/tick` il Worker notifica tutti **una volta sola**; note vuote =
nessun invio. Poi `git push` e, per non aspettare il cron, un `/tick` forzato.

## Utility

- `serve.mjs [porta]` — server statico minimale (zero dipendenze)
- `gen-palette.mjs` — rigenera i 50 colori `--mat-N` (light+dark) in `css/app.css`
- `gen-vapid.mjs` — coppia chiavi VAPID per il Web Push
- `demodulize.mjs` — converte moduli ES in script classici (vincolo `file://`)
- `push-crypto-ece-check.mjs` — verifica della crittografia ECE/Web Push
