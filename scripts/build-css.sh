#!/usr/bin/env bash
# Compila il CSS Tailwind. Richiede il binario standalone (vedi AGENT.md §5).
set -euo pipefail
cd "$(dirname "$0")/.."

TW="${TAILWIND_BIN:-/tmp/tailwindcss}"
if [ ! -x "$TW" ]; then
  echo "Tailwind CLI non trovato in $TW" >&2
  echo "Scaricalo: curl -sL -o /tmp/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-x64 && chmod +x /tmp/tailwindcss" >&2
  exit 1
fi

"$TW" -i css/app.css -o css/styles.css --minify
echo "✔ css/styles.css ($(wc -c < css/styles.css) byte)"
