import React, { useCallback, useMemo, useRef } from "react";
import type { RoomDef } from "../src/types";
import {
  framesToSec,
  frameAtRoomSegmentCenter,
  layoutRoomSegments,
  MIN_ROOM_HOLD_SEC,
  secToFrames,
  totalRoomFrames,
} from "./roomTiming";

type EdgeDrag = { roomIndex: number };

/**
 * Video-style strip: each room is a block whose width = hold duration in seconds.
 * Drag the right edge of a block to trim/extend that room's hold (exactly as it
 * will play in the render). Crossfade overlaps are drawn between neighbours.
 */
export const RoomTimeline: React.FC<{
  rooms: RoomDef[];
  crossfadeFrames: number;
  durationInFrames: number;
  fps: number;
  selectedIndex: number | null;
  activeFrame: number;
  onSelect: (index: number) => void;
  onScrub: (frame: number) => void;
  onChange: (rooms: RoomDef[]) => void;
}> = ({
  rooms,
  crossfadeFrames,
  durationInFrames,
  fps,
  selectedIndex,
  activeFrame,
  onSelect,
  onScrub,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<EdgeDrag | null>(null);

  const durationSec = framesToSec(durationInFrames, fps);
  const crossfadeSec = framesToSec(crossfadeFrames, fps);
  const segments = useMemo(() => layoutRoomSegments(rooms, fps), [rooms, fps]);
  const roomTotalFrames = totalRoomFrames(rooms);
  const roomTotalSec = framesToSec(roomTotalFrames, fps);
  const minHoldFrames = secToFrames(MIN_ROOM_HOLD_SEC, fps);

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * durationInFrames);
    },
    [durationInFrames],
  );

  const updateHold = (roomIndex: number, endFrame: number) => {
    const seg = segments[roomIndex];
    const nextHold = Math.max(minHoldFrames, endFrame - seg.startFrame);
    onChange(rooms.map((r, i) => (i === roomIndex ? { ...r, holdFrames: nextHold } : r)));
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    onScrub(frameFromClientX(e.clientX));
  };

  const handleEdgePointerDown = (roomIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { roomIndex };
    onSelect(roomIndex);
  };

  const handleEdgePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const endFrame = frameFromClientX(e.clientX);
    updateHold(drag.roomIndex, endFrame);
    onScrub(Math.max(0, endFrame - 1));
  };

  const handleEdgePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="room-timeline">
      <div className="room-timeline__meta">
        <span>
          Räume gesamt: <strong>{roomTotalSec.toFixed(1)} s</strong>
        </span>
        <span>
          Videolänge: <strong>{durationSec.toFixed(1)} s</strong>
        </span>
        {roomTotalFrames > durationInFrames && (
          <span className="room-timeline__warn">Räume länger als Video — Ende wird abgeschnitten</span>
        )}
        {roomTotalFrames < durationInFrames && rooms.length > 0 && (
          <span className="room-timeline__hint">Rest = letzter Raum bleibt sichtbar</span>
        )}
      </div>

      <div className="room-timeline__track" ref={trackRef} onPointerDown={handleTrackPointerDown}>
        <div
          className="room-timeline__playhead"
          style={{ left: `${(activeFrame / durationInFrames) * 100}%` }}
        />

        {segments.map((seg) => {
          const left = (seg.startFrame / durationInFrames) * 100;
          const width = (seg.holdFrames / durationInFrames) * 100;
          const isSelected = selectedIndex === seg.index;
          const room = rooms[seg.index];
          const fadePct =
            crossfadeFrames > 0 && seg.index < rooms.length - 1
              ? Math.min(40, (crossfadeFrames / seg.holdFrames) * 100)
              : 0;

          return (
            <div
              key={`${room.src}-${seg.index}`}
              className={`room-timeline__seg${isSelected ? " is-selected" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(seg.index);
                onScrub(frameAtRoomSegmentCenter(seg));
              }}
              title={`${room.label}: ${seg.holdSec.toFixed(1)} s`}
            >
              <img src={room.src} alt="" className="room-timeline__thumb" draggable={false} />
              <span className="room-timeline__label">{room.label}</span>
              <span className="room-timeline__dur">{seg.holdSec.toFixed(1)} s</span>
              {fadePct > 0 && (
                <div className="room-timeline__fade" style={{ width: `${fadePct}%` }} title="Crossfade" />
              )}
              <div
                className="room-timeline__edge"
                onPointerDown={handleEdgePointerDown(seg.index)}
                onPointerMove={handleEdgePointerMove}
                onPointerUp={handleEdgePointerUp}
              />
            </div>
          );
        })}
      </div>

      <div className="room-timeline__ruler">
        <span>0 s</span>
        <span>{framesToSec(activeFrame, fps).toFixed(1)} s</span>
        <span>{durationSec.toFixed(1)} s</span>
      </div>

      <p className="hint">
        Block anklicken = Raum auswählen &amp; Vorschau springt in die Mitte. Rechten Rand ziehen =
        Hold-Zeit trimmen ({MIN_ROOM_HOLD_SEC}–{durationSec.toFixed(0)} s). Crossfade zwischen Blöcken:{" "}
        {crossfadeSec.toFixed(1)} s.
      </p>
    </div>
  );
};
