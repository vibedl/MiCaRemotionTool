import React from "react";
import { Composition } from "remotion";
import {
  DEFAULT_EXTRUSION_DEPTH,
  DEFAULT_GLOSS,
  DEFAULT_SHADOW,
  RoomFlythrough,
  RoomFlythroughProps,
} from "./RoomFlythrough";
import { COMPOSITION_ID, DURATION_IN_FRAMES, FPS, HEIGHT, WIDTH } from "./constants";

/** Blank project for the Studio UI — no bundled demo shapes/rooms. */
export const emptyStudioJob: RoomFlythroughProps = {
  pictures: [],
  rooms: [],
  transitionFrames: 14,
  crossfadeFrames: 30,
  cameraKeyframes: [
    { frame: 0, position: [0, 0.05, 8], rotation: [0, 0.3], fov: 22 },
    { frame: DURATION_IN_FRAMES - 1, position: [0, 0.05, 8], rotation: [0, 0.3], fov: 22 },
  ],
  shadow: DEFAULT_SHADOW,
  gloss: DEFAULT_GLOSS,
  extrusionDepth: DEFAULT_EXTRUSION_DEPTH,
};

/** @deprecated Use emptyStudioJob — demo assets were removed from the Studio. */
export const defaultJobProps = emptyStudioJob;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={RoomFlythrough}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={emptyStudioJob}
    />
  );
};
