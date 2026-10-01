/**
 * test-changelog-unit.mjs — unit-test del changelog notifiche:
 * forme (✕//📍/＋/↩), cap a 10 righe, filtro materie nascoste.
 *
 *   node scripts/test-changelog-unit.mjs
 */
import { diffEventi, changelogRighe, changelogTesto } from '../worker/worker.js';

const ev = (id, nome, au, inISO, mk = ['k1'], st = 'P') =>
  ({ id, nome, au, in: inISO, fi: inISO, st, mk });

const prima = [
  ev('E1', 'STORIA MODERNA', 'A1', '2026-10-06T12:00:00.000Z'),
  ev('E2', 'PEDAGOGIA', 'B2', '2026-10-07T09:00:00.000Z', ['k2']),
  ev('E3', 'ERMENEUTICA', 'C3', '2026-10-08T10:00:00.000Z'),
  ev('E5', 'LOD', 'D5', '2026-10-09T08:00:00.000Z'),
];
const dopo = [
  ev('E1', 'STORIA MODERNA', 'A1', '2026-10-06T14:00:00.000Z'),   // spostata orario
  ev('E2', 'PEDAGOGIA', 'B2', '2026-10-07T09:00:00.000Z', ['k2'], 'A'), // annullata
  ev('E3', 'ERMENEUTICA', 'X9', '2026-10-08T10:00:00.000Z'),      // spostata aula
  ev('E6', 'GESTIONE', 'F6', '2026-10-09T11:00:00.000Z'),         // aggiunta (E5 sparita → annullata)
];

let falliti = 0;
const ok = (n, c, extra = '') => { if (!c) falliti++; console.log(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

const diff = diffEventi(prima, dopo);
const righe = changelogRighe(diff, null);

ok('diff: 1 nuova, 2 annullate, 2 mod', diff.aggiunte.length === 1 && diff.annullate.length === 2 && diff.modificate.length === 2);
ok('cambio orario con →', righe.some((r) => r.includes('STORIA MODERNA') && r.includes('→')));
ok('annullata con ✕', righe.some((r) => r.startsWith('✕') && r.includes('PEDAGOGIA')));
ok('sparita dal feed → ✕', righe.some((r) => r.includes('LOD')));
ok('cambio aula con 📍', righe.some((r) => r.startsWith('📍') && r.includes('ERMENEUTICA') && r.includes('C3 → X9')));
ok('aggiunta ＋', righe.some((r) => r.startsWith('＋') && r.includes('GESTIONE')));
ok('recuperata ↩', changelogRighe(diffEventi(
  [ev('X', 'REC', 'A', '2026-10-10T09:00:00.000Z', ['k1'], 'A')],
  [ev('X', 'REC', 'A', '2026-10-10T09:00:00.000Z', ['k1'], 'P')],
), null).some((r) => r.startsWith('↩')));

const filtrate = changelogRighe(diff, ['k1']);
ok('filtro materie (k2 esclusa)', filtrate.every((r) => !r.includes('PEDAGOGIA')) && filtrate.length === righe.length - 1, `${filtrate.length}/${righe.length}`);

const t = changelogTesto(Array.from({ length: 13 }, (_, i) => `riga ${i + 1}`), 10);
ok('cap 10 + "e altre 3"', t.split('\n').length === 11 && t.trimEnd().endsWith('… e altre 3 modifiche'), JSON.stringify(t.split('\n').pop()));
ok('sotto il cap: solo righe', changelogTesto(['a', 'b'], 10) === 'a\nb');
ok('date in orario Italia', /6 ott|7 ott/.test(righe[0]), righe[0]);

console.log(falliti ? `\n✗ ${falliti} test falliti` : '\n✓ tutti i test del changelog passano');
process.exit(falliti ? 1 : 0);
