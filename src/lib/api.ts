// API client for the Python Flask CFD backend
// Set NEXT_PUBLIC_API_URL to the Flask server URL (default: localhost:5050)

import type {
  StlBounds,
  SliceResult,
  CfdParams,
  CfdResult,
  PlaneAxis,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5050";

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
  return apiFetch<StlBounds>("/upload", {
    method: "POST",
    body: formData,
  });
}

export async function sliceMesh(
  sessionId: string,
  axis: PlaneAxis,
  position: number
): Promise<SliceResult> {
  return apiFetch<SliceResult>("/slice", {
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
  return apiFetch<CfdResult>("/simulate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function resultUrl(relative: string): string {
  if (relative.startsWith("http")) return relative;
  return `${API_BASE}${relative}`;
}
