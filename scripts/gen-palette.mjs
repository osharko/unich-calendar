/**
 * gen-palette.mjs — genera i 50 colori-materia (varianti light+dark) e li
 * scrive in css/app.css come variabili --mat-N. Palette FISSA e precalcolata:
 * niente colori generati a runtime.
 *
 * Esegui:  node scripts/gen-palette.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const N = 50;
const PHI = 0.618033988749895;

function hlsToRgb(h, l, s) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}

/** Stessa sequenza di hue per le due varianti; L/S cambiano per il contrasto. */
function genera(light) {
  let h = 0.13;
  const out = [];
  for (let i = 0; i < N; i++) {
    h = (h + PHI) % 1.0;
    const lvl = i % 5;
    const L = light ? [0.34, 0.42, 0.30, 0.38, 0.46][lvl] : [0.62, 0.72, 0.55, 0.68, 0.78][lvl];
    const S = light ? [0.80, 0.62, 0.85, 0.72, 0.58][lvl] : [0.65, 0.50, 0.75, 0.58, 0.45][lvl];
    out.push(hlsToRgb(h, L, S));
  }
  return out;
}

const hex = (colors) => colors.map(([r, g, b], i) =>
  `  --mat-${i}: #${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')};`).join('\n');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = join(root, 'css', 'app.css');
let css = readFileSync(cssPath, 'utf8');

const markerInizio = '/* --- Palette materie';
const markerFine = '/* ==========================================================================\n   Base';
const blocco =
  '/* --- Palette materie (50 colori fissi, light+dark)\n' +
  '   Generata da scripts/gen-palette.mjs: NON aggiungere colori a runtime. --- */\n' +
  `:root {\n${hex(genera(true))}\n}\n` +
  `:root[data-theme="mocha"], :root[data-theme="macchiato"] {\n${hex(genera(false))}\n}\n`;

const fine = css.indexOf(markerFine);
if (fine === -1) { console.error('marker non trovato in css/app.css'); process.exit(1); }
const inizio = css.indexOf(markerInizio);
css = css.slice(0, inizio === -1 ? fine : inizio) + blocco + '\n' + css.slice(fine);
writeFileSync(cssPath, css);
console.log(`✔ ${N} colori × 2 varianti scritti in css/app.css`);
