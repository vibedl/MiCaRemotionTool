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
