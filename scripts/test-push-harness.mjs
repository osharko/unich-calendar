/**
 * test-push-harness.mjs — collaudo runTick (node scripts/test-push-harness.mjs) con KV/fetch finti e tempi fissi assoluti.
 * Verifica: baseline, finestra che scorre (no spam), cancellazione mirata per
 * materie, anti-flap con snapshot congelato, reminder deduplicato, test channel.
 */
import { webcrypto } from 'node:crypto';
const b64u = (b) => Buffer.from(b).toString('base64url');
const kv = new Map();
const env = {
  PUSH: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
    list: async ({ prefix }) => ({
      keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  },
  VAPID_PRIVATE: '{"kty":"EC","crv":"P-256","x":"gZP7Y8Iv7I-4309D4iDHFOOoAytx6byJExUqZL9o9LY","y":"4PzU0XczbiYyAhn69W66eVAGEMoJT9yC4vfheSzH5sc","d":"Ct5jumg1V_yV3jP4jl_cb3RfriE8qe6dQBVEN0LeD1g"}',
  VAPID_SUBJECT: 'mailto:test@example.com',
  CRON_SECRET: 'k',
};
const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const rawPub = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey));
const subRec = (id, endpoint, materie) => JSON.stringify({
  id, subscription: { endpoint, keys: { p256dh: b64u(rawPub), auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
  prefs: { calendars: [{ id: 'CAL1', label: '2 anno', corso: 'Filosofia', materie }] },
});
kv.set('sub:A', subRec('A', 'http://127.0.0.1:9/pushA', null));
kv.set('sub:B', subRec('B', 'http://127.0.0.1:9/pushB', ['altra']));

// tempi ASSOLUTI fissi (il worker usa Date.now() reale)
const T = Date.now();
const MIN = 60_000, H = 3_600_000, D = 86_400_000;
const ev = (id, at, mkArr = ['k1']) => ({
  id, dataInizio: new Date(at).toISOString(), dataFine: new Date(at + H).toISOString(),
  stato: 'P', aule: [{ codice: 'A1' }], evento: { dettagliDidattici: mkArr.map((k) => ({ id: k, nome: k })) },
});
const E0 = ev('E0', T + 40_000);
const E = [ev('E1', T + 2 * H), ev('E2', T + D), ev('E3', T + 2 * D), ev('E4', T + 3 * D), ev('E5', T + 5 * D)];
const REM = ev('REM', T + 15 * MIN);
// normalizzazione identica al worker (per i seed manuali dello snapshot)
const nrm = (e) => ({
  id: e.id, in: e.dataInizio, fi: e.dataFine, st: e.stato,
  au: (e.aule || []).map((a) => a.codice).join(' '),
  mk: (e.evento?.dettagliDidattici || []).map((d) => d.id || d.codice),
});
const seed = (evs) => kv.set('snap:CAL1', JSON.stringify({ at: Date.now(), ev: evs.map(nrm) }));
const snapIds = () => { try { return JSON.parse(kv.get('snap:CAL1')).ev.map((e) => e.id); } catch { return null; } };

let apiBody = [E0, ...E];
let githubMsg = { message: 'ping-init' };
const pushes = { pushA: 0, pushB: 0 };
const real = globalThis.fetch;
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.includes('raw.githubusercontent')) return new Response(JSON.stringify(githubMsg), { status: 200 });
  if (s.includes('getImpegniCalendarioPubblico')) return new Response(JSON.stringify(apiBody), { status: 200 });
  if (s.endsWith('/pushA')) { pushes.pushA++; return new Response('', { status: 201 }); }
  if (s.endsWith('/pushB')) { pushes.pushB++; return new Response('', { status: 201 }); }
  return real(s);
};
// il worker è ESM: import diretto dal repo (require un KV mock, nessun deploy)
const w = (await import('../worker/worker.js')).default;
const tick = async () => (await (await w.fetch(new Request('https://x/tick', { headers: { 'x-cron-secret': 'k' } }), env)).json());
const ok = (n, c, x = '') => console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);

let r = await tick();
ok('1 baseline silenziosa', r.cambiati.length === 0 && r.test.includes('baseline') && pushes.pushA === 0);

seed([E0, ...E]);
r = await tick();
ok('2 finestra che scorre: zero spam', r.cambiati.length === 0 && pushes.pushA === 0, JSON.stringify(r.cambiati));

seed(E);
apiBody = [E[0], E[2], E[3], E[4]];
r = await tick();
ok('3 cancellazione → push A', r.cambiati.some((c) => /x1/.test(c)) && pushes.pushA === 1, JSON.stringify(r.cambiati));
ok('3 materia nascosta → zero push B', pushes.pushB === 0);

seed(E);
apiBody = [E[2]];
r = await tick();
ok('4 anti-flap: niente push', pushes.pushA === 1 && r.errori.some((e) => /flap/.test(e)), JSON.stringify(r.errori));
ok('4 snapshot congelato', snapIds()?.length === 5, String(snapIds()));

apiBody = E;
r = await tick();
ok('5 ripristino post-flap: nessuna allerta', r.cambiati.length === 0 && pushes.pushA === 1);

seed([REM, ...E]);
apiBody = [REM, ...E];
r = await tick();
ok('6 reminder +15min → A', pushes.pushA === 2 && r.reminder.length >= 1, JSON.stringify(r.reminder));
ok('6 reminder non a B (materia k1 nascosta)', pushes.pushB === 0);

r = await tick();
ok('7 reminder deduplicato', r.reminder.length === 0 && pushes.pushA === 2);

githubMsg = { message: 'Cambio il file di test!' };
r = await tick();
ok('8 test channel broadcast 2/2', r.test === 'cambiato → inviato a 2/2' && pushes.pushA === 3 && pushes.pushB === 1, r.test);

console.log(`\npush — A:${pushes.pushA} (cancellaz., reminder, test) | B:${pushes.pushB} (solo test)`);

// ---------- checkRelease: baseline → invariato → note → inviato ----------
{
  const rel = { released: 1, releasedAt: '1 ottobre 2026 10:00', notes: ['Fix fuso orario', 'Chip ore per materia'] };
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.includes('release.json')) return new Response(JSON.stringify(rel), { status: 200 });
    if (s.includes('getImpegniCalendarioPubblico')) return new Response(JSON.stringify(apiBody), { status: 200 });
    if (s.endsWith('/pushA')) { pushes.pushA++; return new Response('', { status: 201 }); }
    if (s.endsWith('/pushB')) { pushes.pushB++; return new Response('', { status: 201 }); }
    if (s.includes('raw.githubusercontent')) return new Response(JSON.stringify(githubMsg), { status: 200 });
    return real(s);
  };
  const base = pushes.pushA;
  let r = await tick();                       // 1° giro: baseline
  ok('release baseline silenziosa', r.release === 'baseline' && pushes.pushA === base);
  rel.released = 2; rel.notes = ['Fix fuso orario notifiche', 'Chip ore per materia'];
  r = await tick();                           // cambio con note → invio
  ok('release cambiata → inviata a 2/2', r.release.startsWith('nuova versione') && r.release.includes('2/2') && pushes.pushA === base + 1, r.release);
  rel.released = 3; rel.notes = [];           // cambio senza note → silenzio
  r = await tick();
  ok('release senza note → non invia', r.release === 'nuova versione senza note: non invio' && pushes.pushA === base + 1, r.release);
}

// A: 3 (cancellaz.+reminder, test) + 2 release — B: 1 (test) + 1 release
// A: 3 (cancellaz.+reminder, test) + 1 release — B: 1 (test) + 1 release
process.exit(pushes.pushA === 4 && pushes.pushB === 2 ? 0 : 1);
