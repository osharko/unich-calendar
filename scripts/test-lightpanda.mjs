/**
 * test-lightpanda.mjs — pilota il browser headless Lightpanda via CDP (senza npm).
 * Richiede: server sulla porta 8123 nella root del repo +
 *   podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
 * Esegue il flusso reale: indice → wizard → anni → lezioni → materie → vista.
 * Uso:  node scripts/test-lightpanda.mjs
 */
const ws = new WebSocket('ws://127.0.0.1:9222/');
let id = 0;
const pend = new Map();
const logs = [];

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pend.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pend.has(msg.id)) {
    const { resolve, reject } = pend.get(msg.id);
    pend.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const t = msg.params.type;
    if (t === 'error' || t === 'warning') {
      logs.push(`[console.${t}] ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[eccezione] ' + (msg.params.exceptionDetails?.exception?.description ||
      msg.params.exceptionDetails?.text || 'n/d'));
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => { ws.onopen = r; });

// Target pagina + attach
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8123/' }, sessionId);
await sleep(3500); // lascia partire Alpine + SW

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate',
    { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};

// Recupera il componente Alpine
const getApp = () => `window.__app = document.querySelector('[x-data]')._x_dataStack[0];`;

const risultati = [];
const ok = (nome, cond, extra = '') => risultati.push(`${cond ? '✓' : '✗'} ${nome}${extra ? ' — ' + extra : ''}`);

try {
  await evaluate(getApp());
  ok('Alpine montato', await evaluate('return !!window.__app && typeof window.__app.scegliPolo === "function"'));

  // Stato iniziale pulito
  await evaluate(`localStorage.clear(); return 1;`);

  // 1)scarica indice (via proxy reale)
  await evaluate(`window.__app.wizardAperto = true; await window.__app.aggiornaIndice(); return 1;`);
  const stats = await evaluate(`return { poli: window.__app.stats.poli, corsi: window.__app.stats.corsi };`);
  ok('indice caricato', stats && stats.corsi > 50, JSON.stringify(stats));

  // 2) wizard: polo → struttura
  await evaluate(`window.__app.scegliPolo('Polo di Chieti'); return 1;`);
  await evaluate(`window.__app.scegliStruttura('Dipartimento di Scienze Filosofiche, Pedagogiche e Sociali'); return 1;`);

  // 3) STEP CORSO: la lista deve essere POPOLATA (il bug del filtro vuoto)
  const corsi = await evaluate(`return window.__app.corsiFiltrati.length;`);
  ok('step Corso: corsiFiltrati non vuoto', corsi === 6, `corsiFiltrati=${corsi}`);

  // 4) filtro di ricerca funzionante
  await evaluate(`window.__app.ricercaCorso='filosofia'; return 1;`);
  const filtrati = await evaluate(`return window.__app.corsiFiltrati.length;`);
  ok('filtro ricerca funziona', filtrati === 1, `con "filosofia" → ${filtrati}`);
  await evaluate(`window.__app.ricercaCorso=''; return 1;`);

  // 5) corso → anni (1 richiesta proxy)
  const anni = await evaluate(`
    const c = window.__app.corsi.find(x=>/Filosofia e Scienze/.test(x.nome));
    await window.__app.scegliCorso(c);
    return window.__app.anniDelCorso.map(a=>a.etichetta);
  `);
  ok('anni caricati', Array.isArray(anni) && anni.length >= 3, JSON.stringify(anni));

  // 6) aggiungi calendario (fetch Cineca reale, CORS)
  await evaluate(`window.__app.aggiungiCalendario(window.__app.anniDelCorso[1]); return 1;`);
  await sleep(6000);
  const lezioni = await evaluate(`return { tot: window.__app.lezioni.length, wiz: window.__app.wizardAperto, err: String(window.__app.errore) };`);
  ok('lezioni da Cineca', lezioni.tot > 100 && lezioni.err === 'null', JSON.stringify(lezioni));

  // 7) materie con colori distinti
  const materie = await evaluate(`return window.__app.materie.map(m=>({n:m.insegnamento, i:m.indiceColore}));`);
  const idx = materie.map((m) => m.i);
  ok('materie colorate', materie.length >= 8 && new Set(idx).size === materie.length,
     `${materie.length} materie, ${new Set(idx).size} colori`);

  // 8) toggle materia: il filtro deve nascondere lezioni reali
  const prima = await evaluate(`return window.__app.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  await evaluate(`
    const m = window.__app.materie.find(x=>/ECONOMIA AZIENDALE/.test(x.insegnamento));
    window.__app.toggleMateria(m); return 1;
  `);
  const dopo = await evaluate(`return window.__app.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  ok('filtro materie funzionante', dopo < prima, `${prima} → ${dopo}`);

  // 9) vista calendario 1/3/7 giorni
  const giorni = await evaluate(`
    const out={};
    for (const g of [1,3,7]) { window.__app.cambiaGiorniVisibili(g); out[g]=window.__app.giorni.length; }
    return out;
  `);
  ok('cambio giorni', giorni[1] === 1 && giorni[3] === 3 && giorni[7] === 7, JSON.stringify(giorni));

  // 10) DOM: blocchi lezione presenti con colore --mat (spostati a ott, lezioni reali)
  await evaluate(`window.__app.dataRif = new Date('2026-10-01T12:00:00'); window.__app.ricalcola(); return 1;`);
  const dom = await evaluate(`return {
    blocchi: document.querySelectorAll('.lesson').length,
    pallini: [...document.querySelectorAll('span')].filter(e=>(e.getAttribute('style')||'').includes('--mat-')).length
  };`);
  ok('blocchi lezione nel DOM', dom.blocchi > 0, `${dom.blocchi} blocchi, ${dom.pallini} elementi colorati`);
} catch (e) {
  risultati.push('✗ ECCEZIONE: ' + e.message);
}

console.log(risultati.join('\n'));
console.log('\n--- log console/exceptioni ---');
console.log(logs.length ? logs.slice(0, 15).join('\n') : '(nessun errore)');

ws.close();
process.exit(0);
