"use client";

import { useEffect, useRef } from "react";
import type { CfdFrame } from "@/lib/cfd-solver";

/**
 * Renders CFD frame data (vorticity) to a canvas.
 */
export function renderFrame(
  canvas: HTMLCanvasElement,
  frame: CfdFrame
) {
  const { width, height, data, solidMask } = frame;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imgData = ctx.createImageData(width, height);

  // find max |vorticity| for color scale
  let vmax = 0;
  for (let i = 0; i < data.length; i++) {
    if (solidMask[i]) continue;
    vmax = Math.max(vmax, Math.abs(data[i]));
  }
  if (vmax === 0) vmax = 1;

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = j * width + i;
      const pixelIdx = ((height - 1 - j) * width + i) * 4; // flip Y

      if (solidMask[idx]) {
        imgData.data[pixelIdx] = 30;
        imgData.data[pixelIdx + 1] = 30;
        imgData.data[pixelIdx + 2] = 30;
        imgData.data[pixelIdx + 3] = 255;
        continue;
      }

      const val = data[idx] / vmax; // [-1, 1]
      // RdBu_r: red for positive (CCW), blue for negative (CW)
      const t = (val + 1) / 2; // [0, 1]
      const r = Math.round(lerp(33, 178, ease(t)));
      const g = Math.round(lerp(102, 24, ease(t)));
      const b = Math.round(lerp(172, 43, ease(t)));

      imgData.data[pixelIdx] = r;
      imgData.data[pixelIdx + 1] = g;
      imgData.data[pixelIdx + 2] = b;
      imgData.data[pixelIdx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function ease(t: number) { return t; } // linear color scale

// ── Results component ──────────────────────────────────────────

export default function CfdResults({
  frames,
  domain,
}: {
  frames: CfdFrame[];
  domain: [number, number, number, number];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIdxRef = useRef(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!frames.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let idx = 0;
    const animate = () => {
      renderFrame(canvas, frames[idx]);
      idx = (idx + 1) % frames.length;
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [frames]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950"
        style={{ aspectRatio: `${frames[0]?.width || 4} / ${frames[0]?.height || 1}` }}
      />
      <p className="text-xs text-zinc-500 text-center">
        {frames.length} frames · {frames[0]?.width || 0}×{frames[0]?.height || 0} grid
        · Red=CCW · Blue=CW
      </p>
    </div>
  );
}
