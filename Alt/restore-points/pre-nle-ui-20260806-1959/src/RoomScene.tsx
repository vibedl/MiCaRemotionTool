import React, { useLayoutEffect, useMemo, useRef } from "react";
import { PerspectiveCamera as DreiPerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { useImageTexture } from "./useImageTexture";
import { useCrossfadeMaterial } from "./CrossfadeMaterial";
import type { CrossfadeSegment } from "./timing";
import type { GlossConfig, PictureDef, RoomDef, ShadowConfig } from "./types";
import { resolvePictureOffset, resolveScale } from "./types";

const PLANE_SIZE = 10;
/** Extra UV zoom-out so orbit ±45° does not expose the plane edge */
const ROOM_BLEED = 28;
const ROOM_PLANE_SIZE = PLANE_SIZE * ROOM_BLEED;

const Z_SHADOW = 0.02;
const Z_PICTURE = 0.04;
/** Shell count for global extrusion (cardboard relief). */
const SHELL_COUNT = 8;

type CameraState = {
  position: [number, number, number];
  rotation: [number, number];
  fov: number;
};

type Props = {
  pictures: PictureDef[];
  pictureState: CrossfadeSegment;
  rooms: RoomDef[];
  roomState: CrossfadeSegment;
  camera: CameraState;
  shadow: ShadowConfig;
  gloss: GlossConfig;
  extrusionDepth?: number;
};

function OrbitCamera({
  panX,
  panY,
  distance,
  yaw,
  pitch,
  fov,
}: {
  panX: number;
  panY: number;
  distance: number;
  yaw: number;
  pitch: number;
  fov: number;
}) {
  const ref = useRef<THREE.PerspectiveCamera>(null);
  const lookAt = useRef(new THREE.Vector3());

  useLayoutEffect(() => {
    const cam = ref.current;
    if (!cam) return;
    const cosP = Math.cos(pitch);
    cam.position.set(
      panX + distance * Math.sin(yaw) * cosP,
      panY + distance * Math.sin(pitch),
      distance * Math.cos(yaw) * cosP,
    );
    lookAt.current.set(panX, panY, 0);
    cam.lookAt(lookAt.current);
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }, [panX, panY, distance, yaw, pitch, fov]);

  return <DreiPerspectiveCamera ref={ref} makeDefault />;
}

/** Blend scales across a crossfade so size transitions stay smooth. */
function blendedScale(
  from: { scaleX?: number; scaleY?: number },
  to: { scaleX?: number; scaleY?: number },
  mix: number,
) {
  const a = resolveScale(from);
  const b = resolveScale(to);
  const t = Math.min(1, Math.max(0, mix));
  return {
    scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
    scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
  };
}

function blendedPictureOffset(
  from: { offsetX?: number; offsetY?: number },
  to: { offsetX?: number; offsetY?: number },
  mix: number,
) {
  const a = resolvePictureOffset(from);
  const b = resolvePictureOffset(to);
  const t = Math.min(1, Math.max(0, mix));
  return {
    offsetX: a.offsetX + (b.offsetX - a.offsetX) * t,
    offsetY: a.offsetY + (b.offsetY - a.offsetY) * t,
  };
}

export const RoomScene: React.FC<Props> = ({
  pictures,
  pictureState,
  rooms,
  roomState,
  camera,
  shadow,
  gloss,
  extrusionDepth = 0,
}) => {
  const roomTextureFrom = useImageTexture(rooms[roomState.fromIndex].src);
  const roomTextureTo = useImageTexture(rooms[roomState.toIndex].src);
  const pictureTextureFrom = useImageTexture(pictures[pictureState.fromIndex].src, {
    forAlphaCutout: true,
  });
  const pictureTextureTo = useImageTexture(pictures[pictureState.toIndex].src, {
    forAlphaCutout: true,
  });

  const depth = Math.max(0, extrusionDepth);
  const extruding = depth > 0.001;

  const backgroundMaterial = useCrossfadeMaterial(roomTextureFrom, roomTextureTo, roomState.mix, {
    uvBleed: ROOM_BLEED,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });
  const pictureMaterial = useCrossfadeMaterial(pictureTextureFrom, pictureTextureTo, pictureState.mix, {
    alphaCutout: true,
    side: THREE.FrontSide,
    depthWrite: extruding,
    depthTest: extruding,
  });
  /** Slightly darkened shells so the extruded rim reads at grazing angles. */
  const shellMaterial = useCrossfadeMaterial(pictureTextureFrom, pictureTextureTo, pictureState.mix, {
    alphaCutout: true,
    opacity: 0.88,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });
  const shadowMaterial = useCrossfadeMaterial(pictureTextureFrom, pictureTextureTo, pictureState.mix, {
    opacity: shadow.opacity,
    shadowMode: 1,
    alphaCutout: true,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: false,
  });
  const glossMaterial = useCrossfadeMaterial(pictureTextureFrom, pictureTextureTo, pictureState.mix, {
    glossOverlay: true,
    alphaCutout: true,
    glossStrength: gloss.strength,
    glossSharpness: gloss.sharpness,
    reflectStrength: gloss.reflectStrength ?? 0,
    envMapA: roomTextureFrom,
    envMapB: roomTextureTo,
    envMix: roomState.mix,
    side: THREE.FrontSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const [panX, panY, distance] = camera.position;
  const [yaw, pitch] = camera.rotation;
  const glossOn = gloss.strength > 0.001 || (gloss.reflectStrength ?? 0) > 0.001;

  const roomScale = blendedScale(rooms[roomState.fromIndex], rooms[roomState.toIndex], roomState.mix);
  const pictureScale = blendedScale(
    pictures[pictureState.fromIndex],
    pictures[pictureState.toIndex],
    pictureState.mix,
  );
  const pictureOffset = blendedPictureOffset(
    pictures[pictureState.fromIndex],
    pictures[pictureState.toIndex],
    pictureState.mix,
  );

  const shells = useMemo(() => {
    if (!extruding) {
      return [{ z: Z_PICTURE, isFront: true }];
    }
    return Array.from({ length: SHELL_COUNT }, (_, i) => {
      const t = SHELL_COUNT <= 1 ? 1 : i / (SHELL_COUNT - 1);
      return {
        z: Z_PICTURE + t * depth,
        isFront: i === SHELL_COUNT - 1,
      };
    });
  }, [depth, extruding]);

  const frontZ = shells[shells.length - 1]?.z ?? Z_PICTURE;

  return (
    <>
      <OrbitCamera panX={panX} panY={panY} distance={distance} yaw={yaw} pitch={pitch} fov={camera.fov} />

      <mesh
        position={[0, 0, 0]}
        material={backgroundMaterial}
        renderOrder={0}
        scale={[roomScale.scaleX, roomScale.scaleY, 1]}
      >
        <planeGeometry args={[ROOM_PLANE_SIZE, ROOM_PLANE_SIZE]} />
      </mesh>

      <mesh
        position={[pictureOffset.offsetX + shadow.offsetX, pictureOffset.offsetY + shadow.offsetY, Z_SHADOW]}
        material={shadowMaterial}
        renderOrder={1}
        scale={[pictureScale.scaleX, pictureScale.scaleY, 1]}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      </mesh>

      {shells.map((shell, i) => (
        <mesh
          key={`shell-${i}`}
          position={[pictureOffset.offsetX, pictureOffset.offsetY, shell.z]}
          material={shell.isFront ? pictureMaterial : shellMaterial}
          renderOrder={2 + i}
          scale={[pictureScale.scaleX, pictureScale.scaleY, 1]}
        >
          <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        </mesh>
      ))}

      {glossOn ? (
        <mesh
          position={[pictureOffset.offsetX, pictureOffset.offsetY, frontZ + 0.001]}
          material={glossMaterial}
          renderOrder={2 + shells.length}
          scale={[pictureScale.scaleX, pictureScale.scaleY, 1]}
        >
          <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        </mesh>
      ) : null}
    </>
  );
};
