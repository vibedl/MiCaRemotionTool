# Room Flythrough Studio (Web-App)

Reine Web-App: Vite-Frontend + Express-Backend + Remotion/Three.js. Läuft lokal und auf einem Server.

## Voraussetzungen

- Node.js (inkl. Corepack)
- Paketmanager: **pnpm** (`packageManager` in `package.json`)

```bash
corepack enable
corepack pnpm install
```

## Lokal entwickeln

Server (API, Upload, Render, Jobs) + Vite-UI:

```bash
corepack pnpm run studio
```

- UI: http://localhost:5183 (proxied API)
- API: http://localhost:4300

Oder Doppelklick auf `Start Studio.bat` / `Start Studio.command`.

## Produktion / Server

```bash
corepack pnpm run build
corepack pnpm start
```

`start` startet Express auf `HOST`/`PORT` (Defaults: `0.0.0.0:4300`) und serviert `dist-webapp` vom gleichen Origin.

Optional:

```bash
set PORT=8080
set HOST=0.0.0.0
set PUBLIC_ORIGIN=https://dein-host.example
corepack pnpm start
```

`PUBLIC_ORIGIN` ist nur nötig, wenn Job-Dateien absolute Media-URLs brauchen. Ohne Variable bleiben relative Pfade (`/uploads/…`).

## Prep-Tool (optional, davor)

Opake Fotos freistellen und als Studio-Job ablegen — **separat**, Studio braucht kein Python:

Siehe [prep/README.md](prep/README.md)

| | |
|---|---|
| macOS | `prep/Setup Prep.command` → `prep/Start Prep.command` |
| Windows | `prep/Setup Prep.bat` → `prep/Start Prep.bat` |
| UI | http://127.0.0.1:4400 |

Pro Shape: Form behalten / Motiv freistellen / Form-Vorlage; gemeinsame Wandbild-Größe für alle Shapes.

## Weiterarbeit am Mac

1. Repo von der T7 öffnen **oder** `git pull` (Remote: `origin`).
2. `corepack enable && corepack pnpm install` — **kein** Windows-`node_modules` wiederverwenden.
3. Studio: `Start Studio.command` oder `corepack pnpm studio` → http://127.0.0.1:5183
4. Optional Prep: einmal `prep/Setup Prep.command`, dann `prep/Start Prep.command` → http://127.0.0.1:4400
5. Falls `.command`-Dateien nicht starten: im Terminal `chmod +x "Start Studio.command" "prep/Setup Prep.command" "prep/Start Prep.command"`

Python-venv und `node_modules` gehören auf die interne Mac-SSD (`~/.venvs/…`), nicht auf die exFAT-T7.

## Funktionen

- Hintergründe (Räume) und Shapes (Bilder) per Upload hinzufügen — **unabhängig vom Dateinamen**
- Optional Server-Ordner scannen; Typ per „als Raum“ / „als Bild“ wählen
- Größe & Seitenverhältnis per Slider, Aspect-Lock (🔒/🔓)
- Job speichern: **Server** (`jobs/`) oder **lokal** (JSON-Download)
- Job laden: Server-Liste oder lokale JSON-Datei
- Video rendern → Download aus `out/`

## Desktop / Tauri (archiviert)

Siehe [Alt/README.md](Alt/README.md) — Tauri, native Dialoge und Standalone-Build-Skripte liegen dort zur Wiederherstellung.
