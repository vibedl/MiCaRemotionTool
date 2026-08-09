#!/bin/bash
# Double-click this file in Finder to start the Room Flythrough Studio
# (backend server + web UI) and open it in your browser automatically.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden."
  echo "Bitte installiere Node.js (LTS-Version) von https://nodejs.org/"
  echo "und starte dieses Skript danach erneut."
  echo ""
  read -p "Enter druecken, um dieses Fenster zu schliessen ... " _
  exit 1
fi

node scripts/start-studio.mjs

echo ""
echo "Der Server wurde beendet. Du kannst dieses Fenster jetzt schliessen."
read -p "Enter druecken, um zu schliessen ... " _
