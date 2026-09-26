import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, PlayerRef } from "@remotion/player";
import { resolveCameraAxes, RoomFlythrough, RoomFlythroughProps } from "../src/RoomFlythrough";
import { defaultJobProps } from "../src/Root";
import { DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "../src/constants";
import type { CameraKeyframe, PictureDef, RoomDef } from "../src/types";
import { resolvePictureOffset, resolveScale } from "../src/types";
import { distributePictureHolds, pictureHoldMidFrame } from "../src/timing";
import { SliderField } from "./SliderField";
import { CameraTimeline } from "./CameraTimeline";
import { RoomTimeline } from "./RoomTimeline";
import { SizeAspectControls } from "./SizeAspectControls";
import { frameAtRoomSegmentCenter, framesToSec, layoutRoomSegments, secToFrames } from "./roomTiming";
import {
  buildPortableJob,
  readAutosave,
  readJobFromFile,
  saveJobLocally,
  writeAutosave,
} from "./jobStorage";
import {
  apiUrl,
  detectServer,
  inlineBlobSrc,
  mediaUrl,
  portableAssetSrc,
  storeImage,
  type ServerConfig,
} from "./clientApi";
import { renderInBrowser } from "./browserRender";
import { useEditorHistory } from "./useEditorHistory";
import { AutoBuilder, type AutoBuildResult } from "./AutoBuilder";

type ScannedItem = {
  label: string;
  filename: string;
  url: string;
  suggestedType: "room" | "picture" | "reflection";
};

type RenderStatus = {
  status: "idle" | "rendering" | "done" | "error";
  progress: number;
  queuePosition?: number;
  outputPath?: string;
  downloadUrl?: string;
  error?: string;
};

type ServerJobEntry = {
  path: string;
  name: string;
  updatedAt: string | null;
};

type SizeTarget = { kind: "picture" | "room"; index: number };

/** Rewrites bundled `/assets/…` refs so they also load from a sub-path (GitHub Pages). */
function withPortableAssets(job: RoomFlythroughProps): RoomFlythroughProps {
  return {
    ...job,
    pictures: job.pictures.map((p) => ({ ...p, src: portableAssetSrc(p.src) })),
    rooms: job.rooms.map((r) => ({ ...r, src: portableAssetSrc(r.src) })),
  };
}

const initialJob = withPortableAssets(defaultJobProps);

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const FilePickerButton: React.FC<{
  label: string;
  multiple?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
}> = ({ label, multiple, accept = "image/*", onFiles }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
    </>
  );
};

export const App: React.FC = () => {
  const [folder, setFolder] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanItems, setScanItems] = useState<ScannedItem[]>([]);

  const {
    job,
    setJob,
    durationInFrames,
    setDurationInFrames,
    undo,
    redo,
    canUndo,
    canRedo,
    resetHistory,
  } = useEditorHistory({ job: initialJob, durationInFrames: DURATION_IN_FRAMES });

  const [activeFrame, setActiveFrame] = useState(job.cameraKeyframes[0]?.frame ?? 0);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState<number | null>(0);
  const [sizeTarget, setSizeTarget] = useState<SizeTarget>({ kind: "room", index: 0 });
  const playerRef = useRef<PlayerRef>(null);

  const scrubTo = useCallback((frame: number) => {
    setActiveFrame(frame);
    playerRef.current?.pause();
    playerRef.current?.seekTo(frame);
  }, []);

  const selectedKeyframeIndex = job.cameraKeyframes.findIndex((k) => k.frame === activeFrame);
  const selectedKeyframe = selectedKeyframeIndex >= 0 ? job.cameraKeyframes[selectedKeyframeIndex] : null;
  const previewAxes = useMemo(
    () => resolveCameraAxes(activeFrame, job.cameraKeyframes),
    [activeFrame, job.cameraKeyframes],
  );

  const applyCameraEdit = useCallback(
    (patch: Partial<Pick<CameraKeyframe, "position" | "rotation" | "fov">>) => {
      setJob((p) => {
        const idx = p.cameraKeyframes.findIndex((k) => k.frame === activeFrame);
        if (idx >= 0) {
          return {
            ...p,
            cameraKeyframes: p.cameraKeyframes.map((k, i) => (i === idx ? { ...k, ...patch } : k)),
          };
        }
        const axes = resolveCameraAxes(activeFrame, p.cameraKeyframes);
        const seeded: CameraKeyframe = {
          frame: activeFrame,
          position: axes.position,
          rotation: axes.rotation,
          fov: axes.fov,
          ...patch,
        };
        return {
          ...p,
          cameraKeyframes: [...p.cameraKeyframes, seeded].sort((a, b) => a.frame - b.frame),
        };
      });
    },
    [activeFrame, setJob],
  );

  const [outputName, setOutputName] = useState("room-flythrough");
  const [jobName, setJobName] = useState("room-flythrough");
  const [currentJobPath, setCurrentJobPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [serverJobs, setServerJobs] = useState<ServerJobEntry[]>([]);
  const [renderState, setRenderState] = useState<RenderStatus>({ status: "idle", progress: 0 });
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  /** Browser render result (static mode): object URL + file name for the download link. */
  const [localVideo, setLocalVideo] = useState<{ url: string; filename: string } | null>(null);
  /** undefined = still checking, null = no backend (static hosting). */
  const [server, setServer] = useState<ServerConfig | null | undefined>(undefined);
  const serverFs = Boolean(server?.serverFs);
  const pollRef = useRef<number | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const skipAutosave = useRef(true);

  const applyLoadedProject = useCallback(
    (loaded: {
      job: RoomFlythroughProps;
      durationInFrames?: number;
      outputName?: string;
      name?: string;
      sourceFolder?: string;
      path?: string;
    }) => {
      resetHistory({
        job: withPortableAssets(loaded.job),
        durationInFrames: loaded.durationInFrames ?? DURATION_IN_FRAMES,
      });
      if (loaded.outputName) setOutputName(loaded.outputName);
      if (loaded.name) setJobName(loaded.name);
      if (loaded.sourceFolder) setFolder(loaded.sourceFolder);
      if (loaded.path) setCurrentJobPath(loaded.path);
      setActiveFrame(loaded.job.cameraKeyframes[0]?.frame ?? 0);
      setSelectedRoomIndex(0);
      setSizeTarget({ kind: "room", index: 0 });
      setDirty(false);
    },
    [resetHistory],
  );

  const refreshServerJobs = useCallback(async () => {
    if (!(await detectServer())) return;
    try {
      const res = await fetch(apiUrl("/api/jobs"));
      const data = await res.json();
      if (res.ok) setServerJobs(data.jobs ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const saveToServer = useCallback(async () => {
    setSaveMessage(null);
    try {
      const res = await fetch(apiUrl("/api/job"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: jobName,
          durationInFrames,
          outputName,
          sourceFolder: folder.trim() || undefined,
          job,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setCurrentJobPath(data.path);
      if (data.name) setJobName(data.name);
      setLastSavedAt(data.updatedAt);
      setDirty(false);
      setSaveMessage(`Auf Server gespeichert: ${data.path}`);
      writeAutosave({ folder, jobName: data.name ?? jobName, durationInFrames, outputName, job });
      await refreshServerJobs();
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : String(e));
    }
  }, [folder, jobName, durationInFrames, outputName, job, refreshServerJobs]);

  const saveLocal = useCallback(async () => {
    setSaveMessage(null);
    try {
      // Images that only live in this browser tab get embedded into the file.
      const inlined: RoomFlythroughProps = {
        ...job,
        pictures: await Promise.all(job.pictures.map(async (p) => ({ ...p, src: await inlineBlobSrc(p.src) }))),
        rooms: await Promise.all(job.rooms.map(async (r) => ({ ...r, src: await inlineBlobSrc(r.src) }))),
      };
      const portable = buildPortableJob({ folder, jobName, durationInFrames, outputName, job: inlined });
      const name = await saveJobLocally(portable);
      setLastSavedAt(portable.updatedAt);
      setDirty(false);
      setSaveMessage(`Lokal gespeichert: ${name}`);
      writeAutosave({ folder, jobName, durationInFrames, outputName, job });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setSaveMessage("Lokales Speichern abgebrochen.");
        return;
      }
      setSaveMessage(e instanceof Error ? e.message : String(e));
    }
  }, [folder, jobName, durationInFrames, outputName, job]);

  const loadFromServer = useCallback(
    async (name: string) => {
      setSaveMessage(null);
      try {
        const res = await fetch(apiUrl(`/api/job?name=${encodeURIComponent(name)}`));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Laden fehlgeschlagen");
        applyLoadedProject({
          job: data.job,
          durationInFrames: data.durationInFrames,
          outputName: data.outputName,
          name: data.name,
          sourceFolder: data.sourceFolder,
          path: data.path,
        });
        setLastSavedAt(data.file?.updatedAt ?? null);
        setSaveMessage(`Vom Server geladen: ${data.name}`);
      } catch (e) {
        setSaveMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [applyLoadedProject],
  );

  const loadLocalFiles = useCallback(
    async (files: File[]) => {
      setSaveMessage(null);
      try {
        const file = files[0];
        if (!file) return;
        const data = await readJobFromFile(file);
        applyLoadedProject({
          job: data.job,
          durationInFrames: data.durationInFrames,
          outputName: data.outputName,
          name: data.name,
          sourceFolder: data.sourceFolder,
          path: undefined,
        });
        setCurrentJobPath(null);
        setLastSavedAt(data.updatedAt ?? null);
        setSaveMessage(`Lokal geladen: ${file.name}`);
      } catch (e) {
        setSaveMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [applyLoadedProject],
  );

  useEffect(() => {
    const saved = readAutosave();
    if (saved?.job) {
      applyLoadedProject(saved);
      setLastSavedAt(saved.savedAt ?? null);
    }
    skipAutosave.current = false;
    void refreshServerJobs();
  }, [applyLoadedProject, refreshServerJobs]);

  useEffect(() => {
    if (skipAutosave.current) return;
    setDirty(true);
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      writeAutosave({ folder, jobName, durationInFrames, outputName, job });
    }, 2000);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [job, durationInFrames, outputName, folder, jobName]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const scanFolder = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch(apiUrl(`/api/scan?folder=${encodeURIComponent(folder)}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan fehlgeschlagen");
      setScanItems(data.items ?? []);
      setSaveMessage(`${(data.items ?? []).length} Bild(er) gefunden — Typ wählen und hinzufügen.`);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [folder]);

  const addScanItemAs = useCallback(
    (item: ScannedItem, type: "picture" | "room") => {
      const src = mediaUrl(item.url);
      if (type === "picture") {
        setJob((p) => ({
          ...p,
          pictures: [
            ...p.pictures,
            { label: item.label, src, scaleX: 1, scaleY: 1, aspectLock: true, offsetX: 0, offsetY: 0 },
          ],
        }));
        setSizeTarget({ kind: "picture", index: job.pictures.length });
      } else {
        setJob((p) => {
          const perRoom = Math.floor(durationInFrames / (p.rooms.length + 1));
          return {
            ...p,
            rooms: [
              ...p.rooms,
              { label: item.label, src, holdFrames: perRoom, scaleX: 1, scaleY: 1, aspectLock: true },
            ],
          };
        });
        setSelectedRoomIndex(job.rooms.length);
        setSizeTarget({ kind: "room", index: job.rooms.length });
      }
    },
    [durationInFrames, job.pictures.length, job.rooms.length],
  );

  const startRender = useCallback(
    async (override?: AutoBuildResult) => {
      const renderJob = override?.job ?? job;
      const renderDuration = override?.durationInFrames ?? durationInFrames;
      try {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setRenderState({ status: "rendering", progress: 0 });
        setRenderJobId(null);
        setLocalVideo((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return null;
        });

        if (!(await detectServer())) {
          const { blob, extension } = await renderInBrowser(renderJob, renderDuration, (progress) =>
            setRenderState({ status: "rendering", progress }),
          );
          const safeName = (outputName || "room-flythrough").replace(/[^a-zA-Z0-9_-]/g, "_");
          setLocalVideo({ url: URL.createObjectURL(blob), filename: `${safeName}.${extension}` });
          setRenderState({ status: "done", progress: 100 });
          return;
        }

        const res = await fetch(apiUrl("/api/render"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...renderJob, durationInFrames: renderDuration, outputName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Render fehlgeschlagen");
        const jobId = data.jobId as string;
        setRenderJobId(jobId);

        pollRef.current = window.setInterval(async () => {
          try {
            const statusRes = await fetch(apiUrl(`/api/render/${jobId}`));
            const statusData = await statusRes.json();
            if (!statusRes.ok) throw new Error(statusData.error ?? "Render-Status unbekannt");
            // "queued" is shown as rendering at 0 % plus the queue position.
            setRenderState({ ...statusData, status: statusData.status === "queued" ? "rendering" : statusData.status });
            if (statusData.status === "done" || statusData.status === "error") {
              if (pollRef.current) window.clearInterval(pollRef.current);
            }
          } catch (e) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setRenderState({ status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
          }
        }, 1000);
      } catch (e) {
        setRenderState({ status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
      }
    },
    [job, durationInFrames, outputName],
  );

  const applyAutoBuild = useCallback(
    (result: AutoBuildResult, { render }: { render: boolean }) => {
      setJob(result.job);
      setDurationInFrames(result.durationInFrames);
      setSelectedRoomIndex(0);
      setSizeTarget({ kind: "room", index: 0 });
      setActiveFrame(0);
      playerRef.current?.seekTo(0);
      playerRef.current?.play();
      if (render) void startRender(result);
    },
    [setJob, setDurationInFrames, startRender],
  );

  useEffect(() => {
    void detectServer().then(setServer);
  }, []);

  const activeSizeItem =
    sizeTarget.kind === "picture"
      ? job.pictures[sizeTarget.index]
      : job.rooms[sizeTarget.index];
  const activeSizeValue = activeSizeItem
    ? resolveScale(activeSizeItem)
    : { scaleX: 1, scaleY: 1, aspectLock: true };

  const applySizeChange = (next: { scaleX: number; scaleY: number; aspectLock: boolean }) => {
    if (sizeTarget.kind === "picture") {
      setJob((p) => ({
        ...p,
        pictures: p.pictures.map((pic, i) => (i === sizeTarget.index ? { ...pic, ...next } : pic)),
      }));
    } else {
      setJob((p) => ({
        ...p,
        rooms: p.rooms.map((r, i) => (i === sizeTarget.index ? { ...r, ...next } : r)),
      }));
    }
  };

  const selectPicture = (index: number) => {
    setSizeTarget({ kind: "picture", index });
    const holds = distributePictureHolds(durationInFrames, job.pictures.length, job.transitionFrames);
    const mid = pictureHoldMidFrame(index, holds, job.transitionFrames);
    scrubTo(Math.max(0, Math.min(mid, durationInFrames - 1)));
  };

  const selectRoom = (index: number) => {
    setSelectedRoomIndex(index);
    setSizeTarget({ kind: "room", index });
    const segs = layoutRoomSegments(job.rooms, FPS);
    const seg = segs[index];
    if (seg) scrubTo(Math.max(0, Math.min(frameAtRoomSegmentCenter(seg), durationInFrames - 1)));
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Room Flythrough Studio</h1>
        <p>Räume und Wandbilder reinziehen — die Animation baut sich automatisch.</p>
      </header>

      <div className="app__body">
        <div className="panel">
          <AutoBuilder
            fps={FPS}
            base={{ shadow: job.shadow, gloss: job.gloss, extrusionDepth: job.extrusionDepth }}
            onBuild={applyAutoBuild}
            renderBusy={renderState.status === "rendering"}
          />

          <section className="card">
            <h2>1. Projekt</h2>
            <div className="project-bar">
              <label className="field">
                Projektname
                <input type="text" value={jobName} onChange={(e) => setJobName(e.target.value)} />
              </label>
              <div className="row project-bar__actions">
                <button type="button" className="secondary" onClick={undo} disabled={!canUndo} title="Strg+Z">
                  Rückgängig
                </button>
                <button type="button" className="secondary" onClick={redo} disabled={!canRedo} title="Strg+Y">
                  Wiederholen
                </button>
                {server && (
                  <button type="button" onClick={saveToServer}>
                    Speichern (Server)
                  </button>
                )}
                <button type="button" className="secondary" onClick={saveLocal}>
                  {server ? "Speichern (lokal)" : "Projekt speichern"}
                </button>
                <FilePickerButton label={server ? "Laden (lokal)…" : "Projekt laden…"} accept=".json,application/json" onFiles={loadLocalFiles} />
              </div>
              {serverJobs.length > 0 && (
                <label className="field">
                  Vom Server laden
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const name = e.target.value;
                      if (name) void loadFromServer(name);
                      e.target.value = "";
                    }}
                  >
                    <option value="">— Job wählen —</option>
                    {serverJobs.map((j) => (
                      <option key={j.path} value={j.name}>
                        {j.name}
                        {j.updatedAt ? ` (${new Date(j.updatedAt).toLocaleString()})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {server && (
                <button type="button" className="secondary" onClick={() => void refreshServerJobs()}>
                  Server-Liste aktualisieren
                </button>
              )}
              {currentJobPath && (
                <p className="hint">
                  Server-Datei: <code>{currentJobPath}</code>
                </p>
              )}
              <p className={`hint${dirty ? " project-bar__dirty" : ""}`}>
                {dirty ? "Ungespeicherte Änderungen" : "Alles gespeichert"}
                {lastSavedAt ? ` · Zuletzt: ${new Date(lastSavedAt).toLocaleString()}` : ""}
              </p>
              {saveMessage && (
                <p
                  className={
                    saveMessage.includes("gespeichert") || saveMessage.includes("geladen") || saveMessage.includes("gefunden")
                      ? "success"
                      : saveMessage.includes("abgebrochen")
                        ? "hint"
                        : "error"
                  }
                >
                  {saveMessage}
                </p>
              )}
            </div>

            {serverFs && (
              <>
            <h3 className="card__sub">Optional: Server-Ordner scannen</h3>
            <div className="row">
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Absoluter Pfad auf dem Server-Rechner"
              />
              <button type="button" onClick={scanFolder} disabled={scanning || !folder.trim()}>
                {scanning ? "Scanne…" : "Scannen"}
              </button>
            </div>
            {scanError && <p className="error">{scanError}</p>}
            <p className="hint">
              Dateinamen sind egal — jedes Bild erscheint in der Liste und wird erst durch „als Raum“ /
              „als Bild“ hinzugefügt. Oder direkt unten per Upload.
            </p>
            {scanItems.length > 0 && (
              <ul className="list list--compact">
                {scanItems.map((item) => (
                  <li key={item.filename}>
                    <img src={mediaUrl(item.url)} alt={item.label} className="thumb" />
                    <span className="label">
                      {item.label}
                      <span className="list__meta"> Vorschlag: {item.suggestedType}</span>
                    </span>
                    <div className="list__actions">
                      <button type="button" onClick={() => addScanItemAs(item, "room")}>
                        als Raum
                      </button>
                      <button type="button" onClick={() => addScanItemAs(item, "picture")}>
                        als Bild
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
              </>
            )}
          </section>

          <section className="card">
            <h2>2. Bilder / Shapes ({job.pictures.length})</h2>
            <ul className="list">
              {job.pictures.map((pic, i) => (
                <li
                  key={`${pic.src}-${i}`}
                  className={sizeTarget.kind === "picture" && sizeTarget.index === i ? "is-selected" : ""}
                  onClick={() => selectPicture(i)}
                >
                  <img src={pic.src} alt={pic.label} className="thumb" />
                  <span className="label">{pic.label}</span>
                  <div className="list__actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, pictures: moveItem(p.pictures, i, -1) }));
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, pictures: moveItem(p.pictures, i, 1) }));
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, pictures: p.pictures.filter((_, idx) => idx !== i) }));
                        if (sizeTarget.kind === "picture" && sizeTarget.index === i) {
                          setSizeTarget({ kind: "room", index: Math.min(selectedRoomIndex ?? 0, Math.max(0, job.rooms.length - 1)) });
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <FilePickerButton
              label="+ Bild hinzufügen"
              multiple
              onFiles={async (files) => {
                const uploaded = await Promise.all(files.map(storeImage));
                setJob((p) => {
                  const start = p.pictures.length;
                  const next: PictureDef[] = [
                    ...p.pictures,
                    ...uploaded.map((u) => ({
                      label: u.label,
                      src: u.src,
                      scaleX: 1,
                      scaleY: 1,
                      aspectLock: true,
                      offsetX: 0,
                      offsetY: 0,
                    })),
                  ];
                  setSizeTarget({ kind: "picture", index: start });
                  return { ...p, pictures: next };
                });
              }}
            />
            <label className="field">
              Morph-Länge zwischen Bildern (Frames)
              <SliderField
                value={job.transitionFrames}
                min={0}
                max={60}
                step={1}
                decimals={0}
                onChange={(v) => setJob((p) => ({ ...p, transitionFrames: v }))}
              />
            </label>
          </section>

          <section className="card">
            <h2>3. Räume / Hintergründe ({job.rooms.length})</h2>
            <p className="hint">
              Zeitleiste: rechten Rand ziehen = Hold-Zeit. Klick = auswählen (auch für Größe unten).
            </p>

            <RoomTimeline
              rooms={job.rooms}
              crossfadeFrames={job.crossfadeFrames}
              durationInFrames={durationInFrames}
              fps={FPS}
              selectedIndex={selectedRoomIndex}
              activeFrame={activeFrame}
              onSelect={selectRoom}
              onScrub={scrubTo}
              onChange={(rooms) => setJob((p) => ({ ...p, rooms }))}
            />

            {selectedRoomIndex !== null && job.rooms[selectedRoomIndex] && (
              <div className="keyframe-editor">
                <h3>Ausgewählter Raum — {job.rooms[selectedRoomIndex].label}</h3>
                <SliderField
                  size="lg"
                  label="Hold-Zeit (Sekunden)"
                  value={framesToSec(job.rooms[selectedRoomIndex].holdFrames, FPS)}
                  min={0.5}
                  max={framesToSec(durationInFrames, FPS)}
                  step={0.1}
                  decimals={1}
                  onChange={(sec) =>
                    setJob((p) => ({
                      ...p,
                      rooms: p.rooms.map((r, i) =>
                        i === selectedRoomIndex ? { ...r, holdFrames: secToFrames(sec, FPS) } : r,
                      ),
                    }))
                  }
                />
              </div>
            )}

            <ul className="list list--compact">
              {job.rooms.map((room, i) => (
                <li
                  key={`${room.src}-${i}`}
                  className={sizeTarget.kind === "room" && sizeTarget.index === i ? "is-selected" : ""}
                  onClick={() => selectRoom(i)}
                >
                  <img src={room.src} alt={room.label} className="thumb" />
                  <span className="label">{room.label}</span>
                  <span className="list__meta">{framesToSec(room.holdFrames, FPS).toFixed(1)} s</span>
                  <div className="list__actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, rooms: moveItem(p.rooms, i, -1) }));
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, rooms: moveItem(p.rooms, i, 1) }));
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={job.rooms.length <= 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setJob((p) => ({ ...p, rooms: p.rooms.filter((_, idx) => idx !== i) }));
                        setSelectedRoomIndex((prev) =>
                          prev === null ? null : prev >= i ? Math.max(0, prev - 1) : prev,
                        );
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <FilePickerButton
              label="+ Raum hinzufügen"
              multiple
              onFiles={async (files) => {
                const uploaded = await Promise.all(files.map(storeImage));
                setJob((p) => {
                  const start = p.rooms.length;
                  const perRoom = Math.floor(durationInFrames / (p.rooms.length + uploaded.length));
                  const next: RoomDef[] = [
                    ...p.rooms,
                    ...uploaded.map((u) => ({
                      label: u.label,
                      src: u.src,
                      holdFrames: perRoom,
                      scaleX: 1,
                      scaleY: 1,
                      aspectLock: true,
                    })),
                  ];
                  setSelectedRoomIndex(start);
                  setSizeTarget({ kind: "room", index: start });
                  return { ...p, rooms: next };
                });
              }}
            />
            <label className="field">
              Crossfade zwischen Räumen (Sekunden)
              <SliderField
                value={framesToSec(job.crossfadeFrames, FPS)}
                min={0}
                max={3}
                step={0.1}
                decimals={1}
                onChange={(sec) => setJob((p) => ({ ...p, crossfadeFrames: secToFrames(sec, FPS) }))}
              />
            </label>
          </section>

          <section className="card">
            <h2>Größe &amp; Position</h2>
            <p className="hint">
              Bild oder Raum anklicken — Vorschau springt dorthin. Shapes lassen sich zusätzlich verschieben.
            </p>
            {activeSizeItem ? (
              <>
                <SizeAspectControls
                  title={
                    sizeTarget.kind === "picture"
                      ? `Bild — ${activeSizeItem.label}`
                      : `Raum — ${activeSizeItem.label}`
                  }
                  value={activeSizeValue}
                  onChange={applySizeChange}
                />
                {sizeTarget.kind === "picture" && (
                  <div className="size-aspect" style={{ marginTop: 12 }}>
                    <h3>Position</h3>
                    <SliderField
                      size="lg"
                      label="Horizontal (offsetX)"
                      value={resolvePictureOffset(activeSizeItem as PictureDef).offsetX}
                      min={-3}
                      max={3}
                      step={0.01}
                      onChange={(v) =>
                        setJob((p) => ({
                          ...p,
                          pictures: p.pictures.map((pic, i) =>
                            i === sizeTarget.index ? { ...pic, offsetX: v } : pic,
                          ),
                        }))
                      }
                    />
                    <SliderField
                      size="lg"
                      label="Vertikal (offsetY)"
                      value={resolvePictureOffset(activeSizeItem as PictureDef).offsetY}
                      min={-3}
                      max={3}
                      step={0.01}
                      onChange={(v) =>
                        setJob((p) => ({
                          ...p,
                          pictures: p.pictures.map((pic, i) =>
                            i === sizeTarget.index ? { ...pic, offsetY: v } : pic,
                          ),
                        }))
                      }
                    />
                  </div>
                )}
              </>
            ) : (
              <p className="hint">Kein Element ausgewählt.</p>
            )}
          </section>

          <section className="card">
            <h2>4. Kamerapfad ({job.cameraKeyframes.length} Keyframes)</h2>
            <label className="field">
              Gesamtlänge (Frames)
              <SliderField
                value={durationInFrames}
                min={60}
                max={1800}
                step={1}
                decimals={0}
                onChange={(v) => setDurationInFrames(v)}
              />
            </label>
            <p className="hint">
              Winkel Y/X drehen die Kamera um den Blickpunkt auf der Wand — der Abstand (Pos Z)
              bleibt dabei gleich. Pos X/Y schieben den Blickpunkt. Nur Pos Z und FOV ändern den Zoom.
            </p>

            <CameraTimeline
              keyframes={job.cameraKeyframes}
              durationInFrames={durationInFrames}
              activeFrame={activeFrame}
              onScrub={scrubTo}
              onChange={(next) => setJob((p) => ({ ...p, cameraKeyframes: next }))}
            />

            <div className="row cam-timeline__actions">
              <button
                type="button"
                className="secondary"
                disabled={!!selectedKeyframe}
                onClick={() => {
                  const inserted = {
                    frame: activeFrame,
                    position: previewAxes.position,
                    rotation: previewAxes.rotation,
                    fov: previewAxes.fov,
                  };
                  setJob((p) => ({
                    ...p,
                    cameraKeyframes: [...p.cameraKeyframes, inserted].sort((a, b) => a.frame - b.frame),
                  }));
                }}
              >
                + Keyframe hier
              </button>
              <button
                type="button"
                className="danger"
                disabled={!selectedKeyframe || job.cameraKeyframes.length <= 2}
                onClick={() => {
                  const fallback = job.cameraKeyframes[Math.max(0, selectedKeyframeIndex - 1)]?.frame ?? 0;
                  setJob((p) => ({
                    ...p,
                    cameraKeyframes: p.cameraKeyframes.filter((_, idx) => idx !== selectedKeyframeIndex),
                  }));
                  scrubTo(fallback);
                }}
              >
                ✕ Keyframe löschen
              </button>
            </div>

            <div className="keyframe-editor">
              {selectedKeyframe ? (
                <h3>Keyframe — Frame {selectedKeyframe.frame}</h3>
              ) : (
                <h3>Frame {activeFrame} (kein Keyframe hier — Ändern legt automatisch einen an)</h3>
              )}
              <SliderField
                size="lg"
                label="Pos X (Schwenk horizontal)"
                value={selectedKeyframe ? selectedKeyframe.position[0] : previewAxes.position[0]}
                min={-2}
                max={2}
                step={0.05}
                onChange={(v) =>
                  applyCameraEdit({
                    position: [v, previewAxes.position[1], previewAxes.position[2]],
                  })
                }
              />
              <SliderField
                size="lg"
                label="Pos Y (Schwenk vertikal)"
                value={selectedKeyframe ? selectedKeyframe.position[1] : previewAxes.position[1]}
                min={-2}
                max={2}
                step={0.05}
                onChange={(v) =>
                  applyCameraEdit({
                    position: [previewAxes.position[0], v, previewAxes.position[2]],
                  })
                }
              />
              <SliderField
                size="lg"
                label="Pos Z (Abstand zur Wand)"
                value={selectedKeyframe ? selectedKeyframe.position[2] : previewAxes.position[2]}
                min={2}
                max={24}
                step={0.1}
                onChange={(v) =>
                  applyCameraEdit({
                    position: [previewAxes.position[0], previewAxes.position[1], v],
                  })
                }
              />
              <SliderField
                size="lg"
                label="Winkel Y (Gieren)"
                value={selectedKeyframe ? selectedKeyframe.rotation[0] : previewAxes.rotation[0]}
                min={-45}
                max={45}
                step={0.5}
                decimals={1}
                onChange={(v) => applyCameraEdit({ rotation: [v, previewAxes.rotation[1]] })}
              />
              <SliderField
                size="lg"
                label="Winkel X (Nicken)"
                value={selectedKeyframe ? selectedKeyframe.rotation[1] : previewAxes.rotation[1]}
                min={-15}
                max={15}
                step={0.5}
                decimals={1}
                onChange={(v) => applyCameraEdit({ rotation: [previewAxes.rotation[0], v] })}
              />
              <SliderField
                size="lg"
                label="FOV"
                value={selectedKeyframe ? selectedKeyframe.fov : previewAxes.fov}
                min={5}
                max={52}
                step={0.5}
                decimals={1}
                onChange={(v) => applyCameraEdit({ fov: v })}
              />
            </div>
          </section>

          <section className="card">
            <h2>5. Schlagschatten, Glanz &amp; Extrusion</h2>
            <p className="hint">
              Extrusion gilt für alle Wandbilder gleichzeitig. Spiegelung nutzt den aktuellen Raum als
              Environment (Fresnel) — am besten mit etwas Kamerawinkel sichtbar.
            </p>
            <label className="field">
              Extrusion / Tiefe (global)
              <SliderField
                value={job.extrusionDepth ?? 0}
                min={0}
                max={0.35}
                step={0.005}
                decimals={3}
                onChange={(v) => setJob((p) => ({ ...p, extrusionDepth: v }))}
              />
            </label>
            <label className="field">
              Versatz X
              <SliderField
                value={job.shadow.offsetX}
                min={-0.3}
                max={0.3}
                step={0.005}
                decimals={3}
                onChange={(v) => setJob((p) => ({ ...p, shadow: { ...p.shadow, offsetX: v } }))}
              />
            </label>
            <label className="field">
              Versatz Y
              <SliderField
                value={job.shadow.offsetY}
                min={-0.3}
                max={0.3}
                step={0.005}
                decimals={3}
                onChange={(v) => setJob((p) => ({ ...p, shadow: { ...p.shadow, offsetY: v } }))}
              />
            </label>
            <label className="field">
              Schatten-Stärke
              <SliderField
                value={job.shadow.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => setJob((p) => ({ ...p, shadow: { ...p.shadow, opacity: v } }))}
              />
            </label>
            <label className="field">
              Glanz-Stärke
              <SliderField
                value={job.gloss?.strength ?? 0.35}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) =>
                  setJob((p) => ({
                    ...p,
                    gloss: {
                      strength: v,
                      sharpness: p.gloss?.sharpness ?? 0.5,
                      reflectStrength: p.gloss?.reflectStrength ?? 0.2,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              Glanz-Schärfe
              <SliderField
                value={job.gloss?.sharpness ?? 0.5}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) =>
                  setJob((p) => ({
                    ...p,
                    gloss: {
                      strength: p.gloss?.strength ?? 0.35,
                      sharpness: v,
                      reflectStrength: p.gloss?.reflectStrength ?? 0.2,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              Spiegelung (Raum-Env)
              <SliderField
                value={job.gloss?.reflectStrength ?? 0.2}
                min={0}
                max={0.6}
                step={0.01}
                onChange={(v) =>
                  setJob((p) => ({
                    ...p,
                    gloss: {
                      strength: p.gloss?.strength ?? 0.35,
                      sharpness: p.gloss?.sharpness ?? 0.5,
                      reflectStrength: v,
                    },
                  }))
                }
              />
            </label>
          </section>
        </div>

        <div className="panel panel--preview">
          <section className="card">
            <h2>Live-Vorschau</h2>
            <p className="hint">Startet automatisch — Änderungen links wirken sofort.</p>
            <Player
              ref={playerRef}
              component={RoomFlythrough}
              inputProps={job}
              durationInFrames={durationInFrames}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: "100%" }}
              controls
              loop
              autoPlay
              acknowledgeRemotionLicense
            />
          </section>

          <section className="card">
            <h2>6. Rendern</h2>
            <label className="field">
              Dateiname
              <input type="text" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
            </label>
            <p className="hint">
              {server === null
                ? "Das Video wird direkt hier im Browser gerendert (am besten Chrome oder Edge). Tab bis zum Ende offen lassen."
                : "Das Video wird auf dem Server gerendert — danach Download."}
            </p>
            <button type="button" className="primary" onClick={() => void startRender()} disabled={renderState.status === "rendering"}>
              {renderState.status === "rendering"
                ? renderState.queuePosition
                  ? `In Warteschlange (Platz ${renderState.queuePosition})…`
                  : `Rendert… ${renderState.progress}%`
                : "Video rendern"}
            </button>
            {renderState.status === "rendering" && (
              <div className="progress">
                <div className="progress__bar" style={{ width: `${renderState.progress}%` }} />
              </div>
            )}
            {renderState.status === "done" && (
              <p className="success">
                Fertig
                {localVideo ? (
                  <>
                    {" — "}
                    <a href={localVideo.url} download={localVideo.filename}>
                      {localVideo.filename.endsWith(".mp4") ? "MP4" : "WebM"} herunterladen
                    </a>
                  </>
                ) : renderState.downloadUrl || renderJobId ? (
                  <>
                    {" — "}
                    <a href={apiUrl(renderState.downloadUrl ?? `/api/render/${renderJobId}/download`)} download>
                      MP4 herunterladen
                    </a>
                  </>
                ) : null}
              </p>
            )}
            {renderState.status === "error" && <p className="error">{renderState.error}</p>}
          </section>
        </div>
      </div>
    </div>
  );
};
