# Calendario lezioni Ud'A

Se vi interessa: è nato questo sito che funziona da calendario per l'Ud'A —
mostra le lezioni settimana per settimana, **manda una notifica prima di ogni
lezione** e permette di customizzare le lezioni da seguire, filtrando i corsi
che non vi interessano, così da avere notifiche personalizzate e una visione
del calendario più comoda per le vostre esigenze.

## Cosa fa

- **Lezioni ore × giorni**: la settimana parte sempre da **lunedì**, con vista
  da 5 o 7 giorni (pulsante 🗓) e navigazione sempre a settimane intere (‹ ›).
- **Notifiche prima di ogni lezione**: un promemoria ~15 minuti prima, e un
  avviso appena cambia qualcosa nel calendario (lezione annullata, spostata,
  aula diversa, nuova lezione).
- **Materie a scelta**: i pill sotto il calendario nascondono/mostrano gli
  insegnamenti — spariscono dalla griglia **e dalle notifiche**, così ricevete
  solo ciò che vi serve.
- **Ore erogate**: ogni materia indica quante ore sono già passate su quante
  sono pubblicate (`18/60h`); mentre una lezione è in corso, la chip la mette
  in evidenza.
- **Resta tutto sul dispositivo**: le scelte (corsi, materie, tema) sono
  salvate localmente e si consulta bene anche offline.

## Come si usano

1. Aprite il sito: **l'elenco dei corsi si scarica da solo** al primo avvio.
2. Seguite il wizard: **Polo → Dipartimento/Scuola → Corso → Anno**.
3. Il **titolo in alto** è il calendario attivo: cliccandolo potete cambiarlo,
   toglierne uno o aggiungerne un altro.
4. Sotto il calendario scegliete le **materie** (il pallino colorato è lo
   stesso dei blocchi in griglia).
5. **⟳** aggiorna le lezioni, **‹ ›** cambiano settimana, **☀/☾** cambia tema.

## Notifiche

Si attivano con la **campanella in alto**. Per riceverle anche con l'app
chiusa serve installarla sul dispositivo e concedere il permesso: la campanella
vi guida passo passo (su iPhone è *Condividi → Aggiungi a schermata Home*, su
Android/desktop di solito basta "Installa").

Cosa arriva:

- **Promemoria**: «Tra ~15 min: Storia della filosofia II · Aula B2»
- **Cambi calendario**: la lista di cosa è cambiato, per ogni corso
  («✕ Annullata: …», «↔ spostata: lun 10:00 → mar 12:00», «📍 aula …»)
- **Nuove versioni dell'app**: una notifica quando esce un aggiornamento.

Tutto controllato **ogni 15 minuti**, anche quando il sito è chiuso.

## Segnalazioni

Problemi, idee o correzioni ai calendari:
[luigi.minopoli@studenti.unich.it](mailto:luigi.minopoli@studenti.unich.it)

Nel piè di pagina trovate la **versione rilasciata** (data + commit): utile per
capire se la vostra installazione è aggiornata.

---

<details>
<summary><strong>Per chi sviluppa (info tecniche)</strong></summary>

- [`js/README.md`](js/README.md) — architettura del front-end (Alpine.js,
  vincolo "no moduli ES", localStorage, colori, sync e notifiche)
- [`worker/README.md`](worker/README.md) — Cloudflare Worker: proxy CORS,
  cron di push, diff calendario, VAPID, deploy
- [`scripts/README.md`](scripts/README.md) — test, build CSS, rilasci
- [`AGENT.md`](AGENT.md) — analisi fonti dati, CORS, decisioni d'architettura

Servire in locale: `node scripts/serve.mjs 8080` (l'app funziona anche con un
semplice doppio click su `index.html`, tranne il service worker che richiede
http/https).

</details>

## Avvertenze

- Progetto **non ufficiale**, non affiliato all'ateneo.
- I dati provengono da fonti pubbliche (`unich.it` e API Cineca): possono
  cambiare formato senza preavviso.
