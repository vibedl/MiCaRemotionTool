import type { RoomFlythroughProps } from "../src/RoomFlythrough";

export const AUTOSAVE_KEY = "room-flythrough:autosave";

export type JobSnapshot = {
  folder: string;
  jobName: string;
  durationInFrames: number;
  outputName: string;
  job: RoomFlythroughProps;
  savedAt?: string;
};

export type PortableJobFile = {
  version: number;
  name: string;
  updatedAt: string;
  sourceFolder?: string;
  durationInFrames: number;
  outputName: string;
  job: RoomFlythroughProps;
};

export function readAutosave(): JobSnapshot | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as JobSnapshot;
  } catch {
    return null;
  }
}

export function writeAutosave(snapshot: JobSnapshot) {
  localStorage.setItem(
    AUTOSAVE_KEY,
    JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }),
  );
}

export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

export function buildPortableJob(snapshot: Omit<JobSnapshot, "savedAt">): PortableJobFile {
  return {
    version: 1,
    name: snapshot.jobName || "room-flythrough",
    updatedAt: new Date().toISOString(),
    sourceFolder: snapshot.folder || undefined,
    durationInFrames: snapshot.durationInFrames,
    outputName: snapshot.outputName,
    job: snapshot.job,
  };
}

export async function saveJobLocally(file: PortableJobFile): Promise<string> {
  const filename = `${(file.name || "room-flythrough").replace(/[^a-zA-Z0-9_-]/g, "_")}.room-flythrough.job.json`;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });

  const w = window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };

  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Room Flythrough Job", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return filename;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

export async function readJobFromFile(file: File): Promise<PortableJobFile> {
  const text = await file.text();
  const data = JSON.parse(text) as PortableJobFile;
  if (!data.job) throw new Error("Ungültige Job-Datei (job fehlt).");
  return data;
}
