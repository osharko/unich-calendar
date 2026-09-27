#!/usr/bin/env python3
"""
Genera i 50 colori-materia e li scrive in css/app.css (variabili --mat-0..49)
e in js/palette.js (elenco JS). La palette è FISSA e precalcolata: così i colori
restano stabili e ben distinguibili, senza generazione dinamica.

Esegui:  python3 scripts/gen-palette.py
"""
import colorsys
import pathlib
import re

N = 50
PHI = 0.618033988749895


def genera():
    h = 0.13
    colori = []
    for i in range(N):
        h = (h + PHI) % 1.0
        lvl = i % 5
        L = [0.62, 0.72, 0.55, 0.68, 0.78][lvl]
        S = [0.65, 0.50, 0.75, 0.58, 0.45][lvl]
        r, g, b = colorsys.hls_to_rgb(h, L, S)
        colori.append((round(r * 255), round(g * 255), round(b * 255)))
    return colori


def main():
    colori = genera()
    root = pathlib.Path(__file__).resolve().parent.parent

    # --- css/app.css: blocco variabili ---
    css_path = root / "css" / "app.css"
    css = css_path.read_text(encoding="utf-8")
    blocco = "/* --- Palette materie (50 colori fissi, generati da scripts/gen-palette.py) --- */\n"
    blocco += ":root {\n"
    for i, (r, g, b) in enumerate(colori):
        blocco += f"  --mat-{i}: #{r:02x}{g:02x}{b:02x};\n"
    blocco += "}\n"

    marker_inizio = "/* --- Palette materie"
    marker_fine = "/* ==========================================================================\n   Base"
    if marker_inizio in css:
        inizio = css.index(marker_inizio)
        fine = css.index(marker_fine)
        css = css[:inizio] + blocco + "\n" + css[fine:]
    else:
        fine = css.index(marker_fine)
        css = css[:fine] + blocco + "\n" + css[fine:]
    css_path.write_text(css, encoding="utf-8")

    # --- js/palette.js ---
    js_path = root / "js" / "palette.js"
    righe = [
        "/**",
        " * palette.js — 50 colori-materia FISSI (generati da scripts/gen-palette.py).",
        " * Non generare colori a runtime: la palette è precalcolata per garantire",
        " * tinte stabili e distinguibili.",
        " */",
        "export const COLORI_MATERIA = [",
    ]
    for i, (r, g, b) in enumerate(colori):
        righe.append(f"  '#{r:02x}{g:02x}{b:02x}',".ljust(12) + f"// {i}")
    righe.append("];")
    righe.append("")
    righe.append("/** Colore per indice materia, con wrap-around sicuro. */")
    righe.append("export function coloreMateria(indice) {")
    righe.append("  return COLORI_MATERIA[((indice % COLORI_MATERIA.length) + COLORI_MATERIA.length) % COLORI_MATERIA.length];")
    righe.append("}")
    righe.append("")
    js_path.write_text("\n".join(righe), encoding="utf-8")

    print(f"✔ {len(colori)} colori scritti in css/app.css e js/palette.js")


if __name__ == "__main__":
    main()
