/** Relative API base — works with Vite proxy in dev and Express static in production. */
export const API_BASE = "";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

/** Resolve media URLs returned by the server (relative paths) for the Player. */
export function mediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

export type UploadedImage = { label: string; url: string };

export async function uploadFile(file: File): Promise<UploadedImage> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl("/api/upload"), { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload fehlgeschlagen");
  return data;
}

export type ServerConfig = { serverFs: boolean; maxUploadMb: number };

let serverPromise: Promise<ServerConfig | null> | null = null;

/**
 * `null` = no backend (static hosting such as GitHub Pages): images stay in
 * the browser and videos are rendered in the browser.
 */
export function detectServer(): Promise<ServerConfig | null> {
  if (!serverPromise) {
    serverPromise = fetch(apiUrl("/api/config"))
      .then(async (res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
        const data = await res.json();
        return { serverFs: Boolean(data.serverFs), maxUploadMb: Number(data.maxUploadMb) || 40 };
      })
      .catch(() => null);
  }
  return serverPromise;
}

/** Upload to the server when there is one, otherwise keep the image in the browser. */
export async function storeImage(file: File): Promise<{ label: string; src: string }> {
  const server = await detectServer();
  if (server) {
    const uploaded = await uploadFile(file);
    return { label: uploaded.label, src: mediaUrl(uploaded.url) };
  }
  return { label: file.name.replace(/\.[^.]+$/, ""), src: URL.createObjectURL(file) };
}

/**
 * Bundled demo assets: `staticFile()` yields root-absolute `/assets/…`, which
 * breaks when the app is served from a sub-path (GitHub Pages). Relative to
 * the page they resolve everywhere.
 */
export function portableAssetSrc(src: string): string {
  return src.startsWith("/assets/") ? `.${src}` : src;
}

/** Blob URLs die with the tab — inline them so a saved project file is self-contained. */
export async function inlineBlobSrc(src: string): Promise<string> {
  if (!src.startsWith("blob:")) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
