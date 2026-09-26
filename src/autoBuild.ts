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
import type { CameraKeyframe, PictureDef, RoomDef } from "./types";

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
const CAMERA_DISTANCE = 8;
const MIN_FOV = 15;
const MAX_FOV = 30;
const MIN_ROOM_SECONDS = 2.5;
const MIN_HOLD_FRAMES = 10;
/** Longest side (world units) of a plain artwork without a shape mask. */
const ARTWORK_SIZE = 1.8;
/** Visible frame height relative to the picture size it frames. */
const FRAMING = 1.9;
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

type Target = { x: number; y: number; size: number };

function pictureTarget(img: AnalyzedImage, picture: PictureDef): Target {
  const sx = picture.scaleX ?? 1;
  const sy = picture.scaleY ?? 1;
  if (isWallMask(img) && img.bounds) {
    const b = img.bounds;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    return {
      x: (cx - 0.5) * PLANE_SIZE * sx,
      y: (0.5 - cy) * PLANE_SIZE * sy,
      size: Math.max((b.x1 - b.x0) * PLANE_SIZE * sx, (b.y1 - b.y0) * PLANE_SIZE * sy),
    };
  }
  return { x: 0, y: 0, size: PLANE_SIZE * Math.max(sx, sy) };
}

function fovForSize(size: number) {
  const deg = (2 * Math.atan((size * FRAMING) / (2 * CAMERA_DISTANCE)) * 180) / Math.PI;
  return clamp(deg, MIN_FOV, MAX_FOV);
}

/** Half the visible frame height at the widest FOV — pan must keep this inside the room. */
const MAX_VISIBLE_HALF = CAMERA_DISTANCE * Math.tan(((MAX_FOV / 2) * Math.PI) / 180);

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

  // --- Camera: frame each picture, slow push-in + gentle orbit per hold -----
  const keyframes: CameraKeyframe[] = [];
  pictures.forEach((img, i) => {
    const room = roomDefs[roomOfPicture[i]] ?? roomDefs[0];
    const limitX = Math.max(0, (PLANE_SIZE / 2) * (room.scaleX ?? 1) - MAX_VISIBLE_HALF - 0.2);
    const limitY = Math.max(0, (PLANE_SIZE / 2) * (room.scaleY ?? 1) - MAX_VISIBLE_HALF - 0.2);
    const target = pictureTarget(img, pictureDefs[i]);
    const fov = fovForSize(target.size);
    const side = i % 2 === 0 ? 1 : -1;
    const drift = target.size * 0.06;

    const start = holdStart(i);
    // Hold ends where the morph starts; without morphs the next hold starts there instead.
    const end = Math.min(start + holds[i] - (transition === 0 ? 1 : 0), durationInFrames - 1);
    const pose = (t: 0 | 1): Omit<CameraKeyframe, "frame"> => ({
      position: [
        round(clamp(target.x + (t === 0 ? drift : -drift) * side, -limitX, limitX)),
        round(clamp(target.y + (t === 0 ? drift * 0.4 : -drift * 0.4), -limitY, limitY)),
        CAMERA_DISTANCE,
      ],
      rotation: [round(t === 0 ? 3 * side : -1.5 * side, 2), round(t === 0 ? 0.5 : 0.2, 2)],
      fov: round(clamp(t === 0 ? fov * 1.05 : fov * 0.95, MIN_FOV, MAX_FOV), 2),
    });

    keyframes.push({ frame: start, ...pose(0) });
    if (end > start) keyframes.push({ frame: end, ...pose(1) });
  });
  // Hold the final pose until the very last frame.
  const last = keyframes[keyframes.length - 1];
  if (last.frame < durationInFrames - 1) keyframes.push({ ...last, frame: durationInFrames - 1 });
  // interpolate() needs strictly increasing frames.
  const cameraKeyframes = keyframes.filter((k, i) => i === 0 || k.frame > keyframes[i - 1].frame);
  if (cameraKeyframes.length < 2) {
    cameraKeyframes.push({ ...cameraKeyframes[0], frame: cameraKeyframes[0].frame + 1 });
  }

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
