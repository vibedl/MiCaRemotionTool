/**
 * Automatic job builder: turns a list of rooms (opaque photos) and wall
 * pictures (shape-masked PNGs or plain artwork) into a complete
 * RoomFlythroughProps — durations, room holds, sizes and a camera path —
 * so dropping images in is enough to get a finished animation.
 *
 * Pure function (no DOM), shared by the Studio webapp.
 */
import type { RoomFlythroughProps } from "./RoomFlythrough";
import { distributePictureHolds, pictureHoldStartFrame } from "./timing";
import { buildBallhausPath, type Rect } from "./cameraPath";
import type { PictureDef, RoomDef } from "./types";

/** Normalized (0..1, origin top-left) bounding box of the visible pixels. */
export type AlphaBounds = { x0: number; y0: number; x1: number; y1: number };

export type AnalyzedImage = {
  label: string;
  src: string;
  width: number;
  height: number;
  hasTransparency: boolean;
  /** Only set for images with transparency. */
  bounds?: AlphaBounds;
};

export type AutoBuildOptions = {
  fps: number;
  secondsPerPicture: number;
  morphSeconds: number;
  roomCrossfadeSeconds: number;
  /** Upper bound for the whole video (frames). */
  maxFrames: number;
};

export const DEFAULT_AUTO_OPTIONS: Omit<AutoBuildOptions, "fps"> = {
  secondsPerPicture: 1.6,
  morphSeconds: 0.45,
  roomCrossfadeSeconds: 1,
  maxFrames: 1800,
};

const PLANE_SIZE = 10;
/** Breathing room around the pictures (covers the drop shadow offset). */
const REGION_PAD = 0.12;
const MIN_ROOM_SECONDS = 2.5;
const MIN_HOLD_FRAMES = 10;
/** Longest side (world units) of a plain artwork without a shape mask. */
const ARTWORK_SIZE = 1.8;
/** A transparent PNG whose visible area fills most of its canvas is artwork, not a wall mask. */
const MASK_MAX_BOUNDS_AREA = 0.5;

/** Same "cover" convention for rooms and full-canvas masks: short side = plane size. */
function coverScale(width: number, height: number) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  return aspect >= 1 ? { scaleX: aspect, scaleY: 1 } : { scaleX: 1, scaleY: 1 / aspect };
}

function isWallMask(img: AnalyzedImage): boolean {
  if (!img.hasTransparency || !img.bounds) return false;
  const area = (img.bounds.x1 - img.bounds.x0) * (img.bounds.y1 - img.bounds.y0);
  return area > 0 && area < MASK_MAX_BOUNDS_AREA;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, decimals = 3) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Splits `count` items into `groups` contiguous chunks, sizes as even as possible. */
function chunkSizes(count: number, groups: number): number[] {
  const base = Math.floor(count / groups);
  const extra = count - base * groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/** World-space rectangle (y up) of a picture's visible pixels, incl. its drop shadow. */
function pictureRect(img: AnalyzedImage, picture: PictureDef): Rect {
  const sx = picture.scaleX ?? 1;
  const sy = picture.scaleY ?? 1;
  const ox = picture.offsetX ?? 0;
  const oy = picture.offsetY ?? 0;
  const b = isWallMask(img) && img.bounds ? img.bounds : { x0: 0, y0: 0, x1: 1, y1: 1 };
  return {
    x0: (b.x0 - 0.5) * PLANE_SIZE * sx + ox,
    x1: (b.x1 - 0.5) * PLANE_SIZE * sx + ox,
    y0: (0.5 - b.y1) * PLANE_SIZE * sy + oy,
    y1: (0.5 - b.y0) * PLANE_SIZE * sy + oy,
  };
}

export function autoBuildJob(
  rooms: AnalyzedImage[],
  pictures: AnalyzedImage[],
  base: Pick<RoomFlythroughProps, "shadow" | "gloss" | "extrusionDepth">,
  options: AutoBuildOptions,
): { job: RoomFlythroughProps; durationInFrames: number } {
  if (rooms.length === 0) throw new Error("Mindestens ein Raum wird benötigt.");
  if (pictures.length === 0) throw new Error("Mindestens ein Wandbild wird benötigt.");

  const { fps } = options;
  const n = pictures.length;

  // --- Picture timing -------------------------------------------------------
  let transition = Math.max(0, Math.round(options.morphSeconds * fps));
  let hold = Math.max(MIN_HOLD_FRAMES, Math.round(options.secondsPerPicture * fps));
  const maxFrames = Math.max(60, options.maxFrames);
  if (n * hold + (n - 1) * transition > maxFrames) {
    // Too many pictures for the length limit: shorten morphs first, then holds.
    transition = Math.min(transition, Math.max(0, Math.floor((maxFrames - n * MIN_HOLD_FRAMES) / Math.max(1, n - 1))));
    hold = Math.max(MIN_HOLD_FRAMES, Math.floor((maxFrames - (n - 1) * transition) / n));
  }
  const minRoomFrames = Math.round(MIN_ROOM_SECONDS * fps);
  const durationInFrames = clamp(
    Math.max(n * hold + (n - 1) * transition, rooms.length * minRoomFrames, 60),
    60,
    Math.max(maxFrames, rooms.length * minRoomFrames),
  );
  const holds = distributePictureHolds(durationInFrames, n, transition);
  const holdStart = (i: number) => pictureHoldStartFrame(i, holds, transition);

  // --- Rooms: switch in the middle of a picture morph where possible --------
  const roomOfPicture: number[] = [];
  let roomHolds: number[];
  if (rooms.length <= n) {
    const sizes = chunkSizes(n, rooms.length);
    const boundaries: number[] = [];
    let cursor = 0;
    sizes.forEach((size, r) => {
      for (let k = 0; k < size; k++) roomOfPicture.push(r);
      cursor += size;
      if (r < rooms.length - 1) boundaries.push(holdStart(cursor) - Math.floor(transition / 2));
    });
    let prev = 0;
    roomHolds = boundaries.map((b) => {
      const h = b - prev;
      prev = b;
      return h;
    });
    roomHolds.push(durationInFrames - prev);
  } else {
    const even = Math.floor(durationInFrames / rooms.length);
    roomHolds = rooms.map((_, i) => (i === rooms.length - 1 ? durationInFrames - even * (rooms.length - 1) : even));
    for (let i = 0; i < n; i++) {
      const mid = holdStart(i) + Math.floor(holds[i] / 2);
      roomOfPicture.push(Math.min(rooms.length - 1, Math.floor(mid / even)));
    }
  }
  const crossfadeFrames = Math.min(
    Math.max(0, Math.round(options.roomCrossfadeSeconds * fps)),
    Math.max(0, Math.min(...roomHolds) - 2),
  );

  const roomDefs: RoomDef[] = rooms.map((img, i) => ({
    label: img.label,
    src: img.src,
    holdFrames: roomHolds[i],
    ...coverScale(img.width, img.height),
    aspectLock: true,
  }));

  // --- Pictures: masks align with their room, artwork becomes a wall print --
  const pictureDefs: PictureDef[] = pictures.map((img, i) => {
    const room = roomDefs[roomOfPicture[i]] ?? roomDefs[0];
    let scale: { scaleX: number; scaleY: number };
    if (isWallMask(img)) {
      // Full-canvas mask exported at room size: same aspect as the room means
      // same scale, so the shape sits exactly where it was placed on the photo.
      const sameAspect =
        Math.abs(img.width / img.height - (rooms[roomOfPicture[i]]?.width ?? 1) / (rooms[roomOfPicture[i]]?.height ?? 1)) < 0.01;
      scale = sameAspect ? { scaleX: room.scaleX ?? 1, scaleY: room.scaleY ?? 1 } : coverScale(img.width, img.height);
    } else {
      const fit = coverScale(img.width, img.height);
      const longest = Math.max(fit.scaleX, fit.scaleY);
      const k = ARTWORK_SIZE / PLANE_SIZE / longest;
      scale = { scaleX: fit.scaleX * k, scaleY: fit.scaleY * k };
    }
    return {
      label: img.label,
      src: img.src,
      scaleX: round(scale.scaleX, 4),
      scaleY: round(scale.scaleY, 4),
      aspectLock: true,
      offsetX: 0,
      offsetY: 0,
    };
  });

  // --- Camera: one continuous move, independent of morphs and room changes --
  // The region every frame must show completely: all wall pictures together.
  const rects = pictures.map((img, i) => pictureRect(img, pictureDefs[i]));
  const region: Rect = {
    x0: Math.min(...rects.map((r) => r.x0)) - REGION_PAD,
    x1: Math.max(...rects.map((r) => r.x1)) + REGION_PAD,
    y0: Math.min(...rects.map((r) => r.y0)) - REGION_PAD,
    y1: Math.max(...rects.map((r) => r.y1)) + REGION_PAD,
  };
  // Every room must fill the frame, so use the smallest one.
  const roomHalfX = (PLANE_SIZE / 2) * Math.min(...roomDefs.map((r) => r.scaleX ?? 1));
  const roomHalfY = (PLANE_SIZE / 2) * Math.min(...roomDefs.map((r) => r.scaleY ?? 1));
  const cameraKeyframes = buildBallhausPath(durationInFrames, region, {
    x0: -roomHalfX,
    x1: roomHalfX,
    y0: -roomHalfY,
    y1: roomHalfY,
  });

  return {
    durationInFrames,
    job: {
      pictures: pictureDefs,
      transitionFrames: transition,
      rooms: roomDefs,
      crossfadeFrames,
      cameraKeyframes,
      shadow: base.shadow,
      gloss: base.gloss,
      extrusionDepth: base.extrusionDepth ?? 0,
    },
  };
}
