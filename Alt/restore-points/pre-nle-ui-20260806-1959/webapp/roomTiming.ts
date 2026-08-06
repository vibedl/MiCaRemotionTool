import type { RoomDef } from "../src/types";

export const MIN_ROOM_HOLD_SEC = 0.5;

export function framesToSec(frames: number, fps: number): number {
  return frames / fps;
}

export function secToFrames(sec: number, fps: number): number {
  return Math.max(1, Math.round(sec * fps));
}

export type RoomSegmentLayout = {
  index: number;
  startFrame: number;
  holdFrames: number;
  endFrame: number;
  startSec: number;
  holdSec: number;
  endSec: number;
};

/** Sequential layout of room holds on the video timeline (frame 0 = start). */
export function layoutRoomSegments(rooms: RoomDef[], fps: number): RoomSegmentLayout[] {
  let cursor = 0;
  return rooms.map((room, index) => {
    const startFrame = cursor;
    const holdFrames = room.holdFrames;
    const endFrame = startFrame + holdFrames;
    cursor = endFrame;
    return {
      index,
      startFrame,
      holdFrames,
      endFrame,
      startSec: framesToSec(startFrame, fps),
      holdSec: framesToSec(holdFrames, fps),
      endSec: framesToSec(endFrame, fps),
    };
  });
}

export function totalRoomFrames(rooms: RoomDef[]): number {
  return rooms.reduce((sum, r) => sum + r.holdFrames, 0);
}

export function frameAtRoomSegmentCenter(seg: { startFrame: number; holdFrames: number }): number {
  return seg.startFrame + Math.floor(seg.holdFrames / 2);
}
