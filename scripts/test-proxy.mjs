/**
 * test-proxy.mjs — verifica che lo scraping passi dal Worker Cloudflare
 * e che non restino chiamate a r.jina.ai (monitora le richieste di rete).
 *
 * Richiede: node scripts/serve.mjs 8123  +  lightpanda attivo (vedi test-lightpanda).
 * Esegue:  node scripts/test-proxy.mjs
 */
const ws = new WebSocket('ws://127.0.0.1:9222/');
let id = 0; const pend = new Map(); const net = [];
function send(m, p = {}, s) { return new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); }); }
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method === 'Network.requestWillBeSent') net.push(m.params.request.url);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8123/?proxy=' + Date.now() }, sessionId);
await sleep(3000);
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${e}})()`, awaitPromise: true, returnByValue: true }, sessionId);
  return r.exceptionDetails ? 'ECCEZIONE: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result?.value; };
const A = 'document.querySelector("[x-data]")._x_dataStack[0]';

await ev(`localStorage.clear(); return 1;`);
const idx = await ev(`await ${A}.aggiornaIndice(); return { corsi: ${A}.stats.corsi, err: String(${A}.errore).slice(0,80) };`);
console.log('indice via worker:', JSON.stringify(idx));

const anni = await ev(`
  const a = ${A};
  a.scegliPolo('Polo di Chieti');
  a.scegliStruttura('Dipartimento di Scienze Filosofiche, Pedagogiche e Sociali');
  const c = a.corsi.find(x => /Filosofia e Scienze/.test(x.nome));
  await a.scegliCorso(c);
  return a.anniDelCorso.map(x => x.etichetta);
`);
console.log('anni via worker:', JSON.stringify(anni));

console.log('\nURL proxy osservati:');
for (const u of [...new Set(net)].filter(u => u.includes('workers.dev') || u.includes('jina'))) console.log('  ', u.slice(0, 110));
const jina = net.some(u => u.includes('jina'));
console.log(jina ? '✗ ANCORA JINA' : '✓ nessun riferimento a r.jina.ai');
ws.close(); process.exit(jina ? 1 : 0);
