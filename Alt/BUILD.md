# Room Flythrough Studio — Standalone App bauen

## Wichtig: pro OS auf der Zielmaschine bauen

Es gibt **kein Cross-Compile**. Die Mac-`.app` entsteht nur auf macOS, die Windows-`.exe` / NSIS-Installer nur auf Windows.

## Paketmanager: pnpm

Das Projekt ist über `packageManager` in der `package.json` auf **pnpm 10.11.1** festgelegt
und hat nur eine `pnpm-lock.yaml`. Alle Befehle laufen über `corepack pnpm …` — Corepack
liegt Node.js bei und holt die richtige pnpm-Version automatisch. `npm install` / `npm ci`
funktionieren hier **nicht** (kein `package-lock.json`).

## Voraussetzungen

| | macOS | Windows |
|--|-------|---------|
| Node.js (inkl. corepack) | ja | ja |
| Rust | ja | ja (**MSVC**-Toolchain) |
| Extra | Xcode CLT | VS Build Tools 2022, Workload „Desktopentwicklung mit C++" |
| WebView2 | — | auf Windows 11 bereits vorhanden, sonst [hier](https://developer.microsoft.com/microsoft-edge/webview2/) |

Auf Windows unbedingt in **nativer PowerShell** arbeiten, nicht in WSL oder Git Bash —
sonst landen POSIX-Pfade in den `node_modules`-Symlinks und nichts lässt sich mehr auflösen.

## macOS

Doppelklick in Finder:

```
Build Mac App.command
```

Oder im Terminal:

```bash
chmod +x scripts/standalone/build_node_runtime.sh
scripts/standalone/build_node_runtime.sh
corepack pnpm install
CI=true corepack pnpm run tauri:build
```

Ergebnis:
- `src-tauri/target/release/bundle/macos/Room Flythrough Studio.app`
- Kopie zum Testen: `dist-mac/Room Flythrough Studio.app`

## Windows (auf einem Windows-PC)

Doppelklick:

```
Build Windows.bat
```

Oder in PowerShell:

```powershell
.\scripts\standalone\build-windows.ps1
```

Das macht automatisch:
1. Portable Node + Remotion (`build_node_runtime.ps1`)
2. `corepack pnpm install`
3. `tauri build --bundles nsis`

Ergebnis:
- `src-tauri\target\release\bundle\nsis\*.exe` (Installer)
- Kopie: `dist-win\`

Die gebaute App enthält Node + Remotion — auf dem Ziel-PC brauchst du weder Node noch Remotion extra.

Das gebündelte `node_modules` wird bewusst mit `--node-linker=hoisted` installiert (flach,
ohne Symlinks) — pnpms Standard-Layout übersteht das Resource-Bundling von Tauri nicht.

Der pnpm-Store liegt beim Bundle-Build auf der **Systemplatte**
(`~/Library/pnpm/store` bzw. `%LOCALAPPDATA%\pnpm\store`), nicht auf der externen
Projektplatte — sonst können Kopien mit Fehler `-70` abbrechen.
## Entwicklung (ohne Standalone)

```bash
./Start\ Studio.command   # macOS — braucht System-Node
Start Studio.bat          # Windows — braucht System-Node
corepack pnpm run tauri:dev   # Tauri-Fenster + Dev-Server
```

Beim ersten Render lädt Remotion einmalig Chrome Headless Shell (~150 MB) nach. Vorab holen:

```bash
corepack pnpm exec remotion browser ensure
```

## MP4 speichern

Beim Klick auf **Video rendern** öffnet sich ein nativer „Speichern unter…“-Dialog
(macOS Finder / Windows-Dateidialog). Dort wählst du Ordner und Dateiname der fertigen
`.mp4`. Ohne Bestätigung startet kein Render.

## Projekt speichern

Kamerafahrt + Einstellungen → `.room-flythrough.job.json` im Shapes-Ordner (Button „Speichern“).

## Build-Artefakte

Nach dem Aufräumen fehlen ggf. `src-tauri/target`, `dist-mac` / `dist-win` und
`src-tauri/resources/studio`. Das ist normal — neu erzeugen mit den Build-Skripten oben
(`Build Mac App.command` bzw. `Build Windows.bat`).