import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { RoomScene } from "./RoomScene";
import { distributePictureHolds, pictureStateAtFrame, roomStateAtFrame } from "./timing";
import type { CameraKeyframe, PictureDef, RoomDef, ShadowConfig, GlossConfig } from "./types";

export const DEFAULT_SHADOW: ShadowConfig = { offsetX: 0.045, offsetY: -0.045, opacity: 0.45 };
export const DEFAULT_GLOSS: GlossConfig = { strength: 0.35, sharpness: 0.5, reflectStrength: 0.2 };
/** Flat by default; raise for a global cardboard/relief thickness on all shapes. */
export const DEFAULT_EXTRUSION_DEPTH = 0;

export type RoomFlythroughProps = {
  pictures: PictureDef[];
  /** Morph length between two consecutive pictures, in frames. */
  transitionFrames: number;
  rooms: RoomDef[];
  /** Crossfade length between two consecutive rooms, in frames. */
  crossfadeFrames: number;
  cameraKeyframes: CameraKeyframe[];
  shadow: ShadowConfig;
  gloss: GlossConfig;
  /** World-unit thickness for all wall pictures (0 = flat). Global. */
  extrusionDepth?: number;
};

// Ease every segment in/out instead of linearly snapping from keyframe to
// keyframe — this is what makes the move feel like a smooth, deliberate
// camera pan instead of a shaky, robotic one.
const CAMERA_EASING = Easing.inOut(Easing.ease);

const DEG_TO_RAD = Math.PI / 180;

/**
 * Eased-interpolates every camera axis at `frame`. Exported (and kept in
 * keyframe-native units — rotation in degrees, not radians) so the webapp's
 * timeline can show "what the camera currently looks like" at an arbitrary
 * scrub position, e.g. to seed a new keyframe with sane values instead of
 * defaulting to some fixed pose.
 */
export function resolveCameraAxes(frame: number, keyframes: CameraKeyframe[]) {
  const inputRange = keyframes.map((k) => k.frame);
  const axis = (pick: (k: CameraKeyframe) => number) =>
    interpolate(frame, inputRange, keyframes.map(pick), {
      easing: CAMERA_EASING,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return {
    position: [axis((k) => k.position[0]), axis((k) => k.position[1]), axis((k) => k.position[2])] as [
      number,
      number,
      number,
    ],
    rotation: [axis((k) => k.rotation[0]), axis((k) => k.rotation[1])] as [number, number],
    fov: axis((k) => k.fov),
  };
}

function resolveCamera(frame: number, keyframes: CameraKeyframe[]) {
  const axes = resolveCameraAxes(frame, keyframes);
  return {
    position: axes.position,
    // The scene wants radians for the Euler rotation; keyframes store degrees
    // (human-friendly for the webapp sliders).
    rotation: [axes.rotation[0] * DEG_TO_RAD, axes.rotation[1] * DEG_TO_RAD] as [number, number],
    fov: axes.fov,
  };
}

export const RoomFlythrough: React.FC<RoomFlythroughProps> = ({
  pictures,
  transitionFrames,
  rooms,
  crossfadeFrames,
  cameraKeyframes,
  shadow = DEFAULT_SHADOW,
  gloss = DEFAULT_GLOSS,
  extrusionDepth = DEFAULT_EXTRUSION_DEPTH,
}) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const holds = distributePictureHolds(durationInFrames, pictures.length, transitionFrames);
  const pictureState = pictureStateAtFrame(frame, holds, transitionFrames);
  const roomState = roomStateAtFrame(frame, rooms, crossfadeFrames);
  const camera = resolveCamera(frame, cameraKeyframes);

  return (
    <AbsoluteFill style={{ backgroundColor: "#2a2a2a" }}>
      {/* `flat`: React-Three-Fiber defaults to ACESFilmicToneMapping, which
      shifts contrast/saturation — wrong for flat 2D compositing where the
      PNGs should show up pixel-for-pixel as authored. */}
      <ThreeCanvas
        width={width}
        height={height}
        flat
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor("#2a2a2a", 1);
        }}
      >
        <RoomScene
          pictures={pictures}
          pictureState={pictureState}
          rooms={rooms}
          roomState={roomState}
          camera={camera}
          shadow={shadow}
          gloss={gloss}
          extrusionDepth={extrusionDepth}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
