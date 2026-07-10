"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSolverWorker } from "@/lib/useSolverWorker";
import { generateMask, type ShapeKind } from "@/lib/shapes";
import type { SolverFrame } from "@/lib/solver";
import type { FlowDir } from "@/lib/solver";

// ── dual colormap ────────────────────────────────────────────
// Diverging blue→white→red for vorticity (t in [-1, 1])
function diverging(t: number): [number, number, number] {
  t = Math.max(-1, Math.min(1, t));
  let r: number, g: number, b: number;
  if (t < 0) {
    const a = t + 1;
    r = 33 + (247 - 33) * a;
    g = 102 + (247 - 102) * a;
    b = 172 + (247 - 172) * a;
  } else {
    r = 247 + (178 - 247) * t;
    g = 247 + (24 - 247) * t;
    b = 247 + (43 - 247) * t;
  }
  return [r / 255, g / 255, b / 255];
}
// Magma for speed (t in [0, 1])
function magma(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const stops = [[13,8,135],[126,3,168],[204,71,120],[248,149,64],[240,249,33]];
  const x = t * (stops.length - 1), i = Math.floor(x), f = x - i;
  const A = stops[i], B = stops[Math.min(i + 1, stops.length - 1)];
  return [(A[0] + (B[0] - A[0]) * f) / 255, (A[1] + (B[1] - A[1]) * f) / 255, (A[2] + (B[2] - A[2]) * f) / 255];
}

// ── render frame to canvas (smooth upscaling) ────────────────
function renderFrame(
  ctx: CanvasRenderingContext2D, frame: SolverFrame,
  field: "vorticity" | "speed", canvasW: number, canvasH: number
) {
  const { nx, ny, solidMask } = frame;
  const data = field === "vorticity" ? frame.vorticity : frame.speed;
  const isVort = field === "vorticity";

  // range: symmetric for vorticity, 0→max for speed
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (solidMask[i]) continue;
    if (data[i] < vMin) vMin = data[i];
    if (data[i] > vMax) vMax = data[i];
  }
  if (isVort) { const m = Math.max(Math.abs(vMin), Math.abs(vMax)) || 1; vMin = -m; vMax = m; }
  else { if (!isFinite(vMin)) { vMin = 0; vMax = 1; } vMin = 0; }
  const vRange = vMax - vMin || 1;

  // render at grid resolution, then upscale
  const img = new ImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const o = ((ny - 1 - j) * nx + i) * 4;
      if (solidMask[k]) {
        img.data[o] = 60; img.data[o + 1] = 60; img.data[o + 2] = 65; img.data[o + 3] = 255;
      } else {
        const val = data[k];
        const t = isFinite(val) ? (val - vMin) / vRange : 0.5;
        const [cr, cg, cb] = isVort ? diverging(t * 2 - 1) : magma(t);
        img.data[o] = Math.floor(cr * 255);
        img.data[o + 1] = Math.floor(cg * 255);
        img.data[o + 2] = Math.floor(cb * 255);
        img.data[o + 3] = 255;
      }
    }
  }
  // smooth upscale via temp canvas
  const tmp = document.createElement("canvas");
  tmp.width = nx; tmp.height = ny;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.drawImage(tmp, 0, 0, canvasW, canvasH);
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
  const [flowDir, setFlowDir] = useState<FlowDir>("+x");
  const [inflowSpeed, setInflowSpeed] = useState(1.0);
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
      reynolds, inflowSpeed, flowDir, charLength: shapeSize, solidMask: mask,
      gridNx: NX, gridNy: NY, domainLx: LX, domainLy: LY,
      tEnd: 5.0, nFrames: 60,
    });
  }, [reynolds, shape, shapeSize, shapeAspect, shapeX, inflowSpeed, flowDir, run]);

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
    <div className="min-h-screen bg-white text-gray-800 flex flex-col">
      {/* header */}
      <header className="px-6 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-bold text-violet-600">🌊 Flow Past Obstacles</h1>
          <p className="text-[11px] text-gray-400">Navier-Stokes · Chorin projection · In-browser CFD</p>
        </div>
        <span className="text-xs text-gray-400 font-mono">Re = {reynolds} · {shape} · size={shapeSize.toFixed(2)}</span>
      </header>

      <div className="flex-1 flex">
        {/* canvas */}
        <div className="flex-1 p-3 flex items-center justify-center bg-gray-50">
          <canvas ref={canvasRef} width={900} height={450}
            className="w-full max-w-[900px] rounded-lg border border-gray-200 bg-white shadow-sm" />
        </div>

        {/* controls */}
        <div className="w-[340px] min-w-[340px] bg-gray-50 border-l border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto text-sm">

          {/* Shape selector */}
          <div>
            <label className="font-semibold text-gray-700">Obstacle Shape</label>
            <div className="grid grid-cols-5 gap-1.5 mt-2">
              {SHAPES.map(s => (
                <button key={s.kind}
                  onClick={() => setShape(s.kind)}
                  disabled={running}
                  className={`py-2 rounded-lg text-sm font-medium transition-all ${
                    shape === s.kind
                      ? "bg-violet-600 text-white"
                      : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                  }`}
                  title={s.label}
                >
                  <span className="text-base">{s.icon}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1 capitalize">{shape}</p>
          </div>

          {/* Size */}
          <div>
            <label className="font-semibold text-gray-700">Size: {shapeSize.toFixed(2)}</label>
            <input type="range" min={0.05} max={1.0} step={0.01} value={shapeSize}
              onChange={e => setShapeSize(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>0.05</span><span>1.0</span>
            </div>
          </div>

          {/* Aspect ratio (only for non-circle) */}
          {shape !== "circle" && (
            <div>
              <label className="font-semibold text-gray-700">Aspect (W/H): {shapeAspect.toFixed(1)}</label>
              <input type="range" min={0.3} max={3.0} step={0.1} value={shapeAspect}
                onChange={e => setShapeAspect(Number(e.target.value))}
                disabled={running}
                className="w-full mt-1 accent-violet-500" />
            </div>
          )}

          {/* X position */}
          <div>
            <label className="font-semibold text-gray-700">Position X: {shapeX.toFixed(2)}</label>
            <input type="range" min={0.3} max={3.0} step={0.05} value={shapeX}
              onChange={e => setShapeX(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
          </div>

          {/* Reynolds */}
          <div>
            <label className="font-semibold text-gray-700">Reynolds: {reynolds}</label>
            <input type="range" min={5} max={500} step={5} value={reynolds}
              onChange={e => setReynolds(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Laminar</span><span>Transition</span><span>Turbulent</span>
            </div>
          </div>

          {/* field toggle */}
          <div className="flex gap-2">
            {(["vorticity", "speed"] as const).map(f => (
              <button key={f} onClick={() => setField(f)} disabled={running}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  field === f ? "bg-violet-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                }`}>
                {f === "vorticity" ? "🌀 Vorticity" : "💨 Speed"}
              </button>
            ))}
          </div>

          {/* Flow direction */}
          <div>
            <label className="font-semibold text-gray-700">Flow Direction</label>
            <div className="grid grid-cols-4 gap-1 mt-2">
              {([["+x","→"],["-x","←"],["+y","↑"],["-y","↓"]] as [FlowDir, string][]).map(([d, icon]) => (
                <button key={d} onClick={() => setFlowDir(d)} disabled={running}
                  className={`py-2 rounded-lg text-sm font-bold transition-all ${
                    flowDir === d ? "bg-violet-600 text-white" : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                  }`}>{icon}</button>
              ))}
            </div>
          </div>

          {/* Inflow speed */}
          <div>
            <label className="font-semibold text-gray-700">Inflow Speed: {inflowSpeed.toFixed(1)}</label>
            <input type="range" min={0.1} max={3.0} step={0.1} value={inflowSpeed}
              onChange={e => setInflowSpeed(Number(e.target.value))}
              disabled={running}
              className="w-full mt-1 accent-violet-500" />
          </div>

          {/* Run */}
          <button onClick={running ? cancel : handleRun}
            className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
              running ? "bg-red-500 hover:bg-red-400 text-white"
                      : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20"
            }`}>
            {running ? "⏹ Cancel" : "▶ Run Simulation"}
          </button>

          {/* progress */}
          {running && (
            <div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-violet-600 text-center mt-1">Computing... {progress}%</p>
            </div>
          )}
          {error && <p className="text-red-600 text-xs bg-red-50 p-2 rounded-lg border border-red-200">{error}</p>}

          {/* playback */}
          {frames.length > 0 && !running && (
            <>
              <div className="border-t border-gray-200 pt-3">
                <div className="flex gap-2">
                  <button onClick={() => setPlaying(p => !p)}
                    className="flex-1 py-1.5 rounded-lg text-xs bg-white hover:bg-gray-100 text-gray-700 border border-gray-200">
                    {playing ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button onClick={() => { setPlaying(false); setFrameIdx(0); }}
                    className="py-1.5 px-3 rounded-lg text-xs bg-white hover:bg-gray-100 text-gray-700 border border-gray-200">⏮</button>
                </div>
                <input type="range" min={0} max={frames.length - 1} value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                  className="w-full mt-1 accent-violet-500" />
                <p className="text-[10px] text-gray-400 text-center">Frame {frameIdx + 1} / {frames.length}</p>
              </div>
              <button onClick={recording ? cancelExport : startExport}
                className={`w-full py-2.5 rounded-lg text-sm font-bold ${
                  recording ? "bg-amber-500 text-white" : "bg-white hover:bg-gray-100 text-gray-700 border border-gray-200"
                }`}>
                {recording ? "⏹ Cancel" : "⬇ Export WebM"}
              </button>
              {recording && <p className="text-xs text-amber-600 text-center">Recording...</p>}
            </>
          )}

          {/* info */}
          <div className="border-t border-gray-200 pt-3 text-[10px] text-gray-400 space-y-0.5">
            <p>Grid: {NX}×{NY} · Domain: {LX}×{LY}</p>
            <p>Method: Chorin · Jacobi PP · ν=U·D/Re</p>
            <p>Δt: auto (CFL + diffusive limit)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
