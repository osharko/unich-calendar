/**
 * unich-proxy — Worker Cloudflare (FREE) con tre compiti:
 *
 *  1. PROXY CORS  GET /?url=https://www.unich.it/...        (come prima)
 *  2. API PUSH     POST /subscribe | /unsubscribe | GET /vapid
 *  3. CRON        trigger "ogni 15 minuti" — ogni tick:
 *       - per OGNI calendario sottoscritto fa UNA sola chiamata all'API Cineca
 *         (dedup: N studenti sullo stesso calendario = 1 fetch), calcola
 *         l'hash della situazione e, se cambia, manda un push "calendario
 *         aggiornato" agli abbonati di QUEL calendario;
 *       - manda il promemoria "lezione tra ~15 min" (dedup per evento).
 *
 * Richiede nell'ambiente del Worker:
 *   binding KV     → nome `PUSH`  (namespace KV, es. unich-push)
 *   variabile      → VAPID_PUBLIC   (chiave pubblica, non segreta)
 *   segreto        → VAPID_PRIVATE  (JWK JSON generato da scripts/gen-vapid.mjs)
 *   variabile      → VAPID_SUBJECT  (mailto tue, es. mailto:you@example.com)
 *   opz. segreto   → CRON_SECRET    (abilita GET /tick e GET /subs per debug;
 *                                    header: x-cron-secret)
 *   opz. variabile → CRON           (trigger "ogni 15 min" nel wrangler.toml/dashboard)
 */

const API_UNICH = 'https://www.unich.it';
const CINECA_API = 'https://unich.prod.up.cineca.it/api';
const CINECA_DOMINIO = 'unich.prod.up.cineca.it';
const CINECA_CLIENTE_ID = '5a65a9ebd9fe4f6d0ccf9df6'; // unich (stabile)
const DOMINI_CONSENTITI = ['www.unich.it', 'unich.it'];

const ORIZZONTE_GG = 8;      // finestra di eventi considerata
const FINA_REMINDER_MIN = 25; // reminder: evento che inizia tra 10 e 25 min
const INIZIO_REMINDER_MIN = 8;

/* ============================ main fetch ============================== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    switch (url.pathname) {
      case '/':
        return json({ ok: true, servizio: 'unich-proxy', modalità: 'proxy + push' }, 200, cors);
      case '/subscribe':
        return handleSubscribe(request, env, cors);
      case '/unsubscribe':
        return handleUnsubscribe(request, env, cors);
      case '/vapid':
        return json({ publicKey: env.VAPID_PUBLIC || null }, 200, cors);
      case '/tick': {
        if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET)
          return json({ errore: 'non autorizzato' }, 403, cors);
        const report = await runTick(env);
        return json(report, 200, cors);
      }
      case '/subs': {
        if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET)
          return json({ errore: 'non autorizzato' }, 403, cors);
        const subs = await loadSubs(env);
        return json({
          count: subs.length,
          subs: subs.map((s) => ({
            id: s.id, endpoint: s.subscription.endpoint.slice(0, 60) + '…',
            calendari: (s.prefs?.calendars || []).map((c) => c.id),
            updatedAt: s.updatedAt,
          })),
        }, 200, cors);
      }
    }

    // Default: proxy CORS (invariato rispetto a prima)
    return handleProxy(request, url, cors);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env).catch((e) => console.error('tick fallito:', e?.message || e)));
  },
};

/* ============================== proxy ================================ */

async function handleProxy(request, url, cors) {
  let destinazione = url.searchParams.get('url');
  if (!destinazione) {
    destinazione = url.pathname.replace(/^\/+/, '');
    if (!/^https?:\/\//i.test(destinazione)) return json({ errore: 'Parametro url mancante' }, 400, cors);
  }
  let target;
  try { target = new URL(destinazione); } catch { return json({ errore: 'url non valido' }, 400, cors); }
  if (!DOMINI_CONSENTITI.includes(target.hostname))
    return json({ errore: `Dominio non consentito: ${target.hostname}` }, 403, cors);

  try {
    const res = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; unich-proxy/2.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: {
        ...cors,
        'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return json({ errore: `Fetch fallita: ${e.message}` }, 502, cors);
  }
}

/* ============================ API sottoscrizioni ====================== */

async function handleSubscribe(request, env, cors) {
  if (!env.PUSH) return json({ errore: 'KV non configurato' }, 500, cors);
  let body;
  try { body = await request.json(); } catch { return json({ errore: 'JSON non valido' }, 400, cors); }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
    return json({ errore: 'subscription incompleta' }, 400, cors);
  if (!/^https?:/.test(sub.endpoint)) return json({ errore: 'endpoint non valido' }, 400, cors);

  const id = await sha256hex(sub.endpoint);
  const record = {
    id,
    subscription: { endpoint: sub.endpoint, keys: sub.keys },
    prefs: sanitizePrefs(body.prefs),
    updatedAt: new Date().toISOString(),
  };
  await env.PUSH.put('sub:' + id, JSON.stringify(record));
  return json({ ok: true, id }, 200, cors);
}

async function handleUnsubscribe(request, env, cors) {
  if (!env.PUSH) return json({ errore: 'KV non configurato' }, 500, cors);
  let body;
  try { body = await request.json(); } catch { return json({ errore: 'JSON non valido' }, 400, cors); }
  if (!body?.endpoint) return json({ errore: 'endpoint mancante' }, 400, cors);
  const id = await sha256hex(body.endpoint);
  await env.PUSH.delete('sub:' + id);
  return json({ ok: true }, 200, cors);
}

/** Normalizza le preferenze inviate dal client. */
function sanitizePrefs(prefs) {
  const calendars = Array.isArray(prefs?.calendars) ? prefs.calendars : [];
  return {
    calendars: calendars.slice(0, 20).map((c) => ({
      id: String(c.i ?? c.id ?? '').slice(0, 64),
      label: String(c.l ?? c.etichetta ?? '').slice(0, 80),
      corso: String(c.n ?? c.corso ?? '').slice(0, 120),
      // m: null = tutte le materie; array di chiavi = solo quelle visibili
      materie: Array.isArray(c.m ?? c.materieVisibili) ? (c.m ?? c.materieVisibili).map(String).slice(0, 200) : null,
    })).filter((c) => /^[a-f0-9]{24}$/i.test(c.id)),
  };
}

/* ============================== CRON ================================= */

async function runTick(env) {
  if (!env.PUSH) return { errore: 'KV non configurato' };
  const subs = await loadSubs(env);
  if (!subs.length) return { subs: 0 };

  // 1) dedup: calendario → fetch Cineca UNA volta sola
  const calIds = [...new Set(subs.flatMap((s) => s.prefs.calendars.map((c) => c.id)))];
  const report = { subs: subs.length, calendari: calIds.length, cambiati: [], reminder: [], errori: [] };
  const now = Date.now();
  const eventiPerCal = new Map();

  for (const calId of calIds) {
    try {
      const eventi = await fetchEventi(calId, now);
      const hash = hashEventi(eventi);
      const prev = await env.PUSH.get('hash:' + calId);
      eventiPerCal.set(calId, { eventi, hash, cambiato: !!prev && prev !== hash, primoGiro: !prev });
      if (!prev || prev !== hash) await env.PUSH.put('hash:' + calId, hash, { expirationTtl: 60 * 86400 });
      if (eventiPerCal.get(calId).cambiato) report.cambiati.push(calId);
    } catch (e) {
      report.errori.push(`cal ${calId}: ${e.message}`);
    }
  }

  // 2) per ogni sottoscrizione: cambio calendario + reminder (rispettando le materie)
  const sentGone = [];
  for (const s of subs) {
    try {
      const msgs = [];

      for (const c of s.prefs.calendars) {
        const st = eventiPerCal.get(c.id);
        if (!st) continue;

        if (st.cambiato) {
          msgs.push({
            title: 'Calendario aggiornato',
            body: `“${c.label || c.corso || c.id}” è cambiato: apri per vedere le lezioni.`,
            type: 'changed', cals: [c.id],
          });
        }

        // reminder (dedup per evento via KV)
        for (const ev of st.eventi) {
          const mins = (new Date(ev.in).getTime() - now) / 60000;
          if (mins < INIZIO_REMINDER_MIN || mins > FINA_REMINDER_MIN) continue;
          if (c.materie && !ev.mk.some((k) => c.materie.includes(k))) continue; // materia nascosta
          if (await env.PUSH.get('rem:' + ev.id)) continue;
          await env.PUSH.put('rem:' + ev.id, '1', { expirationTtl: 2 * 86400 });
          const ora = new Date(ev.in).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
          msgs.push({
            title: `Lezione tra ~${Math.round(mins)} min`,
            body: `${ev.nome} · ore ${ora}${ev.au ? ' · ' + ev.au : ''}`,
            type: 'reminder', cals: [c.id], tag: 'rem-' + ev.id,
          });
          report.reminder.push({ sub: s.id.slice(0, 8), cal: c.id, ev: ev.id });
        }
      }

      // un solo push per sottoscrizione (se più messaggi, compatta il "changed")
      const changed = msgs.filter((m) => m.type === 'changed');
      const reminders = msgs.filter((m) => m.type === 'reminder');
      const payload = [];
      if (changed.length) {
        payload.push({
          type: 'changed',
          title: 'Calendario aggiornato',
          body: changed.length === 1 ? changed[0].body : `${changed.length} calendari sono cambiati: apri per aggiornare.`,
          cals: [...new Set(changed.flatMap((m) => m.cals))],
        });
      }
      for (const r of reminders.slice(0, 2)) payload.push(r);

      for (const p of payload) {
        const r = await sendPush(env, s, JSON.stringify(p));
        if (r === 'gone') { sentGone.push(s.id); break; }
      }
    } catch (e) {
      report.errori.push(`sub ${s.id?.slice(0, 8)}: ${e.message}`);
    }
  }
  for (const id of sentGone) await env.PUSH.delete('sub:' + id);
  return report;
}

/* ==================== fetch eventi Cineca (dedup) ==================== */

async function fetchEventi(linkCalendarioId, now) {
  const body = {
    linkCalendarioId,
    clienteId: CINECA_CLIENTE_ID,
    mostraImpegniAnnullati: true,
    mostraIndisponibilitaTotali: false,
    dataInizio: new Date(now - 86400000).toISOString(),
    dataFine: new Date(now + ORIZZONTE_GG * 86400000).toISOString(),
  };
  const res = await fetch(`${CINECA_API}/Impegni/getImpegniCalendarioPubblico`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `https://${CINECA_DOMINIO}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cineca HTTP ${res.status}`);
  const raw = await res.json();
  const eventi = raw
    .filter((x) => !x.indisponibilita)
    .map((x) => ({
      id: x.id,
      in: x.dataInizio,
      fi: x.dataFine,
      st: x.stato || 'P',
      nome: x.evento?.dettagliDidattici?.[0]?.nome || x.nome || 'Lezione',
      au: (x.aule || []).map((a) => a.codice).filter(Boolean).join(' '),
      mk: (x.evento?.dettagliDidattici || []).map((d) => d.id || d.codice || d.nome).filter(Boolean).sort(),
    }))
    .filter((ev) => new Date(ev.in).getTime() > now - 3600000) // solo futuro/oggi
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return eventi;
}

/** Hash FNV-1a stabile dello snapshot. */
function hashEventi(eventi) {
  const s = eventi.map((e) => `${e.id}|${e.in}|${e.fi}|${e.st}|${e.au}|${e.mk.join(',')}`).join('\n');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return String(h >>> 0) + ':' + s.length;
}

async function loadSubs(env) {
  const out = [];
  let cursor;
  do {
    const list = await env.PUSH.list({ prefix: 'sub:', cursor, limit: 1000 });
    for (const k of list.keys) {
      const v = await env.PUSH.get(k.name);
      if (v) { try { out.push(JSON.parse(v)); } catch { /* ignora record corrotto */ } }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

/* ====================== Web Push (RFC 8291 aes128gcm) ================= */

async function sendPush(env, sub, payloadStr) {
  const { endpoint, keys } = sub.subscription;
  const vapid = await getVapidKeys(env);
  if (!vapid) throw new Error('VAPID non configurata');

  const uaPublic = b64uToBytes(keys.p256dh);
  const authSecret = b64uToBytes(keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey)); // 65 B
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256);

  const ikmInfo = cat(new TextEncoder().encode('WebPush: info\0'), uaPublic, vapid.pubRaw);
  const ikm = await hkdfExpand(await hkdfExtract(salt, new Uint8Array(ecdhSecret)), ikmInfo, 32);
  const prk = await hkdfExtract(authSecret, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const pt = cat(new TextEncoder().encode(payloadStr), new Uint8Array([2]));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, pt);

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  const header = cat(salt, rs, new Uint8Array([65]), localPub);
  const body = cat(header, new Uint8Array(ct));

  const aud = new URL(endpoint).origin;
  const jwt = await makeVapidJwt(vapid, aud, env.VAPID_SUBJECT || 'mailto:unich-proxy@example.com');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      TTL: '120',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt}, k=${b64uFromBytes(vapid.pubRaw)}`,
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`push HTTP ${res.status} ${t.slice(0, 120)}`);
  }
  return 'ok';
}

async function getVapidKeys(env) {
  if (!env.VAPID_PRIVATE) return null;
  const jwk = JSON.parse(env.VAPID_PRIVATE);
  const pubJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pub));
  const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { priv, pubRaw };
}

async function makeVapidJwt(vapid, aud, subject) {
  const enc = new TextEncoder();
  const h = b64uFromBytes(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64uFromBytes(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject })));
  const signingInput = `${h}.${p}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.priv, enc.encode(signingInput));
  return `${signingInput}.${b64uFromBytes(new Uint8Array(sig))}`;
}

/* ============================== utils ================================ */

async function hkdfExtract(saltBytes, ikmBytes) {
  const k = await crypto.subtle.importKey('raw', saltBytes.length ? saltBytes : new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ikmBytes));
}
async function hkdfExpand(prk, info, len) {
  const k = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = new Uint8Array(await crypto.subtle.sign('HMAC', k, cat(info, new Uint8Array([1]))));
  return out.slice(0, len);
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function cat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
const b64uFromBytes = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Return-Format, x-cron-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
