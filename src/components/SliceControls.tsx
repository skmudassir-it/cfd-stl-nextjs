"use client";

import { Slider } from "@/components/ui/slider";
import type { PlaneAxis, SliceResult } from "@/lib/types";

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

      {/* polygon count */}
      {sliceResult && (
        <p className="text-xs text-zinc-500">
          {sliceResult.num_polygons} polygon
          {sliceResult.num_polygons !== 1 ? "s" : ""} at{" "}
          {axis.toUpperCase()} = {sliceResult.position.toFixed(3)}
        </p>
      )}
      {sliceResult && sliceResult.num_polygons === 0 && (
        <p className="text-xs text-amber-500">
          ⚠️ No cross-section at this position — try another plane
        </p>
      )}
    </div>
  );
}
