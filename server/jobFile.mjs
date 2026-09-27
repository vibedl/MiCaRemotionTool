import fs from "node:fs";
import path from "node:path";

/** Legacy single-job filename (still readable). */
export const JOB_FILENAME = ".room-flythrough.job.json";
export const JOB_VERSION = 1;
export const JOB_FILE_SUFFIX = ".room-flythrough.job.json";

/** Empty string = relative media URLs (preferred for web / same-origin). */
const SERVER_URL_DEFAULT = "";

/**
 * @typedef {object} JobFile
 * @property {number} version
 * @property {string} name
 * @property {string} updatedAt
 * @property {string} sourceFolder
 * @property {number} durationInFrames
 * @property {string} outputName
 * @property {object} job
 */

export function sanitizeJobName(name) {
  const safe = String(name || "room-flythrough").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  return safe.replace(/^_|_$/g, "") || "room-flythrough";
}

/** Named job file inside a shapes folder: MiCa_Job_01.room-flythrough.job.json */
export function namedJobFilename(name) {
  return `${sanitizeJobName(name)}${JOB_FILE_SUFFIX}`;
}

export function jobPathInFolder(folder, name) {
  const resolved = path.resolve(folder);
  if (name) return path.join(resolved, namedJobFilename(name));
  return path.join(resolved, JOB_FILENAME);
}

export function jobsDir(projectRoot) {
  return path.join(projectRoot, "jobs");
}

function stripServerOrigin(src, serverUrl = SERVER_URL_DEFAULT) {
  if (serverUrl && src.startsWith(serverUrl)) return src.slice(serverUrl.length);
  // Drop any absolute http(s) origin so refs stay portable across hosts.
  try {
    if (/^https?:\/\//i.test(src)) {
      const u = new URL(src);
      return u.pathname + u.search;
    }
  } catch {
    /* keep as-is */
  }
  return src;
}

function withOrigin(pathPart, serverUrl = SERVER_URL_DEFAULT) {
  if (!serverUrl) return pathPart;
  return `${serverUrl}${pathPart}`;
}

/** Persistable ref: media:file.png | upload:file.png | asset:file.png | absolute http url fallback */
export function srcToRef(src, serverUrl = SERVER_URL_DEFAULT) {
  const rel = stripServerOrigin(src, serverUrl);
  if (rel.startsWith("/media/")) return `media:${decodeURIComponent(rel.slice("/media/".length))}`;
  if (rel.startsWith("/uploads/")) return `upload:${rel.slice("/uploads/".length)}`;
  if (rel.startsWith("/assets/")) return `asset:${rel.slice("/assets/".length)}`;
  if (rel.startsWith("assets/")) return `asset:${rel.slice("assets/".length)}`;
  const assetsIdx = rel.indexOf("/assets/");
  if (assetsIdx >= 0) return `asset:${rel.slice(assetsIdx + "/assets/".length)}`;
  return src;
}

export function refToSrc(ref, serverUrl = SERVER_URL_DEFAULT) {
  if (ref.startsWith("media:")) {
    return withOrigin(`/media/${encodeURIComponent(ref.slice("media:".length))}`, serverUrl);
  }
  if (ref.startsWith("upload:")) {
    return withOrigin(`/uploads/${ref.slice("upload:".length)}`, serverUrl);
  }
  if (ref.startsWith("asset:")) {
    return withOrigin(`/assets/${ref.slice("asset:".length)}`, serverUrl);
  }
  return ref;
}

function scaleFields(item) {
  return {
    scaleX: item.scaleX ?? 1,
    scaleY: item.scaleY ?? 1,
    aspectLock: item.aspectLock !== false,
  };
}

function pictureFields(item) {
  return {
    ...scaleFields(item),
    offsetX: item.offsetX ?? 0,
    offsetY: item.offsetY ?? 0,
  };
}

function normalizeMediaList(items, serverUrl) {
  return items.map((item) => ({
    label: item.label,
    src: srcToRef(item.src, serverUrl),
    ...pictureFields(item),
  }));
}

function resolveMediaList(items, serverUrl) {
  return items.map((item) => ({
    label: item.label,
    src: refToSrc(item.src, serverUrl),
    ...pictureFields(item),
  }));
}

/**
 * @param {object} params
 * @param {string} params.sourceFolder
 * @param {string} params.name
 * @param {number} params.durationInFrames
 * @param {string} params.outputName
 * @param {object} params.job
 * @param {string} [params.serverUrl]
 */
export function buildJobFile({ sourceFolder, name, durationInFrames, outputName, job, serverUrl }) {
  const url = serverUrl ?? SERVER_URL_DEFAULT;
  const folder = sourceFolder ? path.resolve(sourceFolder) : "";
  return {
    version: JOB_VERSION,
    name: name || "room-flythrough",
    updatedAt: new Date().toISOString(),
    sourceFolder: folder,
    durationInFrames,
    outputName: outputName || "room-flythrough",
    job: {
      pictures: normalizeMediaList(job.pictures ?? [], url),
      rooms: (job.rooms ?? []).map((r) => ({
        label: r.label,
        src: srcToRef(r.src, url),
        holdFrames: r.holdFrames,
        ...scaleFields(r),
      })),
      transitionFrames: job.transitionFrames ?? 14,
      crossfadeFrames: job.crossfadeFrames ?? 30,
      cameraKeyframes: job.cameraKeyframes ?? [],
      shadow: job.shadow ?? { offsetX: 0.012, offsetY: -0.016, opacity: 0.22 },
      gloss: job.gloss ?? { strength: 0.22, sharpness: 0.6, reflectStrength: 1 },
      extrusionDepth: job.extrusionDepth ?? 0.06,
    },
  };
}

/** @param {JobFile} file @param {string} [serverUrl] */
export function resolveJobFile(file, serverUrl) {
  const url = serverUrl ?? SERVER_URL_DEFAULT;
  const j = file.job ?? {};
  return {
    durationInFrames: file.durationInFrames,
    outputName: file.outputName,
    sourceFolder: file.sourceFolder,
    name: file.name,
    job: {
      pictures: resolveMediaList(j.pictures ?? [], url),
      rooms: (j.rooms ?? []).map((r) => ({
        label: r.label,
        src: refToSrc(r.src, url),
        holdFrames: r.holdFrames,
        ...scaleFields(r),
      })),
      transitionFrames: j.transitionFrames ?? 14,
      crossfadeFrames: j.crossfadeFrames ?? 30,
      cameraKeyframes: j.cameraKeyframes ?? [],
      shadow: j.shadow ?? { offsetX: 0.012, offsetY: -0.016, opacity: 0.22 },
      gloss: j.gloss ?? { strength: 0.22, sharpness: 0.6, reflectStrength: 1 },
      extrusionDepth: j.extrusionDepth ?? 0.06,
    },
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Read a named job from folder. If `name` omitted, tries legacy single file,
 * then the newest named `*.room-flythrough.job.json`.
 */
export function readJobFromFolder(folder, name) {
  const resolved = path.resolve(folder);
  if (name) {
    const named = readJsonIfExists(jobPathInFolder(resolved, name));
    if (named) return named;
    // Fallback: legacy file if name matches its contents
    const legacy = readJsonIfExists(path.join(resolved, JOB_FILENAME));
    if (legacy && (!legacy.name || sanitizeJobName(legacy.name) === sanitizeJobName(name))) {
      return legacy;
    }
    return null;
  }

  const namedJobs = listJobsInFolder(resolved);
  if (namedJobs.length > 0) {
    const newest = namedJobs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    return readJsonIfExists(newest.path);
  }

  return readJsonIfExists(path.join(resolved, JOB_FILENAME));
}

/** Always writes a per-job named file (never overwrites other jobs). */
export function writeJobToFolder(folder, jobFile) {
  const filePath = jobPathInFolder(folder, jobFile.name);
  fs.writeFileSync(filePath, JSON.stringify(jobFile, null, 2), "utf8");
  return filePath;
}

export function writeJobToJobsDir(projectRoot, jobFile) {
  const dir = jobsDir(projectRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safe = sanitizeJobName(jobFile.name);
  const filePath = path.join(dir, `${safe}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jobFile, null, 2), "utf8");
  return filePath;
}

/** Read job JSON from an arbitrary absolute path. */
export function readJobFromPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

/** Write job JSON to an arbitrary absolute path (creates parent dirs). */
export function writeJobToPath(filePath, jobFile) {
  let resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith(".json")) {
    resolved = `${resolved}.room-flythrough.job.json`;
  }
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(jobFile, null, 2), "utf8");
  return resolved;
}

/** Infer job display name from path / file contents. */
export function nameFromJobPath(filePath, jobFile) {
  if (jobFile?.name) return jobFile.name;
  const base = path.basename(filePath, path.extname(filePath));
  if (base.endsWith(".room-flythrough.job")) {
    return base.slice(0, -".room-flythrough.job".length) || "room-flythrough";
  }
  return base || "room-flythrough";
}

export function readJobFromJobsDir(projectRoot, name) {
  const filePath = path.join(jobsDir(projectRoot), `${sanitizeJobName(name)}.json`);
  return readJsonIfExists(filePath);
}

/** List named job files inside a shapes folder. */
export function listJobsInFolder(folder) {
  const resolved = path.resolve(folder);
  if (!fs.existsSync(resolved)) return [];
  const entries = [];

  for (const f of fs.readdirSync(resolved)) {
    if (!f.endsWith(JOB_FILE_SUFFIX) && f !== JOB_FILENAME) continue;
    const full = path.join(resolved, f);
    try {
      const data = JSON.parse(fs.readFileSync(full, "utf8"));
      const name =
        data.name ??
        (f === JOB_FILENAME ? "room-flythrough" : f.slice(0, -JOB_FILE_SUFFIX.length));
      entries.push({
        path: full,
        name,
        updatedAt: data.updatedAt ?? null,
        sourceFolder: data.sourceFolder ?? resolved,
        location: "folder",
      });
    } catch {
      entries.push({ path: full, name: f, updatedAt: null, sourceFolder: resolved, location: "folder" });
    }
  }

  return entries;
}

export function listJobsInDir(projectRoot) {
  const dir = jobsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          path: full,
          name: data.name ?? f.replace(/\.json$/, ""),
          updatedAt: data.updatedAt,
          sourceFolder: data.sourceFolder,
          location: "jobsDir",
        };
      } catch {
        return { path: full, name: f, updatedAt: null, sourceFolder: null, location: "jobsDir" };
      }
    });
}

/** Merge folder jobs + optional project jobs/ (folder first, then jobsDir extras). */
export function listAllJobs(projectRoot, folder) {
  const byName = new Map();
  if (folder) {
    for (const j of listJobsInFolder(folder)) {
      byName.set(sanitizeJobName(j.name), j);
    }
  }
  for (const j of listJobsInDir(projectRoot)) {
    const key = sanitizeJobName(j.name);
    if (!byName.has(key)) byName.set(key, j);
  }
  return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
