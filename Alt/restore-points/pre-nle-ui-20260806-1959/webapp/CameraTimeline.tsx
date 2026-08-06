import React, { useCallback, useRef } from "react";
import type { CameraKeyframe } from "../src/types";

type DragState = { index: number; minFrame: number; maxFrame: number };

/**
 * A horizontal timeline: one diamond marker per camera keyframe, positioned
 * by frame. Click a marker to select it (its values show in the editor
 * panel below), drag a marker to move it in time, click empty rail to move
 * the scrub cursor (used as the insertion point for "+ Keyframe"). Markers
 * are clamped so they can never cross a neighbor — that keeps
 * `keyframes` always sorted by `frame`, which `interpolate()` requires.
 */
export const CameraTimeline: React.FC<{
  keyframes: CameraKeyframe[];
  durationInFrames: number;
  activeFrame: number;
  onScrub: (frame: number) => void;
  onChange: (keyframes: CameraKeyframe[]) => void;
}> = ({ keyframes, durationInFrames, activeFrame, onScrub, onChange }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * durationInFrames);
    },
    [durationInFrames],
  );

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    onScrub(frameFromClientX(e.clientX));
  };

  const handleMarkerPointerDown = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      index,
      minFrame: (keyframes[index - 1]?.frame ?? -1) + 1,
      maxFrame: (keyframes[index + 1]?.frame ?? durationInFrames + 1) - 1,
    };
    onScrub(keyframes[index].frame);
  };

  const handleMarkerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const raw = frameFromClientX(e.clientX);
    const clamped = Math.min(drag.maxFrame, Math.max(drag.minFrame, raw));
    onChange(keyframes.map((k, i) => (i === drag.index ? { ...k, frame: clamped } : k)));
    onScrub(clamped);
  };

  const handleMarkerPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="cam-timeline">
      <div className="cam-timeline__track" ref={trackRef} onPointerDown={handleTrackPointerDown}>
        <div
          className="cam-timeline__playhead"
          style={{ left: `${(activeFrame / durationInFrames) * 100}%` }}
        />
        {keyframes.map((kf, i) => {
          const isSelected = kf.frame === activeFrame;
          return (
            <div
              key={i}
              className={`cam-timeline__marker${isSelected ? " is-selected" : ""}`}
              style={{ left: `${(kf.frame / durationInFrames) * 100}%` }}
              onPointerDown={handleMarkerPointerDown(i)}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={handleMarkerPointerUp}
              title={`Frame ${kf.frame}`}
            />
          );
        })}
      </div>
      <div className="cam-timeline__ruler">
        <span>0</span>
        <span>Frame {activeFrame}</span>
        <span>{durationInFrames}</span>
      </div>
    </div>
  );
};
