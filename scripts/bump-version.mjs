/**
 * bump-version.mjs — imprime la data/ora dell'ultimo commit in js/version.js.
 * Il footer mostra "Versione rilasciata il …": è il marcatore visivo per
 * capire se la PWA installata sta girando l'ultima release.
 *
 * Uso (a ogni rilascio):  node scripts/bump-version.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
console.log(`✔ js/version.js → ${commit} · ${leggi}`);
