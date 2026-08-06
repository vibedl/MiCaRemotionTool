/**
 * Timing helpers ported from the DaVinci/Fusion automation logic
 * (src-tauri/resources/mcp/app/src/utils/animation_builder.py):
 *
 * - Pictures on the wall are held, then morph (crossfade) into the next one.
 *   Hold length = floor((totalFrames - (N-1) * transitionFrames) / N),
 *   remainder absorbed by the LAST hold.
 * - Rooms crossfade independently, each with its own hold length, using a
 *   separate (usually shorter) crossfade window centered on the boundary.
 *
 * Both are frame-integer, so the sum of all segments always equals the
 * total duration exactly (no drift/rounding gaps).
 */

export type CrossfadeSegment = {
  fromIndex: number;
  toIndex: number;
  /** 0 while holding on `fromIndex`, 1 once fully crossfaded to `toIndex`. */
  mix: number;
};

/**
 * Distributes `count` even holds across `totalFrames`, separated by
 * `transitionFrames` morph windows. Mirrors `_distribute_holds` from
 * animation_builder.py: the remainder of the integer division is absorbed
 * by the last hold so the total always adds up exactly.
 */
export function distributePictureHolds(
  totalFrames: number,
  count: number,
  transitionFrames: number,
): number[] {
  const n = Math.max(1, count);
  const usableFrames = Math.max(n, totalFrames - (n - 1) * transitionFrames);
  const base = Math.floor(usableFrames / n);
  const holds = new Array(n).fill(base);
  const remainder = usableFrames - base * n;
  holds[n - 1] += remainder;
  return holds;
}

/** Start frame of picture `index`'s hold (after prior holds + morphs). */
export function pictureHoldStartFrame(
  index: number,
  holds: number[],
  transitionFrames: number,
): number {
  let cursor = 0;
  const n = Math.min(index, holds.length);
  for (let i = 0; i < n; i++) {
    cursor += holds[i];
    if (i < holds.length - 1) cursor += transitionFrames;
  }
  return cursor;
}

/** Mid-hold frame — good scrub target when selecting a picture in the UI. */
export function pictureHoldMidFrame(
  index: number,
  holds: number[],
  transitionFrames: number,
): number {
  const start = pictureHoldStartFrame(index, holds, transitionFrames);
  const hold = holds[index] ?? 1;
  return start + Math.floor(hold / 2);
}

/** Resolves which two pictures are active at `frame` and the crossfade mix (0..1). */
export function pictureStateAtFrame(
  frame: number,
  holds: number[],
  transitionFrames: number,
): CrossfadeSegment {
  let cursor = 0;
  for (let i = 0; i < holds.length; i++) {
    const holdEnd = cursor + holds[i];
    if (frame < holdEnd || i === holds.length - 1) {
      return { fromIndex: i, toIndex: i, mix: 0 };
    }
    cursor = holdEnd;
    const transitionEnd = cursor + transitionFrames;
    if (frame < transitionEnd) {
      const mix = transitionFrames > 0 ? (frame - cursor) / transitionFrames : 1;
      return { fromIndex: i, toIndex: i + 1, mix };
    }
    cursor = transitionEnd;
  }
  const last = holds.length - 1;
  return { fromIndex: last, toIndex: last, mix: 0 };
}

export type RoomItem = { holdFrames: number };

/**
 * Resolves the active room crossfade at `frame`. Each room keeps its own
 * `holdFrames` (rooms don't have to be evenly sized, matching the
 * multi-room UI feature), and a shared `crossfadeFrames` window is centered
 * on each room boundary (half eaten from the end of the previous hold, half
 * from the start of the next), same as `_bake_scene_node_as_crossfade`.
 */
export function roomStateAtFrame(
  frame: number,
  rooms: RoomItem[],
  crossfadeFrames: number,
): CrossfadeSegment {
  if (rooms.length <= 1) {
    return { fromIndex: 0, toIndex: 0, mix: 0 };
  }
  const half = Math.floor(crossfadeFrames / 2);
  let cursor = 0;
  for (let i = 0; i < rooms.length; i++) {
    const holdEnd = cursor + rooms[i].holdFrames;
    const isLast = i === rooms.length - 1;
    const fadeStart = isLast ? holdEnd : holdEnd - half;
    const fadeEnd = isLast ? holdEnd : holdEnd + (crossfadeFrames - half);
    if (frame < fadeStart || isLast) {
      return { fromIndex: i, toIndex: i, mix: 0 };
    }
    if (frame < fadeEnd) {
      const mix = crossfadeFrames > 0 ? (frame - fadeStart) / crossfadeFrames : 1;
      return { fromIndex: i, toIndex: i + 1, mix: Math.min(1, Math.max(0, mix)) };
    }
    cursor = holdEnd;
  }
  const last = rooms.length - 1;
  return { fromIndex: last, toIndex: last, mix: 0 };
}
