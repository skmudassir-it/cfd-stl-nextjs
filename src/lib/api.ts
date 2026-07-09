// API client — uses Next.js rewrites so calls work from same origin.
// Local dev: /api/upload → http://localhost:5050/upload (via next.config.ts rewrite)
// Deployed: NEXT_PUBLIC_API_URL must point to a public Flask backend.

import type {
  StlBounds,
  SliceResult,
  CfdParams,
  CfdResult,
  PlaneAxis,
} from "./types";

const API = ""; // relative — uses Next.js rewrites

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function uploadStl(file: File): Promise<StlBounds> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<StlBounds>("/api/upload", {
    method: "POST",
    body: formData,
  });
}

export async function sliceMesh(
  sessionId: string,
  axis: PlaneAxis,
  position: number
): Promise<SliceResult> {
  return apiFetch<SliceResult>("/api/slice", {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      axis,
      position,
    }),
  });
}

export async function runSimulation(
  params: CfdParams
): Promise<CfdResult> {
  return apiFetch<CfdResult>("/api/simulate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function resultUrl(relative: string): string {
  if (relative.startsWith("http")) return relative;
  // strip /api prefix for static files
  const path = relative.replace("/api", "");
  return path;
}
