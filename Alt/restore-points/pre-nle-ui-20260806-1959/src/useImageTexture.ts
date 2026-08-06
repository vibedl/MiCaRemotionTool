import { useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

export type ImageTextureOptions = {
  /**
   * Shape PNGs with transparency: disable mipmaps so black RGB in zero-alpha
   * texels cannot bleed into the silhouette (or over the room) at orbit angles.
   */
  forAlphaCutout?: boolean;
};

/**
 * Loads a real image as a Three.js texture. Suspends until loaded.
 *
 * IMPORTANT: Keep `NoColorSpace` — CrossfadeMaterial is a raw ShaderMaterial
 * without sRGB re-encode; tagging SRGBColorSpace would look too dark.
 *
 * Room textures keep anisotropy + mipmaps. Picture (alpha-cutout) textures
 * turn mipmaps off to avoid black bleed at grazing angles.
 */
export function useImageTexture(url: string, options: ImageTextureOptions = {}): THREE.Texture {
  const texture = useLoader(THREE.TextureLoader, url);
  const gl = useThree((state) => state.gl);

  if (options.forAlphaCutout) {
    if (texture.generateMipmaps || texture.minFilter !== THREE.LinearFilter) {
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 1;
      texture.needsUpdate = true;
    }
  } else {
    const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
    if (texture.anisotropy !== maxAnisotropy) {
      texture.anisotropy = maxAnisotropy;
      texture.needsUpdate = true;
    }
  }

  return texture;
}
