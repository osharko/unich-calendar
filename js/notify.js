/**
 * notify.js — ponte verso il service worker per i promemoria lezione.
 *
 * Le notifiche sono LOCALI (timer nel service worker): funzionano ad app
 * aperta o mentre il SW è vivo. Per il recapito garantito ad app chiusa
 * servirebbe un push da server (Cloudflare Cron + Web Push): vedi AGENT.md.
 */

/** Inizializza e restituisce lo stato del permesso. */
function initNotifiche() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/** Chiede il permesso (va chiamato in un gestore di click dell'utente). */
async function chiediPermesso() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }
  return Notification.permission;
}

/**
 * Invia al SW l'elenco dei promemoria da programmare
 * [{ id, titolo, inizio, aula }] (già filtrati per finestra oraria).
 */
async function sincronizzaNotifiche(items) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sw = reg?.active || reg?.waiting;
    if (!sw) return;
    sw.postMessage({ type: 'unich:promemoria', items });
  } catch (e) {
    console.warn('[notify] sync fallita', e?.message);
  }
}
