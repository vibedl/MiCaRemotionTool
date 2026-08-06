import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomFlythroughProps } from "../src/RoomFlythrough";

export type EditorSnapshot = {
  job: RoomFlythroughProps;
  durationInFrames: number;
};

const MAX_STACK = 60;
const COALESCE_MS = 400;

function cloneSnapshot(snap: EditorSnapshot): EditorSnapshot {
  return {
    job: structuredClone(snap.job),
    durationInFrames: snap.durationInFrames,
  };
}

/**
 * Undo/redo for job + duration. Rapid slider edits coalesce into one undo step
 * after COALESCE_MS idle. Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) work globally
 * unless the focus is in a text field.
 */
export function useEditorHistory(initial: EditorSnapshot) {
  const [job, setJobState] = useState(initial.job);
  const [durationInFrames, setDurationState] = useState(initial.durationInFrames);
  const [version, setVersion] = useState(0);

  const jobRef = useRef(job);
  const durationRef = useRef(durationInFrames);
  jobRef.current = job;
  durationRef.current = durationInFrames;

  const undoStack = useRef<EditorSnapshot[]>([]);
  const redoStack = useRef<EditorSnapshot[]>([]);
  const applying = useRef(false);
  const coalesceBase = useRef<EditorSnapshot | null>(null);
  const coalesceTimer = useRef<number | null>(null);

  const flushCoalesce = useCallback(() => {
    if (coalesceTimer.current) {
      window.clearTimeout(coalesceTimer.current);
      coalesceTimer.current = null;
    }
    if (coalesceBase.current) {
      undoStack.current.push(coalesceBase.current);
      if (undoStack.current.length > MAX_STACK) undoStack.current.shift();
      redoStack.current = [];
      coalesceBase.current = null;
      setVersion((v) => v + 1);
    }
  }, []);

  const schedulePush = useCallback(
    (before: EditorSnapshot) => {
      if (applying.current) return;
      if (!coalesceBase.current) {
        coalesceBase.current = cloneSnapshot(before);
        setVersion((v) => v + 1);
      }
      if (coalesceTimer.current) window.clearTimeout(coalesceTimer.current);
      coalesceTimer.current = window.setTimeout(() => {
        flushCoalesce();
      }, COALESCE_MS);
    },
    [flushCoalesce],
  );

  const setJob = useCallback(
    (updater: RoomFlythroughProps | ((prev: RoomFlythroughProps) => RoomFlythroughProps)) => {
      setJobState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next === prev) return prev;
        schedulePush({ job: prev, durationInFrames: durationRef.current });
        return next;
      });
    },
    [schedulePush],
  );

  const setDurationInFrames = useCallback(
    (updater: number | ((prev: number) => number)) => {
      setDurationState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (next === prev) return prev;
        schedulePush({ job: jobRef.current, durationInFrames: prev });
        return next;
      });
    },
    [schedulePush],
  );

  /** Replace state without recording history (load project / undo apply). */
  const replaceState = useCallback((snap: EditorSnapshot) => {
    if (coalesceTimer.current) {
      window.clearTimeout(coalesceTimer.current);
      coalesceTimer.current = null;
    }
    coalesceBase.current = null;
    applying.current = true;
    setJobState(snap.job);
    setDurationState(snap.durationInFrames);
    queueMicrotask(() => {
      applying.current = false;
    });
  }, []);

  const resetHistory = useCallback((snap: EditorSnapshot) => {
    undoStack.current = [];
    redoStack.current = [];
    replaceState(snap);
    setVersion((v) => v + 1);
  }, [replaceState]);

  const undo = useCallback(() => {
    flushCoalesce();
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(cloneSnapshot({ job: jobRef.current, durationInFrames: durationRef.current }));
    replaceState(prev);
    setVersion((v) => v + 1);
  }, [flushCoalesce, replaceState]);

  const redo = useCallback(() => {
    flushCoalesce();
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(cloneSnapshot({ job: jobRef.current, durationInFrames: durationRef.current }));
    replaceState(next);
    setVersion((v) => v + 1);
  }, [flushCoalesce, replaceState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "textarea" || target?.isContentEditable) return;
      if (tag === "input") {
        const type = (target as HTMLInputElement).type?.toLowerCase() ?? "text";
        // Native undo for text typing; range/checkbox keep editor undo
        if (type === "text" || type === "search" || type === "email" || type === "password" || type === "number" || type === "url") {
          return;
        }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    job,
    setJob,
    durationInFrames,
    setDurationInFrames,
    undo,
    redo,
    canUndo: undoStack.current.length > 0 || coalesceBase.current !== null,
    canRedo: redoStack.current.length > 0,
    resetHistory,
    historyVersion: version,
  };
}
