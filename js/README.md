# js/ — front-end (script classici, zero build)

Tutto il codice dell'app vive in `js/` ed è caricato in `index.html` con
`<script src>` **classici** (nessun `type="module"`): così il sito parte anche
da `file://` con un doppio click. Ogni file espone funzioni/oggetti globali
(`CONFIG`, `unichApp`, `leggiUltimoCambio`, …) nello stesso scope.

## Ordine di caricamento (significativo)

```
config.js    CONFIG: URL proxy/Cineca, schemaCache, numColori, vapidPublicKey
version.js   APP_BUILD (rigenerato da scripts/bump-version.mjs a ogni rilascio)
store.js     persistenza localStorage (vedi sotto)
api.js       client API Cineca → normalizzazione eventi (inizio/fine/aule/sede…)
scraper.js   scraping gerarchia Polo → Struttura → Corso → Anno (lazy, 1 req/corso)
calendar.js  pura: intervalli, giorni, disposizione lezioni in griglia
notify.js    Web Push: attivazione, prefs, self-heal, lettura meta "changed"
app.js       stato Alpine.js + orchestrazione (unichApp)
alpine.min.js (defer) → x-data="unichApp()" x-init="init()"
```

`calendar.js` e `store.js` sono **puri/utilitari**: nessun accesso al DOM.

## Persistenza (localStorage, prefisso `unich:v1:`)

| chiave      | contenuto |
|-------------|-----------|
| `stato`     | tema, vista, giorniVisibili, selezioni calendari, materie visibili per calendario |
| `indice`    | gerarchia corsi (cache dell'elenco, con `generatoIl`) |
| `anni`      | anni/percorsi risolti per corso |
| `cache`     | `{ [linkCalendarioId]: { aggiornatoIl, schema, lezioni } }` |

`CONFIG.schemaCache` marca lo **schema delle lezioni**: quando cambia, le cache
vecchie risultano "storiche" e vengono rifetchate silenziosamente all'apertura
(`store.cacheStorica`) — evita di mostrare vecchi record senza `sede`/`corsoStudi`.

## Colori materia

Palette **fissa** di 50 colori `--mat-0..49` (light + dark) generata da
`scripts/gen-palette.mjs` e scritta in `css/app.css`. L'indice è
**FNV-1a sul nome** + linear probing: stesso insegnamento → sempre lo stesso
colore, gruppi adiacenti non si sovrappongono. Raggruppamento **per solo nome**
(insegnamento = chiave di visualizzazione).

## Chip ore `{erogate}/{pianificate}h`

In `app.js → get materie()`: somma `durataMinuti` delle lezioni del gruppo
(annullate escluse) e di quelle già iniziate (`inizio <= oraAdesso`).
La reattività al passare del tempo viene da `oraAdesso`, aggiornato ogni
minuto e al ritorno in primo piano (`visibilitychange`) → le ore erogate e
l'effetto "lezione in corso" (pallino `animate-pulse`, bordo pieno) si
aggiornano da soli, senza refresh.

## Sync: aggiornamento solo quando serve

`verificaCambioDaPush()` (all'apertura) confronta l'età della cache con **due**
fonti e fa il sync silenzioso solo se una delle due è più recente:

1. **IndexedDB** `unich-push/meta/lastChange` scritto dal service worker al
   push `changed` (immediato, locale);
2. **`GET <worker>/lastchange`** — istante dell'ultimo `changed` davvero
   inviato dal Worker (funziona anche con app chiusa/SW non partito).

In più il **pull-to-refresh**: tiro dal bordo alto (solo da scroll in cima,
soglia 45px visivi) → `aggiornaLezioni({ silenzioso: true })`.
Il refresh "alla cieca" all'avvio NON esiste: per il resto si aggiorna solo su
notifica, su ⟳ manuale o su ritorno online.

## Notifiche (`notify.js`)

- `pushAttiva(prefs)` → subscribe + POST `/subscribe` (calendari + materie visibili);
- `pushSincronizzaPrefs` → risincronizza dopo un cambio di selezioni (debounce);
- `riprendiPush()` → self-heal all'apertura (re-subscribe se la subscription è
  persa ma il permesso è ancora `granted`);
- il gate della campanella: PWA installata **prima** del controllo di supporto
  (su iOS nel browser `Notification` non esiste → guida d'installazione).

Il resto (chi decide *cosa* mandare) è nel Worker: `worker/README.md`.
