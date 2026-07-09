"use client";

import { useRef, useEffect } from "react";
import type { SlicePoint } from "@/lib/types";

function drawPolygons(
  canvas: HTMLCanvasElement,
  polygons: SlicePoint[][]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  // dark background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (!polygons.length) {
    ctx.fillStyle = "#71717a";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "No cross-section at this position",
      rect.width / 2,
      rect.height / 2
    );
    return;
  }

  // compute bounds
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const poly of polygons) {
    for (const [u, v] of poly) {
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
  }
  const rangeU = maxU - minU || 1;
  const rangeV = maxV - minV || 1;
  const padU = rangeU * 0.1;
  const padV = rangeV * 0.1;
  minU -= padU; maxU += padU;
  minV -= padV; maxV += padV;

  const scaleX = (rect.width - 40) / ((maxU - minU) || 1);
  const scaleY = (rect.height - 40) / ((maxV - minV) || 1);
  const scale = Math.min(scaleX, scaleY);
  const offX = (rect.width - (maxU - minU) * scale) / 2;
  const offY = (rect.height - (maxV - minV) * scale) / 2;

  const tx = (u: number) => offX + (u - minU) * scale;
  const ty = (v: number) => offY + (v - minV) * scale;

  // grid
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 0.5;
  const gridStep = Math.pow(10, Math.floor(Math.log10(rangeU))) / 2;
  for (let g = Math.floor(minU / gridStep) * gridStep; g <= maxU; g += gridStep) {
    const x = tx(g);
    ctx.beginPath(); ctx.moveTo(x, offY); ctx.lineTo(x, rect.height - offY); ctx.stroke();
  }
  for (let g = Math.floor(minV / gridStep) * gridStep; g <= maxV; g += gridStep) {
    const y = ty(g);
    ctx.beginPath(); ctx.moveTo(offX, y); ctx.lineTo(rect.width - offX, y); ctx.stroke();
  }

  // polygons
  for (const poly of polygons) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(tx(poly[i][0]), ty(poly[i][1]));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(124, 58, 237, 0.25)";
    ctx.fill();
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export default function Slice2DView({
  polygons,
  axis,
  position,
}: {
  polygons: SlicePoint[][];
  axis: string;
  position: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      drawPolygons(canvasRef.current, polygons);
    }
  }, [polygons]);

  useEffect(() => {
    const onResize = () => {
      if (canvasRef.current) {
        drawPolygons(canvasRef.current, polygons);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [polygons]);

  const axisLabel = axis.toUpperCase();
  const coordLabels: Record<string, [string, string]> = {
    x: ["Y", "Z"],
    y: ["X", "Z"],
    z: ["X", "Y"],
  };
  const [labelU, labelV] = coordLabels[axis] || ["U", "V"];

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="text-sm font-semibold text-zinc-300">
          📐 Cross-Section ({labelU}‑{labelV} plane)
        </span>
        <span className="text-xs text-zinc-500 font-mono">
          {axisLabel} = {position.toFixed(3)}
        </span>
      </div>
      {/* canvas */}
      <div className="flex-1 p-3 min-h-0">
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-md"
        />
      </div>
    </div>
  );
}
