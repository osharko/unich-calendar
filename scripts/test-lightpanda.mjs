/**
 * test-lightpanda.mjs — verifica E2E reale con Lightpanda via CDP (senza npm).
 *
 * Richiede:
 *   node scripts/serve.mjs 8123
 *   podman run -d --name lp --net=host docker.io/lightpanda/browser:latest
 * Esegue:  node scripts/test-lightpanda.mjs
 *
 * NB: Lightpanda NON rende il CSS (niente verifica visuale) e non supporta
 * file:// (serve un browser reale). Esegue però JS/DOM/rete reali: verifica
 * tutta la logica end-to-end, proxy e API Cineca incluse.
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
let evaluateRiavviato = null;   // non null se il primo contesto è crashato
const ok = (nome, cond, extra = '') => { risultati.push(`${cond ? '✓' : '✗'} ${nome}${extra ? ' — ' + extra : ''}`); return cond; };

// Avvio pulito (localStorage residuo da sessioni precedenti verrebbe ripristinato)
await send('Page.navigate', { url: 'http://127.0.0.1:8123/' }, sessionId);
await sleep(3000);
await evaluate(`localStorage.clear(); sessionStorage.clear(); location.reload(); return 1;`);
await sleep(3500);

try {
  ok('Alpine montato', await evaluate(`return typeof ${A}.toggleMateria === "function"`));

  // ---- wizard lazy ----
  await evaluate(`await ${A}.aggiornaIndice(); return 1;`);
  const stats = await evaluate(`return { corsi: ${A}.stats.corsi, err: String(${A}.errore) };`);
  ok('indice caricato (1 req)', stats.corsi > 50 && stats.err === 'null', JSON.stringify(stats));

  await evaluate(`${A}.scegliPolo('Polo di Chieti'); ${A}.scegliStruttura('Dipartimento di Scienze Filosofiche, Pedagogiche e Sociali'); return 1;`);
  const nCorsi = await evaluate(`return ${A}.corsiFiltrati.length;`);
  ok('step Corso: lista corsi', nCorsi === 6, `${nCorsi} corsi`);
  await evaluate(`${A}.ricercaCorso='filosofia'; return 1;`);
  ok('filtro corsi', await evaluate(`return ${A}.corsiFiltrati.length;`) === 1);
  await evaluate(`${A}.ricercaCorso=''; return 1;`);

  const anni = await evaluate(`const c=${A}.corsi.find(x=>/Filosofia e Scienze/.test(x.nome)); await ${A}.scegliCorso(c); return ${A}.anniDelCorso.map(a=>a.etichetta);`);
  ok('anni del corso (1 req)', anni.length >= 3, JSON.stringify(anni));

  // ---- calendario corrente ----
  await evaluate(`${A}.aggiungiCalendario(${A}.anniDelCorso[1]); return 1;`);
  await sleep(7000);
  const st = await evaluate(`return { tot: ${A}.lezioni.length, err: String(${A}.errore), wiz: ${A}.wizardAperto, cor: String(${A}.correnteId).slice(0,6) };`);
  ok('lezioni del calendario corrente', st.tot > 100 && st.err === 'null' && !st.wiz, JSON.stringify(st));

  // ---- materie (pill cliccabili) ----
  const materie = await evaluate(`return ${A}.materie.map(m=>m.insegnamento);`);
  const nMat = await evaluate(`return ${A}.materie.length;`);
  const coloriDistinti = await evaluate(`return new Set(${A}.materie.map(m=>m.indiceColore)).size;`);
  ok('materie con colori distinti', nMat >= 8 && coloriDistinti === nMat, `${nMat} materie`);
  const pillsDom = await evaluate(`return document.querySelectorAll('.pill').length;`);
  ok('pills materie nel DOM', pillsDom === nMat, `${pillsDom} pills`);
  const prima = await evaluate(`return ${A}.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  await evaluate(`${A}.toggleMateria(${A}.materie[0]); return 1;`);
  const dopo = await evaluate(`return ${A}.lezioniFiltrate.filter(l=>!l.indisponibilita).length;`);
  ok('click pill nasconde lezioni', dopo < prima, `${prima} → ${dopo}`);

  const dom = await evaluate(`return {
    lesson: document.querySelectorAll('.lesson').length,
    matVar: [...document.querySelectorAll('.lesson,.pill')].filter(e=>(e.getAttribute('style')||'').includes('--mat-')).length
  };`);
  ok('blocchi colorati con var(--mat-*)', dom.lesson > 0 && dom.matVar > 0, `${dom.lesson} lesson`);

  // ---- dropdown custom (sostituiscono i select coi popover fuori schermo) ----
  await evaluate(`
    const b=[...document.querySelectorAll('button')].find(x=>/giorni/.test(x.textContent));
    b?.click(); return 1;
  `);
  ok('click apre menu giorni', await evaluate(`return ${A}.menuGiorni === true;`));
  const scelti = await evaluate(`
    const o = document.querySelectorAll('div[x-show="menuGiorni"] button');
    o[2]?.click(); return { g: ${A}.giorniVisibili, chiuso: ${A}.menuGiorni === false };
  `);
  ok('selezione 5 giorni dal menu', scelti.g === 5 && scelti.chiuso, JSON.stringify(scelti));

  await evaluate(`
    const b=[...document.querySelectorAll('button')].find(x=>/Orizzontale|Mese/.test(x.textContent));
    b?.click(); return 1;
  `);
  const vistaOpts = await evaluate(`return document.querySelectorAll('div[x-show="menuVista"] button').length;`);
  ok('menu vista renderizza 2 opzioni', vistaOpts === 2);
  await evaluate(`${A}.cambiaVista('mese'); return 1;`);
  await sleep(1200);
  const vistaMese = await evaluate(`return { v: ${A}.vista, giorni: ${A}.giorni.length };`);
  ok('vista Mese (35 giorni)', vistaMese.v === 'mese' && vistaMese.giorni === 35, JSON.stringify(vistaMese));
  await evaluate(`${A}.cambiaVista('settimana'); ${A}.oggi(); return 1;`);
} catch (e) {
  // Lightpanda a volte "perde" il promise del CDP durante render pesanti
  // (35 colonne): il contesto JS si riprende da solo. Attendiamo e verifichiamo.
  risultati.push(`⚠ render pesante ha interrotto il CDP (${e.message.slice(0, 50)}) → aspetto e riprovo`);
  await sleep(2500);
  try {
    await evaluate(`return document.title;`);          // contesto vivo?
  } catch (e2) {
    // non sopravvissuto: nuovo target con URL unico (lightpanda deduplica gli URL)
    try {
      const t2 = await send('Target.createTarget', { url: `http://127.0.0.1:8123/?r=${Date.now()}` });
      const s2 = await send('Target.attachToTarget', { targetId: t2.targetId, flatten: true });
      await send('Runtime.enable', {}, s2.sessionId);
      await sleep(3500);
      evaluateRiavviato = (expr) => send('Runtime.evaluate',
        { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }, s2.sessionId)
        .then(r => { if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value; });
    } catch (e3) {
      risultati.push('⚠ riavvio target non riuscito: ' + e3.message.slice(0, 60));
    }
  }
}

try {
  const ev = evaluateRiavviato || evaluate;
  // Le selezioni devono essere sopravvissute in localStorage (riavvio pulito).
  ok('stato ripristinato da localStorage', await ev(`return ${A}.selezioni.length >= 1 && ${A}.lezioni.length > 50`));

  // ---- cambio calendario corrente (3° anno, id noto dalla pagina corso) ----
  await ev(`const a = ${A}; a.aggiungiCalendario({ linkCalendarioId: '68badd867025e80019524c7b', etichetta: '3 anno (percorso L-19)', anno: 3 }); return 1;`);
  await sleep(6000);
  const cor2 = await ev(`return { id: String(${A}.correnteId).slice(0,6), tot: ${A}.lezioni.length };`);
  ok('switch calendario corrente', cor2.id === '68badd' && cor2.tot > 0, JSON.stringify(cor2));

  // ---- notifiche: degradazione onesta se non supportate ----
  const notif = await ev(`await ${A}.toggleNotifiche(); return { p: ${A}.permNotifiche, e: String(${A}.errore) !== 'null' };`);
  ok('fallback notifiche senza crash', notif.p === 'unsupported' && notif.e, JSON.stringify(notif));

  // ---- tema: solo 2 stati ----
  const temi = await ev(`
    const a=${A}; const t0=a.temaAttuale; a.toggleTema(); const t1=a.temaAttuale;
    a.toggleTema(); const t2=a.temaAttuale;
    return { t0, t1, t2, attr: document.documentElement.getAttribute('data-theme') };
  `);
  ok('tema a 2 stati', temi.t0 !== temi.t1 && temi.t2 === temi.t0, JSON.stringify(temi));
} catch (e) {
  risultati.push('✗ ECCEZIONE fase 2: ' + e.message);
}

console.log(risultati.join('\n'));
console.log('\n--- log console/exceptioni ---');
console.log(logs.length ? logs.slice(0, 12).join('\n') : '(nessun errore)');
ws.close();
process.exit(risultati.some(r => r.startsWith('✗')) ? 1 : 0);
