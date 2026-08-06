import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const ROOM_PATTERN = /raum|bg|background|hintergrund/i;
const REFLECTION_PATTERN = /reflection|reflex/i;

function labelFromFilename(filename) {
  return path.basename(filename, path.extname(filename));
}

/**
 * Lists every image in `folder`. Classification by filename is only a
 * *suggestion* (`suggestedType`) — the UI assigns Raum/Bild explicitly so
 * adding assets does not depend on naming conventions.
 *
 * @returns {{ folder: string, items: Array<{label:string,filename:string,url:string,suggestedType:"room"|"picture"|"reflection"}> }}
 */
export function scanFolder(folder) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`Ordner nicht gefunden: ${folder}`);
  }

  const entries = fs
    .readdirSync(folder)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const items = entries.map((filename) => {
    let suggestedType = "picture";
    if (REFLECTION_PATTERN.test(filename)) suggestedType = "reflection";
    else if (ROOM_PATTERN.test(filename)) suggestedType = "room";

    return {
      label: labelFromFilename(filename),
      filename,
      url: `/media/${encodeURIComponent(filename)}`,
      suggestedType,
    };
  });

  return { folder, items };
}
