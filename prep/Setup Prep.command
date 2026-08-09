#!/bin/bash
# Double-click in Finder: create Prep venv + install Python deps (once).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

VENV="${HOME}/.venvs/room-flythrough-prep"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 wurde nicht gefunden."
  echo "Bitte z.B. installieren: brew install python@3.12"
  echo ""
  read -r -p "Enter druecken, um zu schliessen ... " _
  exit 1
fi

PY=python3
if command -v python3.12 >/dev/null 2>&1; then
  PY=python3.12
fi

echo "Creating venv at ${VENV} ..."
"${PY}" -m venv "${VENV}"

echo "Installing requirements..."
"${VENV}/bin/python" -m pip install --upgrade pip
"${VENV}/bin/pip" install -r "${DIR}/requirements.txt"

echo ""
echo "Prep setup OK. Start with \"Start Prep.command\""
echo ""
read -r -p "Enter druecken, um zu schliessen ... " _
