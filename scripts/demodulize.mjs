/**
 * de.modulize.mjs — trasforma i moduli ES di js/ in script CLASSICI.
 * Motivo: con i moduli il sito non parte da file:// (CORS dei moduli);
 * come script classici basta un doppio click sul file index.html.
 *
 * Regole: rimuove le righe `import ...` (anche multiriga), trasforma
 * `export const/function/class` in dichiarazioni normali (lo scope globale
 * dei classici è condiviso) e avvisa su possibili nomi duplicati.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(root).filter((f) => f.endsWith('.js'));
const names = new Map();

for (const file of files) {
  const src = readFileSync(join(root, file), 'utf8');
  const out = [];
  let inImport = false;
  for (const line of src.split('\n')) {
    if (/^\s*import\s.*[^;]$/.test(line) && !line.includes('from')) { inImport = true; continue; }
    if (inImport) { if (line.includes('from')) inImport = false; continue; }
    if (/^\s*import\s.*from\s+['"]/.test(line)) continue;
    const m = line.match(/^(\s*)export\s+(async\s+function|function|const|let|class)\s/);
    if (m) { out.push(line.replace(/^(\s*)export\s+/, '$1')); continue; }
    out.push(line);
  }
  let txt = out.join('\n');
  // raccogli i nomi dichiarati a top level per il check collisioni
  for (const mm of txt.matchAll(/^(?:async function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const n = mm[1];
    if (names.has(n) && names.get(n) !== file) console.warn(`DUP ${n}: ${names.get(n)} vs ${file}`);
    names.set(n, file);
  }
  writeFileSync(join(root, file), txt);
  console.log('✔', file);
}
