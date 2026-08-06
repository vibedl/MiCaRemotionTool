import React from "react";
import { Composition, staticFile } from "remotion";
import { DEFAULT_EXTRUSION_DEPTH, DEFAULT_GLOSS, DEFAULT_SHADOW, RoomFlythrough, RoomFlythroughProps } from "./RoomFlythrough";
import { COMPOSITION_ID, DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "./constants";

const asset = (name: string) => staticFile(`assets/${name}`);

// The 14 shape-masked picture exports found in the reference job folder.
// Real filenames/order — swap or reorder freely, the UI will make this a
// drag-and-drop list later.
export const defaultJobProps: RoomFlythroughProps = {
  pictures: [
    { label: "Herz", src: asset("Herz.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Oval", src: asset("Oval.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Hope", src: asset("Hope.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Puzzle", src: asset("Puzzle.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Stern", src: asset("Stern.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Kreis", src: asset("Kreis.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "Love", src: asset("love.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZHerz", src: asset("ZHerz.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZOval", src: asset("ZOval.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZPuzzle", src: asset("ZPuzzle.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZStern", src: asset("ZStern.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZKreis", src: asset("ZKreis.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZLove", src: asset("ZLOve.png"), scaleX: 1, scaleY: 1, aspectLock: true },
    { label: "ZFeder", src: asset("ZFeder.png"), scaleX: 1, scaleY: 1, aspectLock: true },
  ],
  // 630 frames, 14 pictures, 14f morph -> 14x32f holds + 13x14f morphs
  // (same distribution documented for the reference job in AGENTS.md).
  transitionFrames: 14,
  rooms: [{ label: "Wohnzimmer", src: asset("BG.png"), holdFrames: DURATION_IN_FRAMES, scaleX: 1, scaleY: 1, aspectLock: true }],
  crossfadeFrames: 30,
  // Ken-Burns move: Position X/Y = pan, Z = dolly distance, rotation =
  // [yawDeg, pitchDeg] (the actual camera angle), FOV = zoom. The webapp
  // sliders clamp position/rotation/FOV to a range that's verified (see
  // RoomScene.tsx's slider-range comment) to keep the room both fully
  // covered AND free of grazing-angle stretching, even at every slider's
  // simultaneous extreme. Eased (not linear) interpolation in
  // RoomFlythrough.tsx keeps every transition smooth. This is only a
  // starting point — edit the table in the Studio webapp (or just tell me
  // the exact values you want).
  cameraKeyframes: [
    { frame: 0, position: [0.15, 0.08, 8], rotation: [1, 0.5], fov: 15 },
    { frame: 90, position: [-0.7, 0.05, 8], rotation: [-5, 0.3], fov: 19 },
    { frame: 200, position: [0.85, -0.1, 8], rotation: [6, -0.6], fov: 25 },
    { frame: 320, position: [-0.6, 0.12, 8], rotation: [-4, 0.7], fov: 21 },
    { frame: 440, position: [0.5, -0.08, 8], rotation: [3, -0.5], fov: 27 },
    { frame: 560, position: [-0.3, 0.05, 8], rotation: [-2, 0.3], fov: 29 },
    { frame: 629, position: [0, 0.05, 8], rotation: [0, 0.3], fov: 30 },
  ],
  shadow: DEFAULT_SHADOW,
  gloss: DEFAULT_GLOSS,
  extrusionDepth: DEFAULT_EXTRUSION_DEPTH,
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={RoomFlythrough}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultJobProps}
    />
  );
};
