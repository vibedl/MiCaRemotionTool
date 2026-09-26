import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RoomFlythroughProps } from "../src/RoomFlythrough";
import { autoBuildJob, DEFAULT_AUTO_OPTIONS, type AnalyzedImage } from "../src/autoBuild";
import { SliderField } from "./SliderField";
import { mediaUrl, uploadFile } from "./clientApi";
import { analyzeImageFile, type ImageInfo } from "./imageAnalysis";

type Kind = "room" | "picture";

type StagedImage = {
  id: string;
  kind: Kind;
  label: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  src?: string;
  info?: ImageInfo;
  error?: string;
};

export type AutoBuildResult = { job: RoomFlythroughProps; durationInFrames: number };

type Props = {
  fps: number;
  /** Look settings (shadow/gloss/extrusion) are kept from the current job. */
  base: Pick<RoomFlythroughProps, "shadow" | "gloss" | "extrusionDepth">;
  onBuild: (result: AutoBuildResult, options: { render: boolean }) => void;
  renderBusy: boolean;
};

const ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || IMAGE_FILE.test(f.name));
}

function labelOf(file: File) {
  return file.name.replace(/\.[^.]+$/, "");
}

let idCounter = 0;

export const AutoBuilder: React.FC<Props> = ({ fps, base, onBuild, renderBusy }) => {
  const [items, setItems] = useState<StagedImage[]>([]);
  const [secondsPerPicture, setSecondsPerPicture] = useState(DEFAULT_AUTO_OPTIONS.secondsPerPicture);
  const [morphSeconds, setMorphSeconds] = useState(DEFAULT_AUTO_OPTIONS.morphSeconds);
  const [roomCrossfadeSeconds, setRoomCrossfadeSeconds] = useState(DEFAULT_AUTO_OPTIONS.roomCrossfadeSeconds);
  const [autoApply, setAutoApply] = useState(true);
  const [dragTarget, setDragTarget] = useState<Kind | "any" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const baseRef = useRef(base);
  baseRef.current = base;
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;

  const rooms = items.filter((i) => i.kind === "room");
  const pictures = items.filter((i) => i.kind === "picture");
  const pending = items.some((i) => i.status === "uploading");

  /** `kind` = null → classify by transparency (cut-out PNG = wall picture, opaque photo = room). */
  const addFiles = useCallback((files: File[], kind: Kind | null) => {
    if (files.length === 0) return;
    setMessage(null);
    for (const file of files) {
      const id = `img-${++idCounter}`;
      const previewUrl = URL.createObjectURL(file);
      setItems((prev) => [
        ...prev,
        { id, kind: kind ?? "picture", label: labelOf(file), previewUrl, status: "uploading" },
      ]);
      void (async () => {
        try {
          const info = await analyzeImageFile(file);
          if (!kind) {
            const detected: Kind = info.hasTransparency ? "picture" : "room";
            setItems((prev) => prev.map((it) => (it.id === id ? { ...it, kind: detected } : it)));
          }
          const uploaded = await uploadFile(file);
          setItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, status: "ready", info, src: mediaUrl(uploaded.url) } : it)),
          );
        } catch (e) {
          setItems((prev) =>
            prev.map((it) =>
              it.id === id ? { ...it, status: "error", error: e instanceof Error ? e.message : String(e) } : it,
            ),
          );
        }
      })();
    }
  }, []);

  // Dropping anywhere on the page (outside the two zones) → automatic detection.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragTarget((t) => t ?? "any");
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragTarget(null);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragTarget(null);
      addFiles(imageFiles(e.dataTransfer.files), null);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  const build = useCallback(
    (render: boolean) => {
      const ready = (kind: Kind): AnalyzedImage[] =>
        items
          .filter((i) => i.kind === kind && i.status === "ready" && i.src && i.info)
          .map((i) => ({ label: i.label, src: i.src!, ...i.info! }));
      try {
        const result = autoBuildJob(ready("room"), ready("picture"), baseRef.current, {
          fps,
          secondsPerPicture,
          morphSeconds,
          roomCrossfadeSeconds,
          maxFrames: DEFAULT_AUTO_OPTIONS.maxFrames,
        });
        onBuildRef.current(result, { render });
        setMessage(
          `Animation gebaut: ${result.job.rooms.length} Raum/Räume, ${result.job.pictures.length} Wandbild(er), ` +
            `${(result.durationInFrames / fps).toFixed(1)} s.`,
        );
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [items, fps, secondsPerPicture, morphSeconds, roomCrossfadeSeconds],
  );

  const readyRooms = rooms.filter((i) => i.status === "ready").length;
  const readyPictures = pictures.filter((i) => i.status === "ready").length;
  const canBuild = readyRooms > 0 && readyPictures > 0 && !pending;

  // Rebuild the animation automatically whenever the input set or tempo changes.
  const buildKey = items.map((i) => `${i.id}:${i.kind}:${i.status}`).join("|");
  useEffect(() => {
    if (autoApply && canBuild) build(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey, autoApply, canBuild, secondsPerPicture, morphSeconds, roomCrossfadeSeconds]);

  const update = (id: string, patch: Partial<StagedImage> | null) =>
    setItems((prev) => {
      if (patch === null) {
        const gone = prev.find((i) => i.id === id);
        if (gone) URL.revokeObjectURL(gone.previewUrl);
        return prev.filter((i) => i.id !== id);
      }
      return prev.map((i) => (i.id === id ? { ...i, ...patch } : i));
    });

  const move = (id: string, direction: -1 | 1) =>
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      const kind = prev[idx]?.kind;
      let j = idx + direction;
      while (j >= 0 && j < prev.length && prev[j].kind !== kind) j += direction;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const zone = (kind: Kind, title: string, hint: string, list: StagedImage[]) => (
    <DropZone
      kind={kind}
      title={title}
      hint={hint}
      active={dragTarget === kind}
      onDragState={(state) => setDragTarget(state === null ? null : state ? kind : "any")}
      onFiles={(files) => addFiles(files, kind)}
    >
      {list.length > 0 && (
        <ul className="auto__items">
          {list.map((it, idx) => (
            <li key={it.id} className={`auto__item auto__item--${it.status}`} title={it.error ?? it.label}>
              <img src={it.previewUrl} alt={it.label} />
              <span className="auto__item-label">
                {idx + 1}. {it.label}
                {it.status === "uploading" && <em> lädt…</em>}
                {it.status === "error" && <em> Fehler: {it.error}</em>}
              </span>
              <span className="auto__item-actions">
                <button type="button" title="nach vorne" onClick={() => move(it.id, -1)}>
                  ↑
                </button>
                <button type="button" title="nach hinten" onClick={() => move(it.id, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  title={kind === "room" ? "ist ein Wandbild" : "ist ein Raum"}
                  onClick={() => update(it.id, { kind: kind === "room" ? "picture" : "room" })}
                >
                  ⇄
                </button>
                <button type="button" title="entfernen" onClick={() => update(it.id, null)}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DropZone>
  );

  return (
    <section className={`card auto${dragTarget === "any" ? " auto--drag" : ""}`}>
      <h2>Schnellstart: Bilder reinwerfen → Animation</h2>
      <p className="hint">
        Räume (Fotos) und Wandbilder (freigestellte PNGs) einfach hier oder irgendwo auf die Seite ziehen. Ohne
        Zielfeld wird automatisch erkannt: transparente PNGs = Wandbild, Fotos = Raum. Kamera, Timing und
        Größen werden automatisch berechnet — Feinschliff danach unten im Editor.
      </p>

      <div className="auto__zones">
        {zone("room", `Räume (${rooms.length})`, "Hintergrund-Fotos", rooms)}
        {zone("picture", `Wandbilder (${pictures.length})`, "Shapes / Motive, in Reihenfolge", pictures)}
      </div>

      <div className="auto__options">
        <label className="field">
          Sekunden pro Wandbild
          <SliderField value={secondsPerPicture} min={0.6} max={5} step={0.1} decimals={1} onChange={setSecondsPerPicture} />
        </label>
        <label className="field">
          Morph zwischen Wandbildern (s)
          <SliderField value={morphSeconds} min={0} max={1.5} step={0.05} decimals={2} onChange={setMorphSeconds} />
        </label>
        <label className="field">
          Überblendung zwischen Räumen (s)
          <SliderField
            value={roomCrossfadeSeconds}
            min={0}
            max={3}
            step={0.1}
            decimals={1}
            onChange={setRoomCrossfadeSeconds}
          />
        </label>
        <label className="auto__toggle">
          <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
          Bei jeder Änderung automatisch neu bauen
        </label>
      </div>

      <div className="row auto__actions">
        <button type="button" className="secondary" disabled={!canBuild} onClick={() => build(false)}>
          Animation bauen
        </button>
        <button type="button" className="primary" disabled={!canBuild || renderBusy} onClick={() => build(true)}>
          {renderBusy ? "Rendert…" : "Bauen & Video rendern"}
        </button>
        {items.length > 0 && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
              setItems([]);
              setMessage(null);
            }}
          >
            Leeren
          </button>
        )}
      </div>
      {!canBuild && items.length > 0 && !pending && (
        <p className="hint">Es braucht mindestens einen Raum und ein Wandbild.</p>
      )}
      {pending && <p className="hint">Bilder werden hochgeladen…</p>}
      {message && <p className={message.startsWith("Animation gebaut") ? "success" : "error"}>{message}</p>}
    </section>
  );
};

const DropZone: React.FC<{
  kind: Kind;
  title: string;
  hint: string;
  active: boolean;
  /** true = hovering this zone, false = left it, null = dropped. */
  onDragState: (state: boolean | null) => void;
  onFiles: (files: File[]) => void;
  children?: React.ReactNode;
}> = ({ kind, title, hint, active, onDragState, onFiles, children }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className={`auto__zone auto__zone--${kind}${active ? " is-active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragState(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragState(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragState(null);
        onFiles(imageFiles(e.dataTransfer.files));
      }}
    >
      <button type="button" className="auto__zone-head" onClick={() => inputRef.current?.click()}>
        <strong>{title}</strong>
        <span>{hint} — hierher ziehen oder klicken</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          onFiles(imageFiles(e.target.files));
          e.target.value = "";
        }}
      />
      {children}
    </div>
  );
};
