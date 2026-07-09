"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSolverWorker } from "@/lib/useSolverWorker";
import { generateMask, type ShapeKind } from "@/lib/shapes";
import type { SolverFrame } from "@/lib/solver";

// ── magma colormap (bright, high-contrast) ──────────────────
// Dark background → bright yellow/white at high values
function magma(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  // piecewise cubic approximation of matplotlib magma
  const r = t < 0.5
    ? 0.001462 + t * 2 * (0.733068 - 0.001462)
    : 0.733068 + (t - 0.5) * 2 * (0.987053 - 0.733068);
  const g = t < 0.25
    ? 0.000466 + t * 4 * (0.327754 - 0.000466)
    : t < 0.5
      ? 0.327754 + (t - 0.25) * 4 * (0.561235 - 0.327754)
      : t < 0.75
        ? 0.561235 + (t - 0.5) * 4 * (0.849142 - 0.561235)
        : 0.849142 + (t - 0.75) * 4 * (0.995737 - 0.849142);
  const b = t < 0.25
    ? 0.013866 + t * 4 * (0.174267 - 0.013866)
    : t < 0.5
      ? 0.174267 + (t - 0.25) * 4 * (0.350492 - 0.174267)
      : t < 0.75
        ? 0.350492 + (t - 0.5) * 4 * (0.527159 - 0.350492)
        : 0.527159 + (t - 0.75) * 4 * (0.247276 - 0.527159);
  return [r, g, b];
}

// ── render frame to canvas ────────────────────────────────────
function renderFrame(
  ctx: CanvasRenderingContext2D, frame: SolverFrame,
  field: "vorticity" | "speed", w: number, h: number
) {
  const { nx, ny, solidMask } = frame;
  const data = field === "vorticity" ? frame.vorticity : frame.speed;

  let vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (solidMask[i]) continue;
    if (data[i] < vMin) vMin = data[i];
    if (data[i] > vMax) vMax = data[i];
  }
  if (!isFinite(vMin)) { vMin = -1; vMax = 1; }
  const vRange = vMax - vMin || 1;

  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const gi = Math.floor((px / w) * nx);
      const gj = Math.floor(((h - 1 - py) / h) * ny);
      const k = Math.min(gj * nx + gi, data.length - 1);
      const i4 = (py * w + px) * 4;
      if (solidMask[k]) {
        // visible light gray obstacle with subtle edge
        img.data[i4] = 200; img.data[i4+1] = 195; img.data[i4+2] = 210; img.data[i4+3] = 255;
      } else {
        const t = isFinite(data[k]) ? (data[k] - vMin) / vRange : 0.5;
        const [cr, cg, cb] = magma(t);
        img.data[i4] = Math.floor(cr * 255);
        img.data[i4+1] = Math.floor(cg * 255);
        img.data[i4+2] = Math.floor(cb * 255);
        img.data[i4+3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── shape definitions ─────────────────────────────────────────
const SHAPES: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: "circle",  label: "Circle",  icon: "●" },
  { kind: "square",  label: "Square",  icon: "■" },
  { kind: "diamond", label: "Diamond", icon: "◆" },
  { kind: "ellipse", label: "Ellipse", icon: "⬬" },
  { kind: "triangle", label: "Triangle", icon: "▶" },
];

// ── grid defaults ─────────────────────────────────────────────
const NX = 300, NY = 150;
const LX = 4.0, LY = 2.0;

export default function Home() {
  const { running, frames, progress, error, run, cancel } = useSolverWorker();
  const [reynolds, setReynolds] = useState(100);
  const [shape, setShape] = useState<ShapeKind>("circle");
  const [shapeSize, setShapeSize] = useState(0.25);     // characteristic size
  const [shapeAspect, setShapeAspect] = useState(1.5);   // width/height for ellipse/diamond/triangle
  const [shapeX, setShapeX] = useState(1.0);             // center x in domain
  const [field, setField] = useState<"vorticity" | "speed">("vorticity");
  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [recording, setRecording] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // render current frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderFrame(ctx, frames[Math.min(frameIdx, frames.length - 1)], field, canvas.width, canvas.height);
  }, [frames, frameIdx, field]);

  // animation
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    let idx = frameIdx;
    const loop = () => { idx = (idx + 1) % frames.length; setFrameIdx(idx); animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, frames.length]);

  // auto-play on done
  useEffect(() => {
    if (!running && frames.length > 0 && !playing) setPlaying(true);
  }, [running, frames.length, playing]);

  // ── run ───────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    setPlaying(false); setFrameIdx(0);
    const mask = generateMask({
      kind: shape, cx: shapeX, cy: LY / 2, size: shapeSize, aspect: shapeAspect,
      gridNx: NX, gridNy: NY, domainLx: LX, domainLy: LY,
    });
    // transfer the mask to avoid copying
    run({
      reynolds, charLength: shapeSize, solidMask: mask,
      gridNx: NX, gridNy: NY, domainLx: LX, domainLy: LY,
      tEnd: 5.0, nFrames: 60,
    });
  }, [reynolds, shape, shapeSize, shapeAspect, shapeX, run]);

  // ── export ────────────────────────────────────────────────
  const startExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const stream = canvas.captureStream(30);
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `flow-${shape}-re${reynolds}-${field}.webm`;
      a.click(); URL.revokeObjectURL(url);
      setRecording(false);
      stream.getTracks().forEach(t => t.stop());
    };
    setRecording(true); recorder.start();
    let i = 0;
    const ctx = canvas.getContext("2d")!;
    const renderNext = () => {
      if (i >= frames.length) { recorder.stop(); return; }
      renderFrame(ctx, frames[i], field, canvas.width, canvas.height);
      i++; setTimeout(renderNext, 1000 / 30);
    };
    renderNext();
  }, [frames, field, shape, reynolds]);

  const cancelExport = useCallback(() => { mediaRecorderRef.current?.stop(); }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col">
      {/* header */}
      <header className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-bold text-violet-400">🌊 Flow Past Obstacles</h1>
          <p className="text-[11px] text-zinc-500">Navier-Stokes · Chorin projection · In-browser CFD</p>
        </div>
        <span className="text-xs text-zinc-600 font-mono">Re = {reynolds} · {shape} · size={shapeSize.toFixed(2)}</span>
      </header>

      <div className="flex-1 flex">
        {/* canvas */}
        <div className="flex-1 p-3 flex items-center justify-center bg-[#0a0a0f]">
          <canvas ref={canvasRef} width={900} height={450}
            className="w-full max-w-[900px] rounded-lg border border-zinc-800" />
        </div>

        {/* controls */}
        <div className="w-[340px] min-w-[340px] bg-zinc-900 border-l border-zinc-800 p-4 flex flex-col gap-4 overflow-y-auto text-sm">

          {/* Shape selector */}
          <div>
            <label className="font-semibold text-zinc-300">Obstacle Shape</label>
            <div className="grid grid-cols-5 gap-1.5 mt-2">
              {SHAPES.map(s => (
                <button key={s.kind}
                  onClick={() => setShape(s.kind)}
                  disabled={running}
                  className={`py-2 rounded-lg text-sm font-medium transition-all ${
                    shape === s.kind
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                  title={s.label}
                >
                  <span className="text-base">{s.icon}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1 capitalize">{shape}</p>
          </div>

          {/* Size */}
          <div>
            <label className="font-semibold text-zinc-300">Size: {shapeSize.toFixed(2)}</label>
            <input type="range" min={0.05} max={1.0} step={0.01} value={shapeSize}
              onChange={e => setShapeSize(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>0.05</span><span>1.0</span>
            </div>
          </div>

          {/* Aspect ratio (only for non-circle) */}
          {shape !== "circle" && (
            <div>
              <label className="font-semibold text-zinc-300">Aspect (W/H): {shapeAspect.toFixed(1)}</label>
              <input type="range" min={0.3} max={3.0} step={0.1} value={shapeAspect}
                onChange={e => setShapeAspect(Number(e.target.value))}
                disabled={running}
                className="w-full mt-1 accent-violet-500" />
            </div>
          )}

          {/* X position */}
          <div>
            <label className="font-semibold text-zinc-300">Position X: {shapeX.toFixed(2)}</label>
            <input type="range" min={0.3} max={3.0} step={0.05} value={shapeX}
              onChange={e => setShapeX(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
          </div>

          {/* Reynolds */}
          <div>
            <label className="font-semibold text-zinc-300">Reynolds: {reynolds}</label>
            <input type="range" min={5} max={500} step={5} value={reynolds}
              onChange={e => setReynolds(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>Laminar</span><span>Transition</span><span>Turbulent</span>
            </div>
          </div>

          {/* field toggle */}
          <div className="flex gap-2">
            {(["vorticity", "speed"] as const).map(f => (
              <button key={f} onClick={() => setField(f)} disabled={running}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  field === f ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}>
                {f === "vorticity" ? "🌀 Vorticity" : "💨 Speed"}
              </button>
            ))}
          </div>

          {/* Run */}
          <button onClick={running ? cancel : handleRun}
            className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
              running ? "bg-red-600 hover:bg-red-500 text-white"
                      : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20"
            }`}>
            {running ? "⏹ Cancel" : "▶ Run Simulation"}
          </button>

          {/* progress */}
          {running && (
            <div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-violet-400 text-center mt-1">Computing... {progress}%</p>
            </div>
          )}
          {error && <p className="text-red-400 text-xs bg-red-900/20 p-2 rounded-lg">{error}</p>}

          {/* playback */}
          {frames.length > 0 && !running && (
            <>
              <div className="border-t border-zinc-800 pt-3">
                <div className="flex gap-2">
                  <button onClick={() => setPlaying(p => !p)}
                    className="flex-1 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                    {playing ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button onClick={() => { setPlaying(false); setFrameIdx(0); }}
                    className="py-1.5 px-3 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300">⏮</button>
                </div>
                <input type="range" min={0} max={frames.length - 1} value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                  className="w-full mt-1 accent-violet-500" />
                <p className="text-[10px] text-zinc-500 text-center">Frame {frameIdx + 1} / {frames.length}</p>
              </div>
              <button onClick={recording ? cancelExport : startExport}
                className={`w-full py-2.5 rounded-lg text-sm font-bold ${
                  recording ? "bg-amber-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                }`}>
                {recording ? "⏹ Cancel" : "⬇ Export WebM"}
              </button>
              {recording && <p className="text-xs text-amber-400 text-center">Recording...</p>}
            </>
          )}

          {/* info */}
          <div className="border-t border-zinc-800 pt-3 text-[10px] text-zinc-600 space-y-0.5">
            <p>Grid: {NX}×{NY} · Domain: {LX}×{LY}</p>
            <p>Method: Chorin · Jacobi PP · ν=U·D/Re</p>
            <p>Δt: auto (CFL + diffusive limit)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
