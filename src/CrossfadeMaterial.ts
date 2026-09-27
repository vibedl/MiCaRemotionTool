import { useMemo } from "react";
import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
uniform sampler2D textureA;
uniform sampler2D textureB;
uniform sampler2D envMapA;
uniform sampler2D envMapB;
uniform float uMix;
uniform float uEnvMix;
uniform float uOpacity;
uniform float uTint;
// Shape morph: mipmapped copies of the picture textures give a cheap blurred
// alpha field; interpolating that field and re-thresholding it moves the
// silhouette smoothly from one shape to the next instead of cross-dissolving.
uniform sampler2D morphA;
uniform sampler2D morphB;
uniform float uMorphOn;
uniform float uMorphBlur;
uniform float uFadeStrength;
uniform float uShadowMode;
uniform float uUvScale;
uniform float uUvOffset;
uniform float uGlossStrength;
uniform float uGlossSharpness;
uniform float uReflectStrength;
uniform float uGlossOverlay;
uniform float uAlphaCutout;

const float PI = 3.14159265359;

float ditherRand(vec2 uv) {
  const float a = 12.9898, b = 78.233, c = 43758.5453;
  float dt = dot(uv, vec2(a, b));
  float sn = mod(dt, 3.14159);
  return fract(sin(sn) * c);
}

vec3 dither(vec3 color) {
  float gridPosition = ditherRand(gl_FragCoord.xy);
  vec3 shift = vec3(0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0);
  shift = mix(2.0 * shift, -2.0 * shift, gridPosition);
  return color + shift;
}

/** Equirectangular UV from a reflection direction. */
vec2 dirToEquirect(vec3 dir) {
  vec3 d = normalize(dir);
  float phi = atan(d.z, d.x);
  float theta = asin(clamp(d.y, -1.0, 1.0));
  return vec2(phi / (2.0 * PI) + 0.5, theta / PI + 0.5);
}

void main() {
  vec2 uv = vUv * uUvScale + uUvOffset;
  vec4 colorA = texture2D(textureA, uv);
  vec4 colorB = texture2D(textureB, uv);
  // Premultiplied crossfade: RGB hidden under zero alpha (edge smear some PNG
  // exporters leave there) must not bleed into the morph as streaks.
  vec4 pm = mix(vec4(colorA.rgb * colorA.a, colorA.a), vec4(colorB.rgb * colorB.a, colorB.a), uMix);
  vec4 blended = vec4(pm.rgb / max(pm.a, 0.0001), pm.a);

  if (uMorphOn > 0.5 && uMix > 0.0005 && uMix < 0.9995) {
    // Several coarse-mip taps give a smooth field (a single tap shows the mip grid as wobbles).
    float fa = 0.0;
    float fb = 0.0;
    vec3 ca = vec3(0.0);
    vec3 cb = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.785398 + 0.39;
      vec2 o = vec2(cos(ang), sin(ang)) * 0.006;
      vec4 ta = texture2D(morphA, uv + o, uMorphBlur);
      vec4 tb = texture2D(morphB, uv + o, uMorphBlur);
      fa += ta.a;
      fb += tb.a;
      ca += ta.rgb;
      cb += tb.rgb;
    }
    fa /= 8.0;
    fb /= 8.0;
    float mask = smoothstep(0.42, 0.58, mix(fa, fb, uMix));
    // Blend from the exact source shape into the morph and from the morph into the
    // exact target shape — never towards the other shape, so no ghost silhouettes.
    float w = smoothstep(0.0, 0.22, uMix) * smoothstep(1.0, 0.78, uMix);
    float exact = uMix < 0.5 ? colorA.a : colorB.a;
    // Inside the morphing silhouette but outside both shapes: use the blurred colour.
    vec3 rgb = pm.a > 0.03 ? blended.rgb : mix(ca, cb, uMix) / 8.0;
    blended = vec4(rgb, mix(exact, mask, w));
  }
  float shapeAlpha = blended.a;

  // Alpha is a mask only — never draw black RGB from transparent texels
  if (uAlphaCutout > 0.5 && shapeAlpha < 0.02) {
    discard;
  }

  // Additive gloss overlay: specular lacquer + environment reflection
  if (uGlossOverlay > 0.5) {
    if (uGlossStrength <= 0.001 && uReflectStrength <= 0.001) {
      discard;
    }
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(vViewDir);
    vec3 lightDir = normalize(vec3(-0.45, 0.65, 0.85));
    vec3 halfDir = normalize(lightDir + v);
    float shininess = mix(8.0, 64.0, clamp(uGlossSharpness, 0.0, 1.0));
    float spec = pow(max(dot(n, halfDir), 0.0), shininess);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.2);
    float streak = smoothstep(0.55, 0.15, abs(vUv.x * 0.7 + vUv.y * 0.85 - 0.95));
    streak *= mix(0.35, 1.0, clamp(uGlossSharpness, 0.0, 1.0));
    float glow = (spec * 0.7 + fresnel * 0.45 + streak * 0.4) * uGlossStrength;

    // Stage-B env reflection: sample the room photo as a spherical env map
    // Tilt the lookup upward so the studio's ceiling softboxes land on the picture.
    vec3 r = normalize(reflect(-v, n) + vec3(0.0, 0.55, 0.0));
    vec2 envUv = dirToEquirect(r);
    vec3 envA = texture2D(envMapA, envUv).rgb;
    vec3 envB = texture2D(envMapB, envUv).rgb;
    vec3 envColor = mix(envA, envB, uEnvMix);
    // Soft blur-ish: also sample a slightly offset UV for smoother lacquer
    vec2 envUv2 = dirToEquirect(normalize(r + vec3(0.04, 0.02, -0.03)));
    envColor = mix(envColor, mix(texture2D(envMapA, envUv2).rgb, texture2D(envMapB, envUv2).rgb, uEnvMix), 0.35);
    float reflectFresnel = mix(0.28, 1.0, fresnel);
    vec3 reflection = envColor * reflectFresnel * uReflectStrength;

    vec3 outRgb = (vec3(glow) + reflection) * shapeAlpha;
    gl_FragColor = vec4(outRgb, 1.0);
    return;
  }

  float alpha = shapeAlpha * uOpacity;
  float fade = 1.0 - uFadeStrength * (1.0 - vUv.y);
  alpha *= clamp(fade, 0.0, 1.0);

  if (uShadowMode > 0.5) {
    // Silhouette shadow — black only where the shape is; elsewhere discarded
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }

  // uTint < 1 darkens (used for the extruded side walls so the edge reads).
  vec3 rgb = dither(blended.rgb * uTint);
  // Premultiplied so black RGB in fringe texels cannot darken the room
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

export type CrossfadeMaterialOptions = {
  opacity?: number;
  /** RGB multiplier (1 = unchanged). */
  tint?: number;
  fade?: number;
  shadowMode?: number;
  uvBleed?: number;
  glossStrength?: number;
  glossSharpness?: number;
  reflectStrength?: number;
  /** Room textures used as environment for gloss reflection */
  envMapA?: THREE.Texture | null;
  envMapB?: THREE.Texture | null;
  /** Mipmapped copies of textureA/B — enables the silhouette morph. */
  morphA?: THREE.Texture | null;
  morphB?: THREE.Texture | null;
  envMix?: number;
  /** Additive gloss pass — highlight only, masked by picture alpha */
  glossOverlay?: boolean;
  /** Discard near-zero alpha; use premultiplied blending for picture pass */
  alphaCutout?: boolean;
  side?: THREE.Side;
  depthWrite?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
  premultipliedAlpha?: boolean;
};

const FALLBACK_ENV = (() => {
  const data = new Uint8Array([40, 40, 45, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.needsUpdate = true;
  return tex;
})();

export function useCrossfadeMaterial(
  textureA: THREE.Texture,
  textureB: THREE.Texture,
  mix: number,
  options: CrossfadeMaterialOptions = {},
): THREE.ShaderMaterial {
  const side = options.side ?? THREE.FrontSide;
  const depthWrite = options.depthWrite ?? false;
  const depthTest = options.depthTest ?? true;
  const glossOverlay = options.glossOverlay ? 1 : 0;
  const alphaCutout = options.alphaCutout ? 1 : 0;
  const premultipliedAlpha = options.premultipliedAlpha ?? Boolean(options.alphaCutout && !options.glossOverlay && !options.shadowMode);

  let blending: THREE.Blending = options.blending ?? THREE.NormalBlending;
  let blendSrc: THREE.BlendingSrcFactor = THREE.SrcAlphaFactor;
  let blendDst: THREE.BlendingDstFactor = THREE.OneMinusSrcAlphaFactor;
  let blendSrcAlpha: THREE.BlendingSrcFactor | null = null;
  let blendDstAlpha: THREE.BlendingDstFactor | null = null;

  if (options.glossOverlay) {
    blending = THREE.AdditiveBlending;
  } else if (premultipliedAlpha) {
    blending = THREE.CustomBlending;
    blendSrc = THREE.OneFactor;
    blendDst = THREE.OneMinusSrcAlphaFactor;
    blendSrcAlpha = THREE.OneFactor;
    blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          textureA: { value: textureA },
          textureB: { value: textureB },
          morphA: { value: FALLBACK_ENV },
          morphB: { value: FALLBACK_ENV },
          uMorphOn: { value: 0 },
          uMorphBlur: { value: 4.5 },
          envMapA: { value: FALLBACK_ENV },
          envMapB: { value: FALLBACK_ENV },
          uMix: { value: mix },
          uEnvMix: { value: 0 },
          uOpacity: { value: options.opacity ?? 1 },
          uTint: { value: options.tint ?? 1 },
          uFadeStrength: { value: options.fade ?? 0 },
          uShadowMode: { value: options.shadowMode ?? 0 },
          uUvScale: { value: options.uvBleed ?? 1 },
          uUvOffset: { value: (1 - (options.uvBleed ?? 1)) / 2 },
          uGlossStrength: { value: options.glossStrength ?? 0 },
          uGlossSharpness: { value: options.glossSharpness ?? 0.5 },
          uReflectStrength: { value: options.reflectStrength ?? 0 },
          uGlossOverlay: { value: glossOverlay },
          uAlphaCutout: { value: alphaCutout },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        side,
        depthWrite,
        depthTest,
        blending,
        premultipliedAlpha,
        ...(premultipliedAlpha
          ? {
              blendSrc,
              blendDst,
              blendSrcAlpha: blendSrcAlpha ?? undefined,
              blendDstAlpha: blendDstAlpha ?? undefined,
            }
          : {}),
      }),
    // Material instance once; flags applied each render below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  material.uniforms.textureA.value = textureA;
  material.uniforms.textureB.value = textureB;
  material.uniforms.morphA.value = options.morphA ?? FALLBACK_ENV;
  material.uniforms.morphB.value = options.morphB ?? FALLBACK_ENV;
  material.uniforms.uMorphOn.value = options.morphA && options.morphB ? 1 : 0;
  material.uniforms.envMapA.value = options.envMapA ?? FALLBACK_ENV;
  material.uniforms.envMapB.value = options.envMapB ?? FALLBACK_ENV;
  material.uniforms.uMix.value = mix;
  material.uniforms.uEnvMix.value = options.envMix ?? 0;
  material.uniforms.uOpacity.value = options.opacity ?? 1;
  material.uniforms.uTint.value = options.tint ?? 1;
  material.uniforms.uFadeStrength.value = options.fade ?? 0;
  material.uniforms.uShadowMode.value = options.shadowMode ?? 0;
  material.uniforms.uUvScale.value = options.uvBleed ?? 1;
  material.uniforms.uUvOffset.value = (1 - (options.uvBleed ?? 1)) / 2;
  material.uniforms.uGlossStrength.value = options.glossStrength ?? 0;
  material.uniforms.uGlossSharpness.value = options.glossSharpness ?? 0.5;
  material.uniforms.uReflectStrength.value = options.reflectStrength ?? 0;
  material.uniforms.uGlossOverlay.value = glossOverlay;
  material.uniforms.uAlphaCutout.value = alphaCutout;
  material.side = side;
  material.depthWrite = depthWrite;
  material.depthTest = depthTest;
  material.blending = blending;
  material.premultipliedAlpha = premultipliedAlpha;
  if (premultipliedAlpha) {
    material.blendSrc = blendSrc;
    material.blendDst = blendDst;
    if (blendSrcAlpha != null) material.blendSrcAlpha = blendSrcAlpha;
    if (blendDstAlpha != null) material.blendDstAlpha = blendDstAlpha;
  }

  return material;
}
