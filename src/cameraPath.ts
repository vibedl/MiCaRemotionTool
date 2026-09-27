/**
 * Continuous camera move over the whole video, independent of picture morphs
 * and room changes:
 *
 *   Totale → smooth push-in to the left edge of the wall picture (oblique view)
 *   → half "Ballhaus" arc to the right edge → pull back a little and arc
 *   towards the left edge → back to the opening Totale.
 *
 * Every pose is solved geometrically against the same camera model as
 * RoomScene's OrbitCamera, with two hard constraints:
 *   1. the wall picture region (union of all pictures) stays fully in frame,
 *   2. the frame never shows beyond the room photo.
 * Within those limits the close shots go as tight as possible.
 */
import type { CameraKeyframe } from "./types";

export type Rect = { x0: number; x1: number; y0: number; y1: number };

type Vec = [number, number, number];

const DEG = Math.PI / 180;
export const PATH_CAMERA_DISTANCE = 8;
/** Widest lens the path may use (the room photo limits the Totale anyway). */
export const PATH_MAX_FOV = 70;
const MIN_FOV = 8;
/** Room edge safety margin (world units). */
const ROOM_MARGIN = 0.08;

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Same placement as RoomScene's OrbitCamera (degrees in, look-at on the wall plane z = 0). */
function cameraBasis(lookX: number, lookY: number, distance: number, yawDeg: number, pitchDeg: number) {
  const yaw = yawDeg * DEG;
  const pitch = pitchDeg * DEG;
  const cosP = Math.cos(pitch);
  const eye: Vec = [
    lookX + distance * Math.sin(yaw) * cosP,
    lookY + distance * Math.sin(pitch),
    distance * Math.cos(yaw) * cosP,
  ];
  const forward = norm(sub([lookX, lookY, 0], eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, forward, right, up };
}

type Pose = { lookX: number; lookY: number; distance: number; yaw: number; pitch: number; fov: number };

/** Largest |NDC| of the rect's corners (square frame), or Infinity if behind the camera. */
function rectExtent(pose: Pose, rect: Rect) {
  const { eye, forward, right, up } = cameraBasis(pose.lookX, pose.lookY, pose.distance, pose.yaw, pose.pitch);
  const t = Math.tan((pose.fov / 2) * DEG);
  let worst = 0;
  for (const x of [rect.x0, rect.x1]) {
    for (const y of [rect.y0, rect.y1]) {
      const d = sub([x, y, 0], eye);
      const z = dot(d, forward);
      if (z <= 0.01) return Infinity;
      worst = Math.max(worst, Math.abs(dot(d, right)) / (z * t), Math.abs(dot(d, up)) / (z * t));
    }
  }
  return worst;
}

/** Does the whole frame land inside the room photo? */
function coversRoom(pose: Pose, room: Rect) {
  const { eye, forward, right, up } = cameraBasis(pose.lookX, pose.lookY, pose.distance, pose.yaw, pose.pitch);
  const t = Math.tan((pose.fov / 2) * DEG);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dir: Vec = [
        forward[0] + (right[0] * sx + up[0] * sy) * t,
        forward[1] + (right[1] * sx + up[1] * sy) * t,
        forward[2] + (right[2] * sx + up[2] * sy) * t,
      ];
      if (dir[2] >= -1e-6) return false;
      const s = -eye[2] / dir[2];
      const x = eye[0] + dir[0] * s;
      const y = eye[1] + dir[1] * s;
      if (x < room.x0 + ROOM_MARGIN || x > room.x1 - ROOM_MARGIN) return false;
      if (y < room.y0 + ROOM_MARGIN || y > room.y1 - ROOM_MARGIN) return false;
    }
  }
  return true;
}

/** Smallest FOV that keeps `rect` within ±`fill` of the frame. */
function fovToFit(pose: Omit<Pose, "fov">, rect: Rect, fill: number) {
  // Extent scales with 1/tan(fov/2): solve at tan = 1, then rescale.
  const atUnit = rectExtent({ ...pose, fov: 90 }, rect);
  if (!Number.isFinite(atUnit)) return Infinity;
  return (2 * Math.atan(atUnit / fill)) / DEG;
}

/** Widest FOV that still stays inside the room photo (bisection). */
function widestCoveringFov(pose: Omit<Pose, "fov">, room: Rect) {
  let lo = MIN_FOV;
  let hi = PATH_MAX_FOV;
  if (!coversRoom({ ...pose, fov: lo }, room)) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (coversRoom({ ...pose, fov: mid }, room)) lo = mid;
    else hi = mid;
  }
  return lo;
}

type ShotSpec = {
  /** 0..1 position of the look-at point across the picture region (0 = left edge). */
  lookU: number;
  yaw: number;
  pitch: number;
  /** How much of the frame (±NDC) the picture region may fill — smaller = further back. */
  fill: number;
};

/**
 * Solves one close/medium shot. The yaw is reduced step by step until both
 * constraints hold, so strongly oblique angles are used whenever the room allows.
 */
function solveShot(spec: ShotSpec, region: Rect, room: Rect): Pose {
  const lookY = (region.y0 + region.y1) / 2;
  const sign = Math.sign(spec.yaw) || 1;
  for (let yaw = Math.abs(spec.yaw); yaw >= 0; yaw -= 1) {
    for (let fill = spec.fill; fill >= spec.fill * 0.6; fill -= 0.04) {
      const base = {
        lookX: region.x0 + (region.x1 - region.x0) * spec.lookU,
        lookY,
        distance: PATH_CAMERA_DISTANCE,
        yaw: yaw * sign,
        pitch: spec.pitch,
      };
      const fov = fovToFit(base, region, fill);
      if (fov > PATH_MAX_FOV || fov < MIN_FOV) continue;
      if (coversRoom({ ...base, fov }, room)) return { ...base, fov };
    }
  }
  // Fallback: straight-on, centered, as tight as the room allows.
  const base = { lookX: (region.x0 + region.x1) / 2, lookY, distance: PATH_CAMERA_DISTANCE, yaw: 0, pitch: 0 };
  return { ...base, fov: Math.min(PATH_MAX_FOV, Math.max(MIN_FOV, fovToFit(base, region, 0.9))) };
}

function totale(region: Rect, room: Rect): Pose {
  // Centered on the room (slightly toward the picture), as wide as the photo allows.
  const cx = ((room.x0 + room.x1) / 2) * 0.5 + ((region.x0 + region.x1) / 2) * 0.5;
  const cy = ((room.y0 + room.y1) / 2) * 0.5 + ((region.y0 + region.y1) / 2) * 0.5;
  for (const k of [1, 0.75, 0.5, 0.25, 0]) {
    const base = { lookX: cx * k, lookY: cy * k, distance: PATH_CAMERA_DISTANCE, yaw: 0, pitch: 0.4 };
    const widest = widestCoveringFov(base, room);
    // A touch tighter than the limit, so the eased move out of the Totale never
    // swings past the photo edge.
    const fov = widest ? widest * 0.95 : null;
    if (fov && rectExtent({ ...base, fov }, region) <= 0.95) return { ...base, fov };
  }
  const base = { lookX: 0, lookY: 0, distance: PATH_CAMERA_DISTANCE, yaw: 0, pitch: 0 };
  return { ...base, fov: widestCoveringFov(base, room) ?? 30 };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function toKeyframe(frame: number, p: Pose): CameraKeyframe {
  return {
    frame,
    position: [r3(p.lookX), r3(p.lookY), r3(p.distance)],
    rotation: [r3(p.yaw), r3(p.pitch)],
    fov: r3(p.fov),
  };
}

/**
 * @param region union of all wall pictures (world units, y up)
 * @param room   the room photo area every frame must stay inside
 */
export function buildBallhausPath(durationInFrames: number, region: Rect, room: Rect): CameraKeyframe[] {
  const last = Math.max(1, durationInFrames - 1);
  const open = totale(region, room);
  const shots: Array<[number, Pose]> = [
    [0, open],
    // Push in to the left edge, looking at the picture from the left.
    [0.24, solveShot({ lookU: 0.3, yaw: -32, pitch: 1.2, fill: 0.9 }, region, room)],
    // Half Ballhaus: arc around to the right edge.
    [0.5, solveShot({ lookU: 0.7, yaw: 32, pitch: 0.6, fill: 0.9 }, region, room)],
    // A little back, still on the right …
    [0.62, solveShot({ lookU: 0.62, yaw: 24, pitch: 0.8, fill: 0.72 }, region, room)],
    // … and a half Ballhaus back toward the left edge.
    [0.82, solveShot({ lookU: 0.35, yaw: -24, pitch: 1, fill: 0.72 }, region, room)],
    // Back to the opening Totale — identical framing.
    [1, open],
  ];
  const keyframes = shots.map(([t, pose]) => toKeyframe(Math.round(t * last), pose));
  return keyframes.filter((k, i) => i === 0 || k.frame > keyframes[i - 1].frame);
}

/** For verification: is the region fully visible and the room covered at this camera state? */
export function checkPose(
  axes: { position: [number, number, number]; rotation: [number, number]; fov: number },
  region: Rect,
  room: Rect,
) {
  const pose: Pose = {
    lookX: axes.position[0],
    lookY: axes.position[1],
    distance: axes.position[2],
    yaw: axes.rotation[0],
    pitch: axes.rotation[1],
    fov: axes.fov,
  };
  return { extent: rectExtent(pose, region), covered: coversRoom(pose, room) };
}
