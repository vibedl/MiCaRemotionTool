/** A shape-masked picture PNG (RGBA, transparent outside the shape), exactly
 * like the exported `shapes/*.png` files from the DaVinci/Fusion workflow.
 * `src` is a `staticFile()` path or a same-origin URL. */
export type PictureDef = {
  label: string;
  src: string;
  /** Plane width scale (1 = default square width). */
  scaleX?: number;
  /** Plane height scale (1 = default square height). */
  scaleY?: number;
  /** When true, changing one scale axis updates the other proportionally. */
  aspectLock?: boolean;
  /** Horizontal offset on the wall plane (world units; 10 ≈ full frame width). */
  offsetX?: number;
  /** Vertical offset on the wall plane (world units; positive = up). */
  offsetY?: number;
};

/** A "room" (flat background photo). In the DaVinci setup this is a single
 * flat `BG.png` plane that the camera Ken-Burns-pans across — not an
 * enclosed 3D box. */
export type RoomDef = {
  label: string;
  src: string;
  /** How many frames this room is held before crossfading to the next one. */
  holdFrames: number;
  scaleX?: number;
  scaleY?: number;
  aspectLock?: boolean;
};

/** `position` (X/Y = pan, Z = dolly distance), `rotation` ([yawDeg, pitchDeg]
 * — the actual camera angle) and `fov` (lens zoom) are all independently
 * keyframed. `rotation` is intentionally kept far away from +/-90° in the
 * webapp sliders (clamped to +/-30°) so the plane can never turn edge-on or
 * rotate out of the frustum, no matter how the axes are combined. */
export type CameraKeyframe = {
  frame: number;
  position: [number, number, number];
  rotation: [number, number];
  fov: number;
};

/** Optional subtle mirror image on the floor, e.g. `shapes/Reflection_1.webp`. */
export type ReflectionDef = {
  src: string;
};

/** Drop shadow behind the picture overlay — same silhouette, rendered black
 * and offset. `offsetX`/`offsetY` are in the same world units as the plane
 * (10 = full frame width), positive X = right, positive Y = up. */
export type ShadowConfig = {
  offsetX: number;
  offsetY: number;
  opacity: number;
};

/** View-dependent lacquer/glass highlight on the wall picture. */
export type GlossConfig = {
  strength: number;
  sharpness: number;
  /** Environment reflection amount (0 = none). Uses the current room photo as env. */
  reflectStrength?: number;
};

export const DEFAULT_SCALE = { scaleX: 1, scaleY: 1, aspectLock: true as const };

export function resolveScale(item: { scaleX?: number; scaleY?: number; aspectLock?: boolean }) {
  return {
    scaleX: item.scaleX ?? 1,
    scaleY: item.scaleY ?? 1,
    aspectLock: item.aspectLock !== false,
  };
}

export function resolvePictureOffset(item: { offsetX?: number; offsetY?: number }) {
  return {
    offsetX: item.offsetX ?? 0,
    offsetY: item.offsetY ?? 0,
  };
}
