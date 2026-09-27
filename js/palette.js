/**
 * palette.js — 50 colori-materia FISSI (generati da scripts/gen-palette.py).
 * Non generare colori a runtime: la palette è precalcolata per garantire
 * tinte stabili e distinguibili.
 */
export const COLORI_MATERIA = [
  '#9d5fdd',// 0
  '#94dba2',// 1
  '#e23647',// 2
  '#7ea3dd',// 3
  '#d0e0ae',// 4
  '#dd5fd9',// 5
  '#94dbc9',// 6
  '#e28336',// 7
  '#8d7edd',// 8
  '#b5e0ae',// 9
  '#dd5f95',// 10
  '#94c7db',// 11
  '#e2e036',// 12
  '#c07edd',// 13
  '#aee0c2',// 14
  '#dd6d5f',// 15
  '#94a1db',// 16
  '#87e236',// 17
  '#dd7ec6',// 18
  '#aee0dd',// 19
  '#ddb15f',// 20
  '#ae94db',// 21
  '#36e242',// 22
  '#dd7e93',// 23
  '#aec8e0',// 24
  '#c5dd5f',// 25
  '#d494db',// 26
  '#36e29f',// 27
  '#dd9c7e',// 28
  '#afaee0',// 29
  '#81dd5f',// 30
  '#db94bc',// 31
  '#36c8e2',// 32
  '#ddcf7e',// 33
  '#caaee0',// 34
  '#5fdd82',// 35
  '#db9495',// 36
  '#366be2',// 37
  '#b7dd7e',// 38
  '#e0aedb',// 39
  '#5fddc6',// 40
  '#dbb994',// 41
  '#5e36e2',// 42
  '#84dd7e',// 43
  '#e0aebf',// 44
  '#5fb0dd',// 45
  '#d7db94',// 46
  '#bb36e2',// 47
  '#7eddac',// 48
  '#e0b7ae',// 49
];

/** Colore per indice materia, con wrap-around sicuro. */
export function coloreMateria(indice) {
  return COLORI_MATERIA[((indice % COLORI_MATERIA.length) + COLORI_MATERIA.length) % COLORI_MATERIA.length];
}
