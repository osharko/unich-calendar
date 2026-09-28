/**
 * gen-vapid.mjs — genera una coppia di chiavi VAPID (P-256/ES256) per Web Push.
 *
 *   node scripts/gen-vapid.mjs
 *
 * Stampa:
 *   - PUBLIC_KEY  → va in js/config.js (vapidPublicKey) e come variabile
 *                   `VAPID_PUBLIC` nel Worker (non è segreta)
 *   - PRIVATE_JWK → va come SECRET `VAPID_PRIVATE` nel Worker (solo tuo)
 */
const { subtle } = globalThis.crypto;

const b64u = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unB64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', pair.privateKey);

// Raw public (65 byte): 0x04 || x || y  (formato non compresso P-256)
const raw = new Uint8Array(65);
raw[0] = 4;
raw.set(unB64u(jwk.x), 1);
raw.set(unB64u(jwk.y), 33);

console.log('PUBLIC_KEY=' + b64u(raw));
console.log('PRIVATE_JWK=' + JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }));
