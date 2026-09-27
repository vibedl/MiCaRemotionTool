/**
 * Finds the free wall area in a room photo: the largest axis-aligned
 * rectangle of calm, wall-coloured pixels. Furniture, plants, frames, the
 * floor and the ceiling line all have edges/texture or a different colour,
 * so they fall outside. Wall pictures are then fitted into this rectangle so
 * they never overlap furniture.
 *
 * Pure function on RGBA pixels (a small downscaled copy is enough).
 */
import type { AlphaBounds } from "./autoBuild";

export function detectFreeWall(data: Uint8ClampedArray | number[], w: number, h: number): AlphaBounds | null {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  }

  // Edge strength, then a small blur so thin structures (cables, frame lines) count too.
  const grad = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      grad[i] = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
    }
  }
  const blurred = boxBlur(grad, w, h, 2);

  // Reference wall colour: median of calm pixels in the upper middle of the photo.
  const samples: number[][] = [];
  for (let y = Math.floor(h * 0.12); y < h * 0.5; y++) {
    for (let x = Math.floor(w * 0.25); x < w * 0.75; x++) {
      const i = y * w + x;
      if (blurred[i] < 0.02) samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
  }
  if (samples.length < 20) return null;
  const ref = [0, 1, 2].map((c) => median(samples.map((s) => s[c])));

  // Wall mask: calm AND close to the wall colour (soft light gradients on the wall are fine).
  let wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dr = data[i * 4] - ref[0];
    const dg = data[i * 4 + 1] - ref[1];
    const db = data[i * 4 + 2] - ref[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    wall[i] = blurred[i] < 0.035 && dist < 60 ? 1 : 0;
  }
  // Keep a margin to furniture: erode the wall mask.
  wall = erode(wall, w, h, Math.max(2, Math.round(w / 40)));

  const rect = largestRectangle(wall, w, h);
  if (!rect) return null;
  return { x0: rect.x0 / w, y0: rect.y0 / h, x1: rect.x1 / w, y1: rect.y1 / h };
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += src[yy * w + xx];
          count++;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

function erode(mask: Uint8Array, w: number, h: number, r: number) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

/**
 * Best all-ones rectangle (histogram / stack method over all maximal
 * rectangles). Scored by area, penalising thin strips — a wall picture needs
 * a roughly picture-shaped spot. Coordinates are exclusive at x1/y1.
 */
function largestRectangle(mask: Uint8Array, w: number, h: number) {
  const heights = new Array(w).fill(0);
  let best: { x0: number; y0: number; x1: number; y1: number; score: number } | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? heights[x] + 1 : 0;
    const stack: number[] = [];
    for (let x = 0; x <= w; x++) {
      const cur = x === w ? 0 : heights[x];
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = x - left;
        const aspect = width / Math.max(1, height);
        const score = height * width * Math.sqrt(Math.min(aspect, 1 / aspect));
        if (height > 0 && width > 0 && (!best || score > best.score)) {
          best = { x0: left, x1: x, y0: y - height + 1, y1: y + 1, score };
        }
      }
      stack.push(x);
    }
  }
  return best;
}
