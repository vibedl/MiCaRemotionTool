# Room Flythrough Prep

Vorschalt-Tool fürs [Room Flythrough Studio](../README.md): Hintergründe + Shapes → Cutout-Modus → Kamera-Preset → Studio-Job.

Das **Studio bleibt standalone** — Prep ist optional und teilt nur `uploads/` und `jobs/` im Repo-Root.

## Voraussetzungen

- Python 3.12+ (empfohlen)
- Studio-Repo (dieses Parent-Verzeichnis) für gemeinsame `uploads/` + `jobs/`

## Setup (einmalig)

### macOS

Doppelklick `Setup Prep.command` — oder:

```bash
cd prep
python3 -m venv ~/.venvs/room-flythrough-prep
~/.venvs/room-flythrough-prep/bin/pip install -r requirements.txt
chmod +x "Setup Prep.command" "Start Prep.command"   # nur falls Finder sie nicht startet
```

### Windows

Doppelklick `Setup Prep.bat` — oder:

```bat
cd prep
py -3.12 -m venv %USERPROFILE%\.venvs\room-flythrough-prep
%USERPROFILE%\.venvs\room-flythrough-prep\Scripts\pip install -r requirements.txt
```

Das venv liegt bewusst unter `~/.venvs/` (nicht im Repo / nicht auf exFAT), weil viele kleine Dateien auf der T7 problematisch sein können.

Beim ersten **Motiv freistellen** lädt `rembg` das BiRefNet-Modell herunter (~einige hundert MB).

## Start

| Plattform | Start |
|---|---|
| macOS | `Start Prep.command` |
| Windows | `Start Prep.bat` |
| Terminal | siehe unten |

```bash
# macOS / Linux
cd prep
~/.venvs/room-flythrough-prep/bin/uvicorn app:app --host 127.0.0.1 --port 4400 --reload
```

- Prep UI: http://127.0.0.1:4400  
- Studio parallel: `corepack pnpm studio` → http://127.0.0.1:5183  

## Ablauf

1. Bilder droppen  
2. Typ: Raum / Shape / Ignorieren  
3. Pro Shape Cutout wählen: **Form behalten** | **Motiv freistellen** | **Form-Vorlage**  
4. Shapes freistellen  
5. Wandbild-Größe (gemeinsam für alle) + Kamera-Preset → Job erzeugen  
6. Studio öffnet mit `?job=…` — weiterarbeiten / rendern  

## Form-Vorlagen

Masken liegen in `prep/templates/` (Herz, Kreis, Oval, Feder, Stern, Puzzle, Love, …).  
API: `GET /api/templates`

## Weiterarbeit PC ↔ Mac (T7 / Git)

- Repo auf der T7 mitnehmen **oder** `git pull` auf dem Mac.
- **Immer neu installieren** auf dem Mac: `corepack pnpm install` (Windows-`node_modules` nicht wiederverwenden).
- Prep-venv auf dem Mac neu anlegen (`Setup Prep.command`) — nicht vom PC kopieren.
- `uploads/` und `jobs/` sind lokal/gitignored; Jobs bei Bedarf als JSON mitnehmen oder neu aus Prep erzeugen.
