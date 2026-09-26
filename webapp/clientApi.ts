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
