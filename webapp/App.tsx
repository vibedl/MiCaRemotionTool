import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, PlayerRef } from "@remotion/player";
import { resolveCameraAxes, RoomFlythrough, RoomFlythroughProps } from "../src/RoomFlythrough";
import { emptyStudioJob } from "../src/Root";
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
  clearAutosave,
  readAutosave,
  readJobFromFile,
  saveJobLocally,
  writeAutosave,
} from "./jobStorage";
import { apiUrl, mediaUrl } from "./clientApi";
import { useEditorHistory } from "./useEditorHistory";

type ScannedItem = {
  label: string;
  filename: string;
  url: string;
  suggestedType: "room" | "picture" | "reflection";
};

type RenderStatus = {
  status: "idle" | "bundling" | "rendering" | "done" | "error";
  progress: number;
  phase?: string;
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

type MediaTab = "shapes" | "rooms" | "project";
type InspectorTab = "selection" | "camera" | "look";

function formatTimecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.floor(frame));
  const ff = f % fps;
  const totalSec = Math.floor(f / fps);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

async function uploadFile(file: File): Promise<{ label: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl("/api/upload"), { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload fehlgeschlagen");
  return data;
}

const FilePickerButton: React.FC<{
  label: string;
  multiple?: boolean;
  accept?: string;
  className?: string;
  onFiles: (files: File[]) => void;
}> = ({ label, multiple, accept = "image/*", className = "tb-btn", onFiles }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => inputRef.current?.click()}>
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
  } = useEditorHistory({ job: emptyStudioJob, durationInFrames: DURATION_IN_FRAMES });

  const [activeFrame, setActiveFrame] = useState(job.cameraKeyframes[0]?.frame ?? 0);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState<number | null>(0);
  const [sizeTarget, setSizeTarget] = useState<SizeTarget>({ kind: "room", index: 0 });
  const [mediaTab, setMediaTab] = useState<MediaTab>("shapes");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("selection");
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<PlayerRef>(null);

  const scrubTo = useCallback((frame: number) => {
    setActiveFrame(frame);
    setPlaying(false);
    playerRef.current?.pause();
    playerRef.current?.seekTo(frame);
  }, []);

  const togglePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
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
      const resolvedJob: RoomFlythroughProps = {
        ...loaded.job,
        pictures: (loaded.job.pictures ?? []).map((p) => ({ ...p, src: mediaUrl(p.src) })),
        rooms: (loaded.job.rooms ?? []).map((r) => ({ ...r, src: mediaUrl(r.src) })),
      };
      resetHistory({
        job: resolvedJob,
        durationInFrames: loaded.durationInFrames ?? DURATION_IN_FRAMES,
      });
      if (loaded.outputName) setOutputName(loaded.outputName);
      if (loaded.name) setJobName(loaded.name);
      if (loaded.sourceFolder) setFolder(loaded.sourceFolder);
      if (loaded.path) setCurrentJobPath(loaded.path);
      setActiveFrame(resolvedJob.cameraKeyframes[0]?.frame ?? 0);
      setSelectedRoomIndex(0);
      setSizeTarget({ kind: "room", index: 0 });
      setDirty(false);
    },
    [resetHistory],
  );

  const refreshServerJobs = useCallback(async () => {
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
      const portable = buildPortableJob({ folder, jobName, durationInFrames, outputName, job });
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
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const jobFromPrep = (params.get("job") || "").trim();

    // Drop demo autosaves so old bundled assets never reappear.
    const saved = readAutosave();
    const looksLikeDemo =
      !!saved?.job &&
      [...(saved.job.pictures ?? []), ...(saved.job.rooms ?? [])].some((item) => {
        const s = item.src || "";
        return s.includes("/assets/") || s.startsWith("asset:") || /Herz|Oval|BG\.png/i.test(s);
      });
    if (looksLikeDemo || !saved?.job) {
      clearAutosave();
    }

    skipAutosave.current = true;

    (async () => {
      try {
        if (jobFromPrep) {
          clearAutosave();
          const res = await fetch(apiUrl(`/api/job?name=${encodeURIComponent(jobFromPrep)}`));
          const data = await res.json();
          if (!cancelled && res.ok) {
            applyLoadedProject({
              job: data.job,
              durationInFrames: data.durationInFrames,
              outputName: data.outputName,
              name: data.name,
              sourceFolder: data.sourceFolder,
              path: data.path,
            });
            setLastSavedAt(data.file?.updatedAt ?? null);
            setSaveMessage(`Job von Prep geladen: ${data.name}`);
            window.history.replaceState({}, "", window.location.pathname);
          } else if (!cancelled) {
            setSaveMessage(data.error ?? `Job „${jobFromPrep}“ nicht gefunden.`);
          }
        } else if (saved?.job && !looksLikeDemo) {
          if (!cancelled) {
            applyLoadedProject(saved);
            setLastSavedAt(saved.savedAt ?? null);
          }
        }
      } finally {
        if (!cancelled) skipAutosave.current = false;
      }
      if (!cancelled) void refreshServerJobs();
    })();

    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? FPS : 1;
        const delta = e.key === "ArrowLeft" ? -step : step;
        const next = Math.max(0, Math.min(durationInFrames - 1, activeFrame + delta));
        scrubTo(next);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFrame, durationInFrames, scrubTo, togglePlayPause]);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | undefined;

    const attach = () => {
      const player = playerRef.current;
      if (!player || cancelled) return false;

      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      const onFrame = (e: { detail: { frame: number } }) => setActiveFrame(e.detail.frame);

      player.addEventListener("play", onPlay);
      player.addEventListener("pause", onPause);
      player.addEventListener("frameupdate", onFrame);
      detach = () => {
        player.removeEventListener("play", onPlay);
        player.removeEventListener("pause", onPause);
        player.removeEventListener("frameupdate", onFrame);
      };
      return true;
    };

    if (attach()) {
      return () => {
        cancelled = true;
        detach?.();
      };
    }

    const id = window.setInterval(() => {
      if (attach()) window.clearInterval(id);
    }, 50);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      detach?.();
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
        setMediaTab("shapes");
        setInspectorTab("selection");
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
        setMediaTab("rooms");
        setInspectorTab("selection");
      }
    },
    [durationInFrames, job.pictures.length, job.rooms.length, setJob],
  );

  const startRender = useCallback(async () => {
    try {
      setRenderState({ status: "bundling", progress: 0, phase: "Render wird gestartet…" });
      setRenderJobId(null);
      setSaveMessage("Kein Speicherdialog — nach Fertigstellung startet der Download.");

      const res = await fetch(apiUrl("/api/render"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...job, durationInFrames, outputName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render fehlgeschlagen");
      const jobId = data.jobId as string;
      setRenderJobId(jobId);

      pollRef.current = window.setInterval(async () => {
        const statusRes = await fetch(apiUrl(`/api/render/${jobId}`));
        const statusData = (await statusRes.json()) as RenderStatus;
        setRenderState(statusData);
        if (statusData.status === "done" || statusData.status === "error") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          if (statusData.status === "done" && (statusData.downloadUrl || jobId)) {
            const href = apiUrl(statusData.downloadUrl ?? `/api/render/${jobId}/download`);
            const a = document.createElement("a");
            a.href = href;
            a.download = outputName.endsWith(".mp4") ? outputName : `${outputName || "room-flythrough"}.mp4`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setSaveMessage("Render fertig — Download gestartet.");
          }
        }
      }, 800);
    } catch (e) {
      setRenderState({ status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }, [job, durationInFrames, outputName]);

  const renderBusy = renderState.status === "bundling" || renderState.status === "rendering";
  const renderLabel =
    renderState.status === "bundling"
      ? `Vorbereiten… ${renderState.progress}%`
      : renderState.status === "rendering"
        ? `Rendert… ${renderState.progress}%`
        : "Render";

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
    setInspectorTab("selection");
    const holds = distributePictureHolds(durationInFrames, job.pictures.length, job.transitionFrames);
    const mid = pictureHoldMidFrame(index, holds, job.transitionFrames);
    scrubTo(Math.max(0, Math.min(mid, durationInFrames - 1)));
  };

  const selectRoom = (index: number) => {
    setSelectedRoomIndex(index);
    setSizeTarget({ kind: "room", index });
    setInspectorTab("selection");
    const segs = layoutRoomSegments(job.rooms, FPS);
    const seg = segs[index];
    if (seg) scrubTo(Math.max(0, Math.min(frameAtRoomSegmentCenter(seg), durationInFrames - 1)));
  };

  const saveHintClass =
    saveMessage &&
    (saveMessage.includes("gespeichert") ||
    saveMessage.includes("geladen") ||
    saveMessage.includes("gefunden") ||
    saveMessage.includes("Download gestartet")
      ? "success"
      : saveMessage.includes("abgebrochen") || saveMessage.includes("Kein Speicherdialog")
        ? "hint"
        : "error");

  return (
    <div className="studio">
      <header className="studio__toolbar">
        <div className="studio__brand">
          <span className="studio__logo">RF</span>
          <span className="studio__title">Room Flythrough</span>
        </div>

        <label className="toolbar-job">
          <span className="toolbar-job__label">Job</span>
          <input type="text" value={jobName} onChange={(e) => setJobName(e.target.value)} />
        </label>

        <span className={`toolbar-dirty${dirty ? " is-dirty" : ""}`} title={lastSavedAt ? `Zuletzt: ${new Date(lastSavedAt).toLocaleString()}` : undefined}>
          {dirty ? "● ungespeichert" : "● gespeichert"}
        </span>

        <div className="toolbar-group">
          <button type="button" className="tb-btn" onClick={undo} disabled={!canUndo} title="Strg+Z">
            Undo
          </button>
          <button type="button" className="tb-btn" onClick={redo} disabled={!canRedo} title="Strg+Y">
            Redo
          </button>
        </div>

        <div className="toolbar-group">
          <button type="button" className="tb-btn" onClick={saveToServer}>
            Speichern Server
          </button>
          <button type="button" className="tb-btn" onClick={saveLocal}>
            Speichern lokal
          </button>
          <FilePickerButton label="Laden…" accept=".json,application/json" onFiles={loadLocalFiles} />
        </div>

        <div className="toolbar-group toolbar-group--render">
          <input
            className="toolbar-output"
            type="text"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            title="Render-Dateiname"
            placeholder="Dateiname"
          />
          <button
            type="button"
            className="tb-btn tb-btn--primary"
            onClick={startRender}
            disabled={renderBusy}
            title="Rendert nach out/ und startet danach den Download — kein OS-Speicherdialog"
          >
            {renderBusy ? renderLabel : "Render"}
          </button>
        </div>

        {saveMessage && <span className={`toolbar-toast ${saveHintClass ?? "hint"}`}>{saveMessage}</span>}
        {renderBusy && renderState.phase && (
          <span className="toolbar-toast hint">{renderState.phase}</span>
        )}
        {renderState.status === "done" && (renderState.downloadUrl || renderJobId) && (
          <a
            className="toolbar-toast success"
            href={apiUrl(renderState.downloadUrl ?? `/api/render/${renderJobId}/download`)}
            download
          >
            MP4 herunterladen
          </a>
        )}
        {renderState.status === "error" && <span className="toolbar-toast error">{renderState.error}</span>}
      </header>

      <div className="studio__main">
        {/* —— Media bin —— */}
        <aside className="studio__media">
          <div className="bin-tabs">
            <button
              type="button"
              className={`bin-tab${mediaTab === "shapes" ? " is-active" : ""}`}
              onClick={() => setMediaTab("shapes")}
            >
              Shapes
            </button>
            <button
              type="button"
              className={`bin-tab${mediaTab === "rooms" ? " is-active" : ""}`}
              onClick={() => setMediaTab("rooms")}
            >
              Rooms
            </button>
            <button
              type="button"
              className={`bin-tab${mediaTab === "project" ? " is-active" : ""}`}
              onClick={() => setMediaTab("project")}
            >
              Project
            </button>
          </div>

          {mediaTab === "shapes" && (
            <div className="bin-panel">
              <div className="bin-panel__head">
                <span>Bilder / Shapes ({job.pictures.length})</span>
              </div>
              <ul className="list">
                {job.pictures.map((pic, i) => (
                  <li
                    key={`${pic.src}-${i}`}
                    className={sizeTarget.kind === "picture" && sizeTarget.index === i ? "is-selected" : ""}
                    onClick={() => selectPicture(i)}
                  >
                    <img src={mediaUrl(pic.src)} alt={pic.label} className="thumb" />
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
                            setSizeTarget({
                              kind: "room",
                              index: Math.min(selectedRoomIndex ?? 0, Math.max(0, job.rooms.length - 1)),
                            });
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
                className="tb-btn bin-add"
                multiple
                onFiles={async (files) => {
                  const uploaded = await Promise.all(files.map(uploadFile));
                  setJob((p) => {
                    const start = p.pictures.length;
                    const next: PictureDef[] = [
                      ...p.pictures,
                      ...uploaded.map((u) => ({
                        label: u.label,
                        src: mediaUrl(u.url),
                        scaleX: 1,
                        scaleY: 1,
                        aspectLock: true,
                        offsetX: 0,
                        offsetY: 0,
                      })),
                    ];
                    setSizeTarget({ kind: "picture", index: start });
                    setInspectorTab("selection");
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
            </div>
          )}

          {mediaTab === "rooms" && (
            <div className="bin-panel">
              <div className="bin-panel__head">
                <span>Räume ({job.rooms.length})</span>
              </div>
              <p className="hint">Zeitleiste unten: rechten Rand ziehen = Hold. Klick = auswählen.</p>
              <ul className="list list--compact">
                {job.rooms.map((room, i) => (
                  <li
                    key={`${room.src}-${i}`}
                    className={sizeTarget.kind === "room" && sizeTarget.index === i ? "is-selected" : ""}
                    onClick={() => selectRoom(i)}
                  >
                    <img src={mediaUrl(room.src)} alt={room.label} className="thumb" />
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
                className="tb-btn bin-add"
                multiple
                onFiles={async (files) => {
                  const uploaded = await Promise.all(files.map(uploadFile));
                  setJob((p) => {
                    const start = p.rooms.length;
                    const perRoom = Math.floor(durationInFrames / (p.rooms.length + uploaded.length));
                    const next: RoomDef[] = [
                      ...p.rooms,
                      ...uploaded.map((u) => ({
                        label: u.label,
                        src: mediaUrl(u.url),
                        holdFrames: perRoom,
                        scaleX: 1,
                        scaleY: 1,
                        aspectLock: true,
                      })),
                    ];
                    setSelectedRoomIndex(start);
                    setSizeTarget({ kind: "room", index: start });
                    setInspectorTab("selection");
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
            </div>
          )}

          {mediaTab === "project" && (
            <div className="bin-panel">
              <div className="bin-panel__head">
                <span>Projekt</span>
              </div>
              {currentJobPath && (
                <p className="hint">
                  Server-Datei: <code>{currentJobPath}</code>
                </p>
              )}
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
              <button type="button" className="tb-btn bin-add" onClick={() => void refreshServerJobs()}>
                Server-Liste aktualisieren
              </button>

              <h3 className="card__sub">Ordner scannen</h3>
              <div className="row">
                <input
                  type="text"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Absoluter Pfad auf dem Server"
                />
                <button type="button" className="tb-btn" onClick={scanFolder} disabled={scanning || !folder.trim()}>
                  {scanning ? "…" : "Scan"}
                </button>
              </div>
              {scanError && <p className="error">{scanError}</p>}
              <p className="hint">
                Jedes Bild erscheint in der Liste und wird erst durch „als Raum“ / „als Bild“ hinzugefügt.
              </p>
              {scanItems.length > 0 && (
                <ul className="list list--compact">
                  {scanItems.map((item) => (
                    <li key={item.filename}>
                      <img src={mediaUrl(item.url)} alt={item.label} className="thumb" />
                      <span className="label">
                        {item.label}
                        <span className="list__meta"> {item.suggestedType}</span>
                      </span>
                      <div className="list__actions">
                        <button type="button" onClick={() => addScanItemAs(item, "room")}>
                          Raum
                        </button>
                        <button type="button" onClick={() => addScanItemAs(item, "picture")}>
                          Bild
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>

        {/* —— Viewer —— */}
        <section className="studio__viewer">
          <div className="viewer-stage">
            <Player
              ref={playerRef}
              component={RoomFlythrough}
              inputProps={job}
              durationInFrames={durationInFrames}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: "100%", height: "100%" }}
              controls={false}
              loop
              acknowledgeRemotionLicense
            />
          </div>
          <div className="transport">
            <button type="button" className="tb-btn tb-btn--transport" onClick={togglePlayPause}>
              {playing ? "Pause" : "Play"}
            </button>
            <span className="tc">{formatTimecode(activeFrame, FPS)}</span>
            <span className="transport__meta">
              Frame {activeFrame} / {durationInFrames - 1}
            </span>
            <span className="transport__meta tc">
              {formatTimecode(0, FPS)} – {formatTimecode(durationInFrames - 1, FPS)}
            </span>
            {renderBusy && (
              <div className="progress transport__progress" title={renderState.phase}>
                <div className="progress__bar" style={{ width: `${renderState.progress}%` }} />
              </div>
            )}
          </div>
        </section>

        {/* —— Inspector —— */}
        <aside className="studio__inspector">
          <div className="inspector-tabs">
            <button
              type="button"
              className={`bin-tab${inspectorTab === "selection" ? " is-active" : ""}`}
              onClick={() => setInspectorTab("selection")}
            >
              Selection
            </button>
            <button
              type="button"
              className={`bin-tab${inspectorTab === "camera" ? " is-active" : ""}`}
              onClick={() => setInspectorTab("camera")}
            >
              Camera
            </button>
            <button
              type="button"
              className={`bin-tab${inspectorTab === "look" ? " is-active" : ""}`}
              onClick={() => setInspectorTab("look")}
            >
              Look
            </button>
          </div>

          {inspectorTab === "selection" && (
            <div className="bin-panel">
              <p className="hint">Bild oder Raum anklicken — Vorschau springt dorthin.</p>
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
                  {sizeTarget.kind === "room" && selectedRoomIndex !== null && job.rooms[selectedRoomIndex] && (
                    <div className="keyframe-editor">
                      <h3>Hold — {job.rooms[selectedRoomIndex].label}</h3>
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
                </>
              ) : (
                <p className="hint">
                  Leeres Projekt — über Prep einen Job erzeugen oder hier Medien hochladen / vom Server laden.
                </p>
              )}
            </div>
          )}

          {inspectorTab === "camera" && (
            <div className="bin-panel">
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
                Winkel Y/X drehen um den Blickpunkt — Abstand (Pos Z) bleibt. Nur Pos Z und FOV ändern den Zoom.
              </p>
              <div className="row cam-timeline__actions">
                <button
                  type="button"
                  className="tb-btn"
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
                  + Keyframe
                </button>
                <button
                  type="button"
                  className="tb-btn danger"
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
                  ✕ Löschen
                </button>
              </div>
              <div className="keyframe-editor">
                {selectedKeyframe ? (
                  <h3>Keyframe — Frame {selectedKeyframe.frame}</h3>
                ) : (
                  <h3>Frame {activeFrame} (Ändern legt Keyframe an)</h3>
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
                  max={30}
                  step={0.5}
                  decimals={1}
                  onChange={(v) => applyCameraEdit({ fov: v })}
                />
              </div>
            </div>
          )}

          {inspectorTab === "look" && (
            <div className="bin-panel">
              <p className="hint">
                Extrusion für alle Wandbilder. Spiegelung nutzt den Raum als Environment (Fresnel).
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

              <div className="inspector-render">
                <label className="field">
                  Render-Dateiname
                  <input type="text" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="tb-btn tb-btn--primary"
                  onClick={startRender}
                  disabled={renderBusy}
                  title="Rendert nach out/ und startet danach den Download — kein OS-Speicherdialog"
                >
                  {renderBusy ? renderLabel : "Video rendern"}
                </button>
                <p className="hint" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem", opacity: 0.75 }}>
                  Kein Speichern-Dialog — fertiges MP4 wird heruntergeladen.
                </p>
                {renderBusy && (
                  <>
                    {renderState.phase && <p className="hint">{renderState.phase}</p>}
                    <div className="progress">
                      <div className="progress__bar" style={{ width: `${renderState.progress}%` }} />
                    </div>
                  </>
                )}
                {renderState.status === "done" && (
                  <p className="success">
                    Fertig
                    {renderState.downloadUrl || renderJobId ? (
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
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* —— Timeline dock —— */}
      <footer className="studio__timeline">
        <div className="tl-track">
          <div className="tl-track__label">Rooms</div>
          <div className="tl-track__body">
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
          </div>
        </div>
        <div className="tl-track">
          <div className="tl-track__label">Camera</div>
          <div className="tl-track__body">
            <CameraTimeline
              keyframes={job.cameraKeyframes}
              durationInFrames={durationInFrames}
              activeFrame={activeFrame}
              onScrub={scrubTo}
              onChange={(next) => setJob((p) => ({ ...p, cameraKeyframes: next }))}
            />
          </div>
        </div>
      </footer>
    </div>
  );
};
