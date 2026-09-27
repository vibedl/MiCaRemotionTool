import type { AlphaBounds } from "../src/autoBuild";
import { detectFreeWall } from "../src/wallDetect";

export type ImageInfo = {
  width: number;
  height: number;
  hasTransparency: boolean;
  bounds?: AlphaBounds;
  freeWall?: AlphaBounds;
};

const WALL_SCAN_SIZE = 128;

function freeWallOf(img: HTMLImageElement): AlphaBounds | null {
  const canvas = document.createElement("canvas");
  canvas.width = WALL_SCAN_SIZE;
  canvas.height = WALL_SCAN_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, WALL_SCAN_SIZE, WALL_SCAN_SIZE);
  return detectFreeWall(ctx.getImageData(0, 0, WALL_SCAN_SIZE, WALL_SCAN_SIZE).data, WALL_SCAN_SIZE, WALL_SCAN_SIZE);
}

/** Longest side of the downscaled copy used for the alpha scan. */
const SCAN_SIZE = 256;
/** Share of (nearly) transparent pixels above which an image counts as a cut-out / mask. */
const TRANSPARENT_SHARE = 0.01;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    img.src = url;
  });
}

/**
 * Reads size and transparency of a dropped image locally (before/while it
 * uploads). Rooms are opaque photos; wall pictures are PNG masks with a
 * transparent surrounding — that difference drives the auto classification.
 */
export async function analyzeImageFile(file: File): Promise<ImageInfo> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const opaque = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);

    const k = Math.min(1, SCAN_SIZE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { width, height, hasTransparency: false };
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    let transparent = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a < 250) transparent++;
        if (a > 20) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }

    const hasTransparency = !opaque && transparent / (w * h) > TRANSPARENT_SHARE;
    if (!hasTransparency) {
      // Opaque photo = room: find where pictures may hang (no furniture).
      return { width, height, hasTransparency, freeWall: freeWallOf(img) ?? undefined };
    }
    if (x1 < 0) return { width, height, hasTransparency };
    return {
      width,
      height,
      hasTransparency,
      bounds: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
