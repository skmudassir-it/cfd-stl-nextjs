"use client";

import { useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";
import type { PlaneAxis, SliceResult } from "@/lib/types";

function drawPolygons(
  canvas: HTMLCanvasElement,
  polygons: SliceResult["polygons"]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!polygons.length) {
    ctx.fillStyle = "#71717a";
    ctx.font = "13px sans-serif";
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
  const pad = Math.max(maxU - minU, maxV - minV) * 0.1 || 1;
  minU -= pad; maxU += pad;
  minV -= pad; maxV += pad;

  const scaleX = (rect.width - 30) / (maxU - minU || 1);
  const scaleY = (rect.height - 30) / (maxV - minV || 1);
  const scale = Math.min(scaleX, scaleY);
  const offX = (rect.width - (maxU - minU) * scale) / 2;
  const offY = (rect.height - (maxV - minV) * scale) / 2;

  const tx = (u: number) => offX + (u - minU) * scale;
  const ty = (v: number) => offY + (v - minV) * scale;

  for (const poly of polygons) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(tx(poly[i][0]), ty(poly[i][1]));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(124, 58, 237, 0.3)";
    ctx.fill();
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

export default function SliceControls({
  axis,
  onAxisChange,
  position,
  onPositionChange,
  range,
  sliceResult,
  loading,
}: {
  axis: PlaneAxis;
  onAxisChange: (a: PlaneAxis) => void;
  position: number;
  onPositionChange: (p: number) => void;
  range: [number, number];
  sliceResult: SliceResult | null;
  loading: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && sliceResult) {
      drawPolygons(canvasRef.current, sliceResult.polygons);
    } else if (canvasRef.current) {
      drawPolygons(canvasRef.current, []);
    }
  }, [sliceResult]);

  // drag the canvas to fix DPR on resize
  useEffect(() => {
    const onResize = () => {
      if (canvasRef.current && sliceResult) {
        drawPolygons(canvasRef.current, sliceResult.polygons);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sliceResult]);

  const axes: { key: PlaneAxis; label: string }[] = [
    { key: "z", label: "Z → XY" },
    { key: "y", label: "Y → XZ" },
    { key: "x", label: "X → YZ" },
  ];

  const frac = range[1] !== range[0]
    ? ((position - range[0]) / (range[1] - range[0])) * 100
    : 50;

  return (
    <div className="space-y-4">
      {/* axis buttons */}
      <div className="flex gap-2">
        {axes.map((a) => (
          <button
            key={a.key}
            onClick={() => onAxisChange(a.key)}
            className={`
              flex-1 py-2 rounded-lg text-sm font-semibold transition-all
              ${
                axis === a.key
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-600/20"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500"
              }
            `}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* slider */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Position: {position.toFixed(3)}</span>
          <span>
            [{range[0].toFixed(2)}, {range[1].toFixed(2)}]
          </span>
        </div>
        <Slider
          defaultValue={[frac]}
          onValueChange={(value) => {
            const v = Array.isArray(value) ? value[0] : value;
            const p = range[0] + (v / 100) * (range[1] - range[0]);
            onPositionChange(p);
          }}
          min={0}
          max={100}
          step={0.5}
          className="cursor-pointer"
          disabled={loading}
        />
      </div>

      {/* 2D preview canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-44 bg-zinc-950 rounded-lg border border-zinc-800"
      />
      {sliceResult && (
        <p className="text-xs text-zinc-500">
          {sliceResult.num_polygons} polygon
          {sliceResult.num_polygons !== 1 ? "s" : ""} at{" "}
          {axis.toUpperCase()} = {sliceResult.position.toFixed(3)}
        </p>
      )}
    </div>
  );
}
