/**
 * push-crypto-ece-check.mjs — verifica differenziale: cifra con la STESSA
 * sequenza del worker (WebCrypto) e decifra con http_ece (reference).
 * Se ece recupera il payload → il nostro byte layout è corretto al 100%.
 *
 * Uso: node scripts/push-crypto-ece-check.mjs   (dalla root del repo)
 */
import { webcrypto, createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const un64 = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const hmac = async (keyB, msg) => {
  const k = await subtle.importKey('raw', keyB, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, msg));
};
const extract = (salt, ikm) => hmac(salt.length ? salt : new Uint8Array(32), ikm);
const expand = async (prk, info, len) => (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len);

// --- chiavi del "ricevente" (il telefono): ECDH P-256 + auth, in formato RFC 8291
const uaCurve = createECDH('prime256v1');
uaCurve.generateKeys();
const uaPublic = new Uint8Array(uaCurve.getPublicKey());
const authSecret = new Uint8Array(randomBytes(16));

// --- replicazione esatta di sendPush del worker ---
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const local = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const localPub = new Uint8Array(await subtle.exportKey('raw', local.publicKey));
const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

const ikmInfo = cat(enc.encode('WebPush: info\0'), uaPublic, localPub);
const ikm = await expand(await extract(authSecret, ecdhSecret), ikmInfo, 32);
const prk = await extract(salt, ikm);
const cek = await expand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await expand(prk, enc.encode('Content-Encoding: nonce\0'), 12);

const payloadStr = JSON.stringify({ type: 'test', title: 'Unich-calendar', body: 'verifica differenziale ece' });
const keyObj = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
const pt = cat(enc.encode(payloadStr), new Uint8Array([2]), new Uint8Array(8)); // padding RFC
const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keyObj, pt));

const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
const body = cat(salt, rs, new Uint8Array([65]), localPub, ct);

// --- decifra con la reference (ece): deve restituire il payload esatto ---
const out = ece.decrypt(Buffer.from(body), {
  version: 'aes128gcm',
  privateKey: uaCurve,
  authSecret: Buffer.from(authSecret),
});
const ok = out.toString('utf8') === payloadStr;
console.log('ece decifra il nostro body →', out.toString('utf8').slice(0, 60));
console.log(ok ? '✓✓✓ IDENTICO: byte layout e derivate CORRETTE' : '✗ DIVERSO: bug ancora presente');
process.exit(ok ? 0 : 1);
