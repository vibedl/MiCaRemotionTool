# Alt — Desktop / Tauri / Native-Dialoge

Dieser Ordner enthält alles, was für die **reine Web-App** nicht mehr nötig ist.
Die App läuft jetzt nur noch als Vite-Frontend + Express-Backend (lokal oder auf einem Server).

## Inhalt

| Pfad | Was |
|------|-----|
| `src-tauri/` | Tauri-Desktop-Shell (ohne `target/` und ohne gebündeltes `resources/studio`) |
| `server/nativeDialog.mjs` | Native OS-Dateidialoge (macOS AppleScript / Windows WinForms) |
| `scripts/standalone/` | Skripte zum Bauen der Standalone-App (Node-Runtime + Installer) |
| `Build Mac App.command` | Ein-Klick-Mac-Build |
| `Build Windows.bat` | Ein-Klick-Windows-Build |
| `BUILD.md` | Alte Build-Anleitung für die Desktop-App |

Build-Artefakte (`dist-mac/`, `dist-webapp/`, `src-tauri/target/`, Render-Outputs in `out/`) wurden **gelöscht**, nicht archiviert — sie lassen sich neu erzeugen.

## Tauri-Desktop wiederherstellen

1. `Alt/src-tauri` zurück nach `src-tauri` im Projektroot kopieren/verschieben.
2. In der Root-`package.json` wieder ergänzen:

```json
"scripts": {
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build"
},
"devDependencies": {
  "@tauri-apps/cli": "^2.2.7"
}
```

3. `corepack pnpm install`
4. Optional: `Alt/scripts/standalone`, Build-Skripte und `BUILD.md` zurückkopieren.
5. `corepack pnpm run tauri:dev` bzw. `tauri:build` (siehe `Alt/BUILD.md`).

Hinweis: `src-tauri/resources/studio` (gebündelte App-Kopie) und `target/` fehlen bewusst — beim nächsten `tauri:build` werden sie neu erzeugt.

## Native Dialoge wiederherstellen

1. `Alt/server/nativeDialog.mjs` nach `server/nativeDialog.mjs` kopieren.
2. In `server/index.mjs` wieder importieren und die Routen `/api/dialog/*` einbinden (Open/Save Job, Ordner, MP4).
3. In der Webapp die Dialog-`fetch`-Aufrufe wieder anbinden (siehe Git-Historie vor dem Web-App-Umbau).

Ohne diese Datei speichert/lädt die Web-App Jobs über Browser-Download/`<input type="file">` und den Server-Ordner `jobs/`.
