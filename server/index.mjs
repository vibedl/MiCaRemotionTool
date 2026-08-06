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

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
      cb(null, `${base}-${randomUUID().slice(0, 8)}${ext}`);
    },
  }),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/assets", express.static(path.join(PROJECT_ROOT, "public", "assets")));
app.use("/out", express.static(OUT_DIR));

let lastScannedFolder = null;
/** @type {Map<string, {status: "rendering"|"done"|"error", progress: number, outputPath?: string, downloadUrl?: string, error?: string}>} */
const jobs = new Map();

app.get("/api/scan", (req, res) => {
  const folder = String(req.query.folder ?? "");
  try {
    const result = scanFolder(folder);
    lastScannedFolder = path.resolve(folder);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/media/:filename", (req, res) => {
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

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Keine Datei erhalten." });
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

  jobs.set(jobId, { status: "rendering", progress: 0 });
  res.json({ jobId });

  runRender({ jobId, jobProps, durationInFrames, outputPath }).catch((err) => {
    jobs.set(jobId, { status: "error", progress: 0, error: err instanceof Error ? err.message : String(err) });
  });
});

app.get("/api/render/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Unbekannte Render-Job-ID." });
    return;
  }
  res.json(job);
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
      sourceFolder: sourceFolder || PROJECT_ROOT,
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

async function runRender({ jobId, jobProps, durationInFrames, outputPath }) {
  const bundleLocation = await bundle({ entryPoint: ENTRY_POINT });

  const metadata = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: jobProps,
    chromiumOptions: { gl: "angle" },
  });

  const composition = durationInFrames
    ? { ...metadata, durationInFrames: Number(durationInFrames) }
    : metadata;

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: jobProps,
    chromiumOptions: { gl: "angle" },
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

// Production: serve the built Vite app from the same origin as the API.
if (fs.existsSync(WEBAPP_DIST)) {
  app.use(express.static(WEBAPP_DIST));
  app.get(/^(?!\/api\/|\/uploads\/|\/media\/|\/assets\/|\/out\/).*/, (_req, res) => {
    res.sendFile(path.join(WEBAPP_DIST, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Room Flythrough server listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  if (fs.existsSync(WEBAPP_DIST)) {
    console.log(`Serving webapp from ${WEBAPP_DIST}`);
  } else {
    console.log(`No dist-webapp yet — run "pnpm build" for production, or "pnpm studio" for dev (Vite :5183).`);
  }
});
