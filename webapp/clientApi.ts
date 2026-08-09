/** Relative API base — works with Vite proxy in dev and Express static in production. */
export const API_BASE = "";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

/** Resolve media URLs / portable job refs for the Player and thumbnails. */
export function mediaUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (url.startsWith("upload:")) return apiUrl(`/uploads/${url.slice("upload:".length)}`);
  if (url.startsWith("asset:")) return apiUrl(`/assets/${url.slice("asset:".length)}`);
  if (url.startsWith("media:")) return apiUrl(`/media/${encodeURIComponent(url.slice("media:".length))}`);
  return apiUrl(url);
}
