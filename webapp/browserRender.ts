import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { RoomFlythrough, type RoomFlythroughProps } from "../src/RoomFlythrough";
import { COMPOSITION_ID, FPS, HEIGHT, WIDTH } from "../src/constants";

export type BrowserRenderResult = { blob: Blob; extension: "mp4" | "webm" };

/**
 * Renders the video entirely in the visitor's browser (WebCodecs) — no
 * server needed, so the Studio also works as a static site (GitHub Pages).
 * Prefers MP4/H.264 and falls back to WebM/VP9 where the browser has no
 * H.264 encoder.
 */
export async function renderInBrowser(
  job: RoomFlythroughProps,
  durationInFrames: number,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<BrowserRenderResult> {
  const candidates = [
    { container: "mp4", videoCodec: "h264", extension: "mp4" },
    { container: "webm", videoCodec: "vp9", extension: "webm" },
    { container: "webm", videoCodec: "vp8", extension: "webm" },
  ] as const;

  let chosen: (typeof candidates)[number] | null = null;
  const problems: string[] = [];
  for (const c of candidates) {
    const check = await canRenderMediaOnWeb({
      container: c.container,
      videoCodec: c.videoCodec,
      width: WIDTH,
      height: HEIGHT,
      muted: true,
    });
    if (check.canRender) {
      chosen = c;
      break;
    }
    problems.push(...check.issues.filter((i) => i.severity === "error").map((i) => i.message));
  }
  if (!chosen) {
    throw new Error(
      `Dieser Browser kann keine Videos rendern (${[...new Set(problems)].join("; ")}). Bitte aktuelles Chrome oder Edge verwenden.`,
    );
  }

  const result = await renderMediaOnWeb({
    composition: {
      id: COMPOSITION_ID,
      component: RoomFlythrough,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      durationInFrames,
      defaultProps: job,
    },
    inputProps: job,
    container: chosen.container,
    videoCodec: chosen.videoCodec,
    videoBitrate: "high",
    muted: true,
    signal: signal ?? null,
    // Remotion license: set VITE_REMOTION_LICENSE_KEY at build time ("free-license" if you qualify,
    // see https://remotion.dev/license). Without it the renderer only logs a console notice.
    licenseKey: import.meta.env.VITE_REMOTION_LICENSE_KEY || null,
    onProgress: (p) => onProgress(Math.round(p.progress * 100)),
  });

  return { blob: await result.getBlob(), extension: chosen.extension };
}
