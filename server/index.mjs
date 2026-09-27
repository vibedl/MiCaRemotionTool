import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import multer from "multer";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { scanFolder } from "./scan.mjs";
import {
  buildJobFile,
  listAllJobs,
  nameFromJobPath,
  readJobFromJobsDir,
  readJobFromPath,
  resolveJobFile,
  sanitizeJobName,
  writeJobToJobsDir,
  writeJobToPath,
} from "./jobFile.mjs";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4300;
const HOST = process.env.HOST || "0.0.0.0";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_POINT = path.join(PROJECT_ROOT, "src", "index.ts");
const OUT_DIR = path.join(PROJECT_ROOT, "out");
const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads");
const WEBAPP_DIST = path.join(PROJECT_ROOT, "dist-webapp");
const COMPOSITION_ID = "RoomFlythrough";

/** Public origin for absolute media refs inside job files (optional). Empty = relative paths. */
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");

/** Origin the headless render browser uses to fetch `/uploads`, `/assets`, `/media`. */
const INTERNAL_ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Server-side folder scan and arbitrary job paths read/write the server's
 * filesystem — fine on your own machine, dangerous on a public host. Enabled
 * only for `pnpm run server` (`--local`) or with ALLOW_SERVER_FS=1.
 */
const ALLOW_SERVER_FS = process.argv.includes("--local") || process.env.ALLOW_SERVER_FS === "1";

/** Optional custom Chrome/Chromium for rendering (otherwise Remotion downloads its own). */
const BROWSER_EXECUTABLE = process.env.REMOTION_BROWSER_EXECUTABLE || null;

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 40;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
      cb(null, `${base}-${randomUUID().slice(0, 8)}${ext.toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, IMAGE_EXT.has(path.extname(file.originalname).toLowerCase()));
  },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/assets", express.static(path.join(PROJECT_ROOT, "public", "assets")));
app.use("/out", express.static(OUT_DIR));

let lastScannedFolder = null;
/** @type {Map<string, {status: "queued"|"rendering"|"done"|"error", progress: number, queuePosition?: number, outputPath?: string, downloadUrl?: string, error?: string}>} */
const jobs = new Map();

function requireServerFs(_req, res, next) {
  if (ALLOW_SERVER_FS) return next();
  res.status(403).json({ error: "Server-Dateisystem ist in diesem Modus deaktiviert (ALLOW_SERVER_FS=1 zum Freischalten)." });
}

app.get("/api/config", (_req, res) => {
  res.json({ serverFs: ALLOW_SERVER_FS, maxUploadMb: MAX_UPLOAD_MB });
});

app.get("/api/scan", requireServerFs, (req, res) => {
  const folder = String(req.query.folder ?? "");
  try {
    const result = scanFolder(folder);
    lastScannedFolder = path.resolve(folder);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/media/:filename", requireServerFs, (req, res) => {
  if (!lastScannedFolder) {
    res.status(404).json({ error: "Noch kein Ordner gescannt." });
    return;
  }
  const filename = decodeURIComponent(req.params.filename);
  const resolved = path.resolve(lastScannedFolder, filename);
  if (!resolved.startsWith(lastScannedFolder)) {
    res.status(400).json({ error: "Ungültiger Pfad." });
    return;
  }
  res.sendFile(resolved);
});

app.post("/api/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({
        error: err.code === "LIMIT_FILE_SIZE" ? `Datei zu groß (max. ${MAX_UPLOAD_MB} MB).` : String(err.message ?? err),
      });
      return;
    }
    next();
  });
}, (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Keine Bilddatei erhalten (PNG, JPG oder WebP)." });
    return;
  }
  const label = path.basename(req.file.originalname, path.extname(req.file.originalname));
  res.json({ label, filename: req.file.filename, url: `/uploads/${req.file.filename}` });
});

app.post("/api/render", (req, res) => {
  const jobId = randomUUID();
  const { outputName, durationInFrames, ...jobProps } = req.body ?? {};
  const safeName = (outputName || "room-flythrough").replace(/[^a-zA-Z0-9_-]/g, "_");
  const outputPath = path.join(OUT_DIR, `${safeName}-${jobId.slice(0, 8)}.mp4`);

  renderQueue.push({ jobId, jobProps, durationInFrames, outputPath });
  jobs.set(jobId, { status: "queued", progress: 0, queuePosition: renderQueue.length });
  res.json({ jobId });
  void pumpRenderQueue();
});

app.get("/api/render/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Unbekannte Render-Job-ID." });
    return;
  }
  const { outputPath: _hidden, ...publicJob } = job;
  res.json(publicJob);
});

app.get("/api/render/:jobId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done" || !job.outputPath) {
    res.status(404).json({ error: "Render noch nicht fertig oder unbekannt." });
    return;
  }
  if (!fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: "Ausgabedatei nicht gefunden." });
    return;
  }
  res.download(job.outputPath, path.basename(job.outputPath));
});

app.get("/api/job", (req, res) => {
  if (req.query.path && !ALLOW_SERVER_FS) {
    requireServerFs(req, res, () => {});
    return;
  }
  const filePath = String(req.query.path ?? "").trim();
  const name = String(req.query.name ?? "").trim();
  if (!filePath && !name) {
    res.status(400).json({ error: "path oder name fehlt." });
    return;
  }
  try {
    let raw = null;
    let pathWritten = null;
    if (filePath) {
      raw = readJobFromPath(filePath);
      pathWritten = path.resolve(filePath);
    } else if (name) {
      raw = readJobFromJobsDir(PROJECT_ROOT, name);
      pathWritten = raw ? path.join(PROJECT_ROOT, "jobs", `${sanitizeJobName(name)}.json`) : null;
    }
    if (!raw) {
      res.status(404).json({
        error: filePath
          ? `Datei nicht gefunden: ${filePath}`
          : `Keine Job-Datei für „${name}“ gefunden.`,
      });
      return;
    }
    const resolved = resolveJobFile(raw, PUBLIC_ORIGIN);
    res.json({
      file: raw,
      ...resolved,
      path: pathWritten,
      name: nameFromJobPath(pathWritten ?? "", raw),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/job", (req, res) => {
  const { name, durationInFrames, outputName, job, filePath, sourceFolder } = req.body ?? {};
  if (filePath && !ALLOW_SERVER_FS) {
    requireServerFs(req, res, () => {});
    return;
  }
  if (!job) {
    res.status(400).json({ error: "job ist erforderlich." });
    return;
  }
  try {
    const inferredName =
      name ||
      outputName ||
      (filePath ? path.basename(String(filePath), path.extname(String(filePath))) : null) ||
      "room-flythrough";
    const jobFile = buildJobFile({
      sourceFolder: ALLOW_SERVER_FS ? sourceFolder || PROJECT_ROOT : "",
      name: inferredName,
      durationInFrames: Number(durationInFrames),
      outputName,
      job,
      serverUrl: PUBLIC_ORIGIN,
    });

    let pathWritten;
    if (filePath) {
      pathWritten = writeJobToPath(String(filePath), jobFile);
    } else {
      pathWritten = writeJobToJobsDir(PROJECT_ROOT, jobFile);
    }

    res.json({
      ok: true,
      path: pathWritten,
      name: jobFile.name,
      updatedAt: jobFile.updatedAt,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/jobs", (_req, res) => {
  try {
    res.json({ jobs: listAllJobs(PROJECT_ROOT, null) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Renders run one at a time — a WebGL render saturates the machine anyway. */
const renderQueue = [];
let rendering = false;
/** @type {Promise<string> | null} */
let bundlePromise = null;

/** Local dev (`--local`) rebundles per render so source edits show up without a restart. */
const CACHE_BUNDLE = !process.argv.includes("--local");

function getBundle() {
  // Bundling takes several seconds; reuse it for every render of this server process.
  if (!CACHE_BUNDLE) return bundle({ entryPoint: ENTRY_POINT });
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: ENTRY_POINT }).catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

/**
 * Job media refs are relative to this server (`/uploads/…`, `/assets/…`,
 * `/media/…`). The headless render browser runs on Remotion's own server,
 * so those paths must point back at Express explicitly.
 */
function absolutizeSrc(src) {
  if (typeof src === "string" && src.startsWith("./")) src = src.slice(1);
  if (typeof src !== "string" || !src.startsWith("/")) return src;
  return `${INTERNAL_ORIGIN}${src}`;
}

function absolutizeJobMedia(jobProps) {
  return {
    ...jobProps,
    pictures: (jobProps.pictures ?? []).map((p) => ({ ...p, src: absolutizeSrc(p.src) })),
    rooms: (jobProps.rooms ?? []).map((r) => ({ ...r, src: absolutizeSrc(r.src) })),
    ...(jobProps.gloss?.reflectionMap
      ? { gloss: { ...jobProps.gloss, reflectionMap: absolutizeSrc(jobProps.gloss.reflectionMap) } }
      : {}),
  };
}

function refreshQueuePositions() {
  renderQueue.forEach((item, i) => {
    const job = jobs.get(item.jobId);
    if (job?.status === "queued") jobs.set(item.jobId, { ...job, queuePosition: i + 1 });
  });
}

async function pumpRenderQueue() {
  if (rendering) return;
  const next = renderQueue.shift();
  if (!next) return;
  rendering = true;
  refreshQueuePositions();
  jobs.set(next.jobId, { status: "rendering", progress: 0 });
  try {
    await runRender(next);
  } catch (err) {
    console.error(`Render ${next.jobId} fehlgeschlagen:`, err);
    jobs.set(next.jobId, { status: "error", progress: 0, error: err instanceof Error ? err.message : String(err) });
  } finally {
    rendering = false;
    void pumpRenderQueue();
  }
}

async function runRender({ jobId, jobProps, durationInFrames, outputPath }) {
  const bundleLocation = await getBundle();
  const inputProps = absolutizeJobMedia(jobProps);
  const browserOptions = {
    chromiumOptions: { gl: "angle" },
    ...(BROWSER_EXECUTABLE ? { browserExecutable: BROWSER_EXECUTABLE } : {}),
  };

  const metadata = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
    ...browserOptions,
  });

  const composition = durationInFrames
    ? { ...metadata, durationInFrames: Number(durationInFrames) }
    : metadata;

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    ...browserOptions,
    onProgress: ({ progress }) => {
      jobs.set(jobId, { status: "rendering", progress: Math.round(progress * 100) });
    },
  });

  const downloadUrl = `/api/render/${jobId}/download`;
  jobs.set(jobId, {
    status: "done",
    progress: 100,
    outputPath,
    downloadUrl,
  });
}

// A failing render (e.g. browser download blocked) must not take the whole
// web server down with it.
process.on("unhandledRejection", (err) => {
  console.error("Unbehandelter Fehler:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Unbehandelte Ausnahme:", err);
});

// Production: serve the built Vite app from the same origin as the API.
if (fs.existsSync(WEBAPP_DIST)) {
  app.use(express.static(WEBAPP_DIST));
  app.get(/^(?!\/api\/|\/uploads\/|\/media\/|\/assets\/|\/out\/).*/, (_req, res) => {
    res.sendFile(path.join(WEBAPP_DIST, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Room Flythrough server listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Server-Dateisystem (Ordner-Scan, Job-Pfade): ${ALLOW_SERVER_FS ? "an" : "aus"}`);
  if (fs.existsSync(WEBAPP_DIST)) {
    console.log(`Serving webapp from ${WEBAPP_DIST}`);
  } else {
    console.log(`No dist-webapp yet — run "pnpm build" for production, or "pnpm studio" for dev (Vite :5183).`);
  }
});
