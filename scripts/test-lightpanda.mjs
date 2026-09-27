/**
 * test-lightpanda.mjs — verifica E2E reale con Lightpanda via CDP (senza npm).
 *
 * Richiede:
 *   node scripts/serve.mjs 8123
 *   podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
 * Esegue:  node scripts/test-lightpanda.mjs
 *
 * NB: Lightpanda NON rende il CSS (niente verifica visiva) ma esegue JS, DOM e
 * rete reali: perfetto per la logica end-to-end (proxy + API Cineca incluse).
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
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[eccezione] ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => { ws.onopen = r; });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate',
    { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};

const A = 'document.querySelector("[x-data]")._x_dataStack[0]';
const risultati = [];
const ok = (nome, cond, extra = '') => risultati.push(`${cond ? '✓' : '✗'} ${nome}${extra ? ' — ' + extra : ''}`);

// Avvio pulito
await send('Page.navigate', { url: 'http://127.0.0.1:8123/' }, sessionId);
await sleep(3000);
await evaluate(`localStorage.clear(); sessionStorage.clear(); location.reload(); return 1;`);
await sleep(3500);

try {
  ok('Alpine montato', await evaluate(`return typeof ${A}.scegliPolo === "function"`));

  // Wizard lazy: indice
  await evaluate(`await ${A}.aggiornaIndice(); return 1;`);
  const stats = await evaluate(`return { corsi: ${A}.stats.corsi, err: String(${A}.errore) };`);
  ok('indice caricato (1 req)', stats.corsi > 50 && stats.err === 'null', JSON.stringify(stats));

  // Step + filtro corsi
  await evaluate(`${A}.scegliPolo('Polo di Chieti'); ${A}.scegliStruttura('Dipartimento di Scienze Filosofiche, Pedagogiche e Sociali'); return 1;`);
  const nCorsi = await evaluate(`return ${A}.corsiFiltrati.length;`);
  ok('step Corso: lista corsi', nCorsi === 6, `${nCorsi} corsi`);
  await evaluate(`${A}.ricercaCorso='filosofia'; return 1;`);
  const nFilt = await evaluate(`return ${A}.corsiFiltrati.length;`);
  ok('filtro corsi', nFilt === 1, `→ ${nFilt}`);
  await evaluate(`${A}.ricercaCorso=''; return 1;`);

  // Anni + aggiunta
  const anni = await evaluate(`const c=${A}.corsi.find(x=>/Filosofia e Scienze/.test(x.nome)); await ${A}.scegliCorso(c); return ${A}.anniDelCorso.map(a=>a.etichetta);`);
  ok('anni del corso (1 req)', anni.length >= 3, JSON.stringify(anni));
  await evaluate(`${A}.aggiungiCalendario(${A}.anniDelCorso[1]); return 1;`);
  await sleep(7000);
  const st = await evaluate(`return { tot: ${A}.lezioni.length, err: String(${A}.errore), wiz: ${A}.wizardAperto, cor: String(${A}.correnteId).slice(0,6) };`);
  ok('lezioni del calendario corrente', st.tot > 100 && st.err === 'null' && !st.wiz, JSON.stringify(st));

  // Materie: colori distinti + toggle cliccando il pill
  const materie = await evaluate(`return ${A}.materie.map(m=>({n:m.insegnamento,c:m.indiceColore}));`);
  ok('materie colorate', materie.length >= 8 && new Set(materie.map(m=>m.c)).size === materie.length,
     `${materie.length} materie`);
  const pillsDom = await evaluate(`return document.querySelectorAll('.pill').length;`);
  ok('pills materie nel DOM', pillsDom === materie.length, `${pillsDom} pills`);
  const prima = await evaluate(`return ${A}.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  await evaluate(`${A}.toggleMateria(${A}.materie[0]); return 1;`);
  const dopo = await evaluate(`return ${A}.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  ok('toggle materia nasconde lezioni', dopo < prima, `${prima} → ${dopo}`);

  // Blocchi colorati nella griglia
  const dom = await evaluate(`return {
    lesson: document.querySelectorAll('.lesson').length,
    matVar: [...document.querySelectorAll('.lesson,.pill')].filter(e=>(e.getAttribute('style')||'').includes('--mat-')).length
  };`);
  ok('blocchi con var(--mat-*)', dom.lesson > 0 && dom.matVar > 0, `${dom.lesson} lesson, ${dom.matVar} colorati`);

  // Cambio calendario dal dropdown (aggiungo il 3° anno)
  await evaluate(`${A}.aggiungiCalendario(${A}.anniDelCorso[2]); return 1;`);
  await sleep(5000);
  const cor2 = await evaluate(`return { id: String(${A}.correnteId).slice(0,6), tot: ${A}.lezioni.length };`);
  ok('switch calendario corrente', cor2.id !== st.cor && cor2.tot > 0, JSON.stringify(cor2));

  // Notifiche: in Lightpanda Notification non c'è → deve degradare con un messaggio, non crash
  const notif = await evaluate(`await ${A}.toggleNotifiche(); return { p: ${A}.permNotifiche, e: String(${A}.errore) };`);
  ok('fallback notifiche', notif.p === 'unsupported' || notif.e !== 'null', JSON.stringify(notif));

  // Tema: 2 stati
  const temi = await evaluate(`
    const a=${A}; const t0=a.temaAttuale; a.toggleTema(); const t1=a.temaAttuale;
    a.toggleTema(); const t2=a.temaAttuale;
    return { t0, t1, t2, attr: document.documentElement.getAttribute('data-theme') };
  `);
  ok('tema a 2 stati', temi.t0 !== temi.t1 && temi.t2 === temi.t0, JSON.stringify(temi));
} catch (e) {
  risultati.push('✗ ECCEZIONE: ' + e.message);
}

console.log(risultati.join('\n'));
console.log('\n--- log console/exceptioni ---');
console.log(logs.length ? logs.slice(0, 12).join('\n') : '(nessun errore)');
ws.close();
process.exit(risultati.some(r => r.startsWith('✗')) ? 1 : 0);
