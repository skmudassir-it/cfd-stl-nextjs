"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSolverWorker } from "@/lib/useSolverWorker";
import type { SolverFrame } from "@/lib/solver";

// ── viridis colormap (piecewise linear, 256 stops) ──────────────
function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const r = t < 0.5
    ? 0.267004 + t * 2 * (0.282623 - 0.267004)
    : 0.282623 + (t - 0.5) * 2 * (0.993248 - 0.282623);
  const g = t < 0.25
    ? 0.004874 + t * 4 * (0.531580 - 0.004874)
    : t < 0.5
      ? 0.531580 + (t - 0.25) * 4 * (0.751884 - 0.531580)
      : t < 0.75
        ? 0.751884 + (t - 0.5) * 4 * (0.940015 - 0.751884)
        : 0.940015 + (t - 0.75) * 4 * (0.873149 - 0.940015);
  const b = t < 0.5
    ? 0.329415 + t * 2 * (0.127568 - 0.329415)
    : 0.127568 + (t - 0.5) * 2 * (0.373549 - 0.127568);
  return [r, g, b];
}

// ── render a solver frame to canvas ─────────────────────────────
function renderFrame(
  ctx: CanvasRenderingContext2D,
  frame: SolverFrame,
  field: "vorticity" | "speed",
  w: number, h: number
) {
  const { nx, ny, solidMask } = frame;
  const data = field === "vorticity" ? frame.vorticity : frame.speed;

  // compute value range (skip NaN in solids)
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
      // map pixel → grid index (flip y for image coords)
      const gi = Math.floor((px / w) * nx);
      const gj = Math.floor(((h - 1 - py) / h) * ny);
      const k = Math.min(gj * nx + gi, data.length - 1);
      const idx4 = (py * w + px) * 4;

      if (solidMask[k]) {
        img.data[idx4] = 20; img.data[idx4 + 1] = 20; img.data[idx4 + 2] = 30; img.data[idx4 + 3] = 255;
      } else {
        const val = data[k];
        const t = isFinite(val) ? (val - vMin) / vRange : 0.5;
        const [r, g, b] = viridis(t);
        img.data[idx4]     = Math.floor(r * 255);
        img.data[idx4 + 1] = Math.floor(g * 255);
        img.data[idx4 + 2] = Math.floor(b * 255);
        img.data[idx4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── defaults ────────────────────────────────────────────────────
const DEFAULTS = {
  reynolds: 100,
  gridNx: 200,
  gridNy: 100,
  domainLx: 4.0,
  domainLy: 2.0,
  cylinderX: 1.0,
  cylinderY: 1.0,
  cylinderD: 0.2,
  tEnd: 5.0,
  nFrames: 60,
};

export default function Home() {
  const { running, frames, progress, error, run, cancel } = useSolverWorker();
  const [reynolds, setReynolds] = useState(DEFAULTS.reynolds);
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

  // animation loop
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    let idx = frameIdx;
    const loop = () => {
      idx = (idx + 1) % frames.length;
      setFrameIdx(idx);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, frames.length]);

  // auto-play when simulation finishes
  useEffect(() => {
    if (!running && frames.length > 0 && !playing) setPlaying(true);
  }, [running, frames.length, playing]);

  const handleRun = useCallback(() => {
    setPlaying(false);
    setFrameIdx(0);
    run({ ...DEFAULTS, reynolds, gridNx: 300, gridNy: 150 });
  }, [reynolds, run]);

  // ── video export via MediaRecorder ─────────────────────────
  const startExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;

    const stream = canvas.captureStream(30);
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-re${reynolds}-${field}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
      stream.getTracks().forEach(t => t.stop());
    };

    setRecording(true);
    recorder.start();

    // render each frame to canvas while recording
    let i = 0;
    const ctx = canvas.getContext("2d")!;
    const renderNext = () => {
      if (i >= frames.length) { recorder.stop(); return; }
      renderFrame(ctx, frames[i], field, canvas.width, canvas.height);
      i++;
      setTimeout(renderNext, 1000 / 30);
    };
    renderNext();
  }, [frames, field, reynolds]);

  const cancelExport = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col">
      {/* header */}
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-violet-400">🌊 Flow Past a Cylinder</h1>
          <p className="text-xs text-zinc-500">Incompressible Navier-Stokes · Chorin projection · In-browser CFD</p>
        </div>
        <div className="flex gap-3 items-center">
          <span className="text-xs text-zinc-600">Re = {reynolds}</span>
        </div>
      </header>

      {/* main */}
      <div className="flex-1 flex">
        {/* left: canvas */}
        <div className="flex-1 p-4 flex items-center justify-center bg-[#0a0a0f]">
          <canvas
            ref={canvasRef}
            width={900}
            height={450}
            className="w-full max-w-[900px] rounded-lg border border-zinc-800"
          />
        </div>

        {/* right: controls */}
        <div className="w-[360px] min-w-[360px] bg-zinc-900 border-l border-zinc-800 p-5 flex flex-col gap-5 overflow-y-auto">
          {/* Reynolds */}
          <div>
            <label className="text-sm font-semibold text-zinc-300">Reynolds Number</label>
            <div className="flex items-center gap-3 mt-2">
              <input
                type="range" min={10} max={500} step={5} value={reynolds}
                onChange={e => setReynolds(Number(e.target.value))}
                disabled={running}
                className="flex-1 accent-violet-500"
              />
              <span className="text-sm font-mono text-violet-400 w-12 text-right">{reynolds}</span>
            </div>
            <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
              <span>Laminar</span><span>Transitional</span><span>Turbulent</span>
            </div>
          </div>

          {/* field toggle */}
          <div>
            <label className="text-sm font-semibold text-zinc-300">Field</label>
            <div className="flex gap-2 mt-2">
              {(["vorticity", "speed"] as const).map(f => (
                <button key={f}
                  onClick={() => setField(f)}
                  disabled={running}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                    field === f
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {f === "vorticity" ? "🌀 Vorticity" : "💨 Speed"}
                </button>
              ))}
            </div>
          </div>

          {/* run / cancel */}
          <button
            onClick={running ? cancel : handleRun}
            className={`w-full py-3 rounded-lg text-sm font-bold transition-all ${
              running
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20"
            }`}
          >
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

          {error && <p className="text-red-400 text-sm bg-red-900/20 p-3 rounded-lg">{error}</p>}

          {/* playback */}
          {frames.length > 0 && !running && (
            <>
              <div className="border-t border-zinc-800 pt-4">
                <label className="text-sm font-semibold text-zinc-300">Playback</label>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setPlaying(p => !p)}
                    className="flex-1 py-2 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                    {playing ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button onClick={() => { setPlaying(false); setFrameIdx(0); }}
                    className="py-2 px-4 rounded-lg text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                    ⏮
                  </button>
                </div>
                <input type="range" min={0} max={frames.length - 1} value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                  className="w-full mt-2 accent-violet-500" />
                <p className="text-xs text-zinc-500 text-center mt-1">
                  Frame {frameIdx + 1} / {frames.length}
                </p>
              </div>

              {/* export */}
              <button onClick={recording ? cancelExport : startExport}
                className={`w-full py-3 rounded-lg text-sm font-bold transition-all ${
                  recording
                    ? "bg-amber-600 text-white"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                }`}>
                {recording ? "⏹ Cancel Export" : "⬇ Export as WebM Video"}
              </button>
              {recording && <p className="text-xs text-amber-400 text-center">Recording frames...</p>}
            </>
          )}

          {/* info */}
          <div className="border-t border-zinc-800 pt-4 text-xs text-zinc-600 space-y-1">
            <p>Grid: 300×150 · Domain: 4.0×2.0</p>
            <p>Cylinder: D=0.2 at (1.0, 1.0)</p>
            <p>Method: Chorin projection · Jacobi PP</p>
            <p>Δt: auto (CFL + diffusive limit)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
