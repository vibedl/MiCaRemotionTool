# Room Flythrough Studio (Web-App)

Reine Web-App: Vite-Frontend + Express-Backend + Remotion/Three.js. Läuft lokal und auf einem Server.

## Schnellstart: reinwerfen → fertige Animation

Oben in der App liegt der **Schnellstart**:

1. Räume (Fotos) und Wandbilder (freigestellte PNGs) auf die Seite ziehen — oder gezielt in die Felder
   „Räume“ / „Wandbilder“. Ohne Zielfeld wird automatisch erkannt: Bild mit Transparenz = Wandbild,
   deckendes Foto = Raum. Falsch erkannt? Mit ⇄ umschalten.
2. Die Animation baut sich sofort selbst: Gesamtlänge, Morphs, Raumwechsel (jeweils mitten im Morph),
   Größen nach Seitenverhältnis und ein Kamerapfad, der jedes Wandbild anfährt (langsamer Push-in +
   leichter Schwenk). Tempo über „Sekunden pro Wandbild“ einstellen.
3. **Bauen & Video rendern** → MP4 herunterladen.

Wandbilder, die als Maske in Raumgröße exportiert sind (Shape an seiner Position, Rest transparent),
landen exakt an ihrer Stelle im Raum. Deckende Bilder (z. B. JPG) werden als Wandbild mittig platziert.
Alles bleibt danach im Editor unten manuell nachjustierbar.

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

Weitere Variablen:

| Variable | Wirkung |
|----------|---------|
| `ALLOW_SERVER_FS=1` | Ordner-Scan und freie Job-Pfade auf dem Server-Dateisystem erlauben. **Online aus lassen.** `pnpm run studio` (lokal) schaltet es automatisch an. |
| `MAX_UPLOAD_MB` | Maximale Upload-Größe pro Bild (Standard 40). |
| `REMOTION_BROWSER_EXECUTABLE` | Eigenes Chrome/Chromium fürs Rendern statt Remotions Download. |

Renders laufen nacheinander in einer Warteschlange; die UI zeigt den Platz an.

### Docker

```bash
docker build -t room-flythrough .
docker run -p 4300:4300 -v $PWD/data/uploads:/app/uploads -v $PWD/data/out:/app/out -v $PWD/data/jobs:/app/jobs room-flythrough
```

## Funktionen

- Hintergründe (Räume) und Shapes (Bilder) per Upload hinzufügen — **unabhängig vom Dateinamen**
- Optional Server-Ordner scannen; Typ per „als Raum“ / „als Bild“ wählen
- Größe & Seitenverhältnis per Slider, Aspect-Lock (🔒/🔓)
- Job speichern: **Server** (`jobs/`) oder **lokal** (JSON-Download)
- Job laden: Server-Liste oder lokale JSON-Datei
- Video rendern → Download aus `out/`

## Desktop / Tauri (archiviert)

Siehe [Alt/README.md](Alt/README.md) — Tauri, native Dialoge und Standalone-Build-Skripte liegen dort zur Wiederherstellung.
