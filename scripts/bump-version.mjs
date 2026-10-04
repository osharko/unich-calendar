/**
 * bump-version.mjs — imprime data/ora dell'ultimo commit in js/version.js
 * (marcatore visibile nel footer) e, se ricevute, scrive le note di rilascio
 * in notification/release.json: il Worker le userà per un push "nuova versione".
 *
 * Uso:
 *   node scripts/bump-version.mjs
 *   node scripts/bump-version.mjs --notes "Fix fuso orario notifiche; Chip ore per materia"
 *   node scripts/bump-version.mjs --no-notify         # solo marcatore, niente push
 */
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noNotify = args.includes('--no-notify');
const notesArgIdx = args.indexOf('--notes');
const noteRaw = notesArgIdx >= 0 ? (args[notesArgIdx + 1] || '') : '';

const iso = execSync('git log -1 --format=%cI', { cwd: root }).toString().trim();
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const leggi = new Date(iso).toLocaleString('it-IT', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Europe/Rome',
});

const file = join(root, 'js', 'version.js');
writeFileSync(file,
  `/* Auto-generato da scripts/bump-version.mjs — rigenerare a ogni rilascio. */\n` +
  `window.APP_BUILD = { releasedAt: ${JSON.stringify(leggi)}, commit: ${JSON.stringify(commit)}, iso: ${JSON.stringify(iso)} };\n`);

let notePush = '';
if (!noNotify) {
  const notes = noteRaw.split(';').map((s) => s.trim()).filter(Boolean);
  const releaseFile = join(root, 'notification', 'release.json');
  const precedente = existsSync(releaseFile)
    ? JSON.parse(readFileSync(releaseFile, 'utf8'))
    : { released: 0 };
  const payload = {
    version: commit,
    releasedAt: leggi,
    // contatore sempre crescente: il Worker notifica quando cambia
    released: Date.now(),
    notes,
  };
  writeFileSync(releaseFile, JSON.stringify(payload, null, 2) + '\n');
  notePush = notes.length
    ? ` · push release con ${notes.length} note`
    : ' · push release (senza note: silenzioso)';
  void precedente;
}

console.log(`✔ js/version.js → ${commit} · ${leggi}${notePush}`);
