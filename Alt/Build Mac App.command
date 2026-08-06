#!/bin/bash
# Double-click in Finder: builds the standalone Mac app
# (portable Node + Remotion + Tauri .app) and copies it to dist-mac/
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=============================================="
echo "  Room Flythrough Studio — Mac App bauen"
echo "=============================================="
echo ""
echo "Ordner: $DIR"
echo ""

fail() {
  echo ""
  echo "FEHLER: $1"
  echo ""
  read -r -p "Enter druecken, um zu schliessen ... " _
  exit 1
}

# Finder/.command often has a minimal PATH — add common locations
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

command -v node >/dev/null 2>&1 || fail "Node.js fehlt. Installiere LTS von https://nodejs.org/"
command -v corepack >/dev/null 2>&1 || fail "corepack fehlt (kommt normalerweise mit Node.js)."
command -v cargo >/dev/null 2>&1 || fail "Rust/Cargo fehlt. Installiere von https://rustup.rs/"

echo "Node:  $(node -v)"
echo "pnpm:  $(corepack pnpm -v)"
echo "cargo: $(cargo -V)"
echo ""

chmod +x scripts/standalone/build_node_runtime.sh 2>/dev/null || true

echo "==> 1/3  Portable Node + Remotion bundeln …"
echo "    (kann einige Minuten dauern)"
scripts/standalone/build_node_runtime.sh || fail "build_node_runtime.sh ist fehlgeschlagen."
echo ""

echo "==> 2/3  pnpm install …"
corepack pnpm install || fail "pnpm install ist fehlgeschlagen."
echo ""

echo "==> 3/3  Tauri App bauen …"
CI=true corepack pnpm run tauri:build || fail "tauri:build ist fehlgeschlagen."
echo ""

# Prefer project-local target; fall back to CARGO_TARGET_DIR / common cache
APP_NAME="Room Flythrough Studio.app"
CANDIDATES=(
  "$DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
)

if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  CANDIDATES+=("$CARGO_TARGET_DIR/release/bundle/macos/$APP_NAME")
fi

# Cursor/sandbox or custom cargo target dirs under /var/folders
shopt -s nullglob
for p in /var/folders/*/T/*/cargo-target/release/bundle/macos/"$APP_NAME"; do
  CANDIDATES+=("$p")
done
shopt -u nullglob

APP_SRC=""
for c in "${CANDIDATES[@]}"; do
  if [ -d "$c" ]; then
    APP_SRC="$c"
    break
  fi
done

if [ -z "$APP_SRC" ]; then
  fail "Gebaute .app nicht gefunden. Suche unter src-tauri/target/release/bundle/macos/"
fi

DEST_DIR="$DIR/dist-mac"
mkdir -p "$DEST_DIR"
rm -rf "$DEST_DIR/$APP_NAME"
echo "==> Kopiere nach dist-mac/ …"
cp -R "$APP_SRC" "$DEST_DIR/"
echo ""
echo "Fertig:"
echo "  $DEST_DIR/$APP_NAME"
echo ""
open "$DEST_DIR"

echo "Du kannst dieses Fenster jetzt schliessen."
read -r -p "Enter druecken … " _
