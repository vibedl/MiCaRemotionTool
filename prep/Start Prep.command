#!/bin/bash
# Double-click in Finder: start Prep UI on http://127.0.0.1:4400
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

VENV="${HOME}/.venvs/room-flythrough-prep"

if [[ ! -x "${VENV}/bin/uvicorn" ]]; then
  echo "venv fehlt. Bitte zuerst \"Setup Prep.command\" ausfuehren."
  echo ""
  read -r -p "Enter druecken, um zu schliessen ... " _
  exit 1
fi

echo "Prep UI: http://127.0.0.1:4400"
echo "Studio bleibt separat:  pnpm studio  →  http://127.0.0.1:5183"
echo ""

# Open browser shortly after uvicorn starts (macOS)
(
  sleep 1.5
  open "http://127.0.0.1:4400" >/dev/null 2>&1 || true
) &

"${VENV}/bin/uvicorn" app:app --host 127.0.0.1 --port 4400 --reload

echo ""
echo "Prep wurde beendet."
read -r -p "Enter druecken, um zu schliessen ... " _
