/**
 * Cloudflare Worker — proxy CORS per le pagine di www.unich.it.
 *
 * Perché serve: www.unich.it non invia header `Access-Control-Allow-Origin`,
 * quindi il browser non può scaricarne le pagine (CORS è una regola del browser,
 * non aggirabile dal frontend). Questo Worker fa da ponte: riceve la richiesta
 * dal sito, scarica la pagina lato server (dove CORS non si applica) e la
 * restituisce con gli header CORS corretti.
 *
 * Deploy (piano gratuito):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Incolla questo file, poi Deploy.
 *   3. Copia l'URL del Worker (es. https://unich-proxy.<tuo>.workers.dev)
 *      in js/config.js → CONFIG.proxy.
 *
 * Uso:  GET https://<worker>/?url=https%3A%2F%2Fwww.unich.it%2F...
 *       GET https://<worker>/https://www.unich.it/...     (forma comoda)
 *
 * Sicurezza: solo il dominio unich.it è proxato (allowlist), così il Worker
 * non diventa un proxy aperto verso Internet.
 */

const DOMINI_CONSENTITI = [
  'www.unich.it',
  'unich.it',
];

const ORIGINI_CONSENTITE = [
  // In sviluppo. In produzione sostituisci con il tuo dominio GitHub Pages,
  // es. 'https://<utente>.github.io'. Con '*' funziona comunque.
  '*',
];

function corsHeaders(origin) {
  const consentita =
    ORIGINI_CONSENTITE.includes('*') || ORIGINI_CONSENTITE.includes(origin);
  return {
    'Access-Control-Allow-Origin': consentita ? (ORIGINI_CONSENTITE.includes('*') ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Return-Format',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ errore: 'Metodo non consentito' }, 405, cors);
    }

    // Estrae l'URL di destinazione: da ?url= oppure dal path.
    const url = new URL(request.url);
    let destinazione = url.searchParams.get('url');
    if (!destinazione) {
      destinazione = url.pathname.replace(/^\/+/, '') + url.search;
      if (!/^https?:\/\//i.test(destinazione)) destinazione = 'https://' + destinazione;
    }

    let target;
    try {
      target = new URL(destinazione);
    } catch {
      return json({ errore: 'Parametro url non valido' }, 400, cors);
    }

    // Allowlist: solo i domini dell'ateneo.
    if (!DOMINI_CONSENTITI.includes(target.hostname)) {
      return json({ errore: `Dominio non consentito: ${target.hostname}` }, 403, cors);
    }

    try {
      const res = await fetch(target.toString(), {
        headers: {
          // Alcuni CDN/WAF rispondono meglio con uno UA reale.
          'User-Agent':
            request.headers.get('User-Agent') ||
            'Mozilla/5.0 (compatible; unich-calendar-proxy/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'it-IT,it;q=0.9',
        },
        cf: { cacheTtl: 3600, cacheEverything: true }, // cache edge 1h
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
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
