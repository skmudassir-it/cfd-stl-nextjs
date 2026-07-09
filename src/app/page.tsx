"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Play, Loader2 } from "lucide-react";
import * as THREE from "three";

import FileUpload from "@/components/FileUpload";
import StlViewer from "@/components/StlViewer";
import Slice2DView from "@/components/Slice2DView";
import SliceControls from "@/components/SliceControls";
import CfdConfig from "@/components/CfdConfig";
import CfdResults from "@/components/CfdResults";

import { sliceGeometry } from "@/lib/stl-slicer";
import { useCfdWorker } from "@/lib/useCfdWorker";
import type { SliceResult, PlaneAxis, FlowDirection, AppStep } from "@/lib/types";

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [stlUrl, setStlUrl] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [modelBounds, setModelBounds] = useState<{ min: THREE.Vector3; max: THREE.Vector3 } | null>(null);
  const [resultFrames, setResultFrames] = useState<typeof frames>([]);

  // slice state
  const [axis, setAxis] = useState<PlaneAxis>("z");
  const [position, setPosition] = useState(0);
  const [sliceResult, setSliceResult] = useState<SliceResult | null>(null);
  const [sliceLoading, setSliceLoading] = useState(false);

  // cfd state
  const { frames, running: cfdRunning, progress, error: cfdError, run, cancel } = useCfdWorker();
  const [cfdDomain, setCfdDomain] = useState<[number, number, number, number]>([0, 1, 0, 1]);

  const sliceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── upload handler ──────────────────────────────────────────
  const handleUpload = useCallback(async (file: File) => {
    setStlUrl(URL.createObjectURL(file));
    // geometry + bounds come via callbacks from StlViewer
  }, []);

  const handleBoundsReady = useCallback((box: THREE.Box3) => {
    setModelBounds({ min: box.min, max: box.max });
    setStep("slice");
    // auto-slice at z-center
    const midZ = (box.min.z + box.max.z) / 2;
    setPosition(midZ);
  }, []);

  const handleGeometryReady = useCallback((geo: THREE.BufferGeometry) => {
    setGeometry(geo);
  }, []);

  // ── slice handler (client-side, no API) ─────────────────────
  const doSlice = useCallback(
    (a: PlaneAxis, pos: number) => {
      if (!geometry) return;
      setSliceLoading(true);
      try {
        const result = sliceGeometry(geometry, a, pos);
        setSliceResult({
          axis: result.axis,
          position: result.position,
          polygons: result.polygons,
          num_polygons: result.polygons.length,
          bounds_range: [0, 0], // not used
        });
      } catch {
        // silently fail
      } finally {
        setSliceLoading(false);
      }
    },
    [geometry]
  );

  const handleAxisChange = useCallback(
    (a: PlaneAxis) => {
      setAxis(a);
      if (modelBounds) {
        const idx = { x: 0, y: 1, z: 2 };
        const ax = a as "x" | "y" | "z";
        const mid = (modelBounds.min.getComponent(idx[ax]) + modelBounds.max.getComponent(idx[ax])) / 2;
        setPosition(mid);
        doSlice(a, mid);
      }
    },
    [modelBounds, doSlice]
  );

  const handlePositionChange = useCallback(
    (p: number) => {
      setPosition(p);
      if (sliceTimeoutRef.current) clearTimeout(sliceTimeoutRef.current);
      sliceTimeoutRef.current = setTimeout(() => doSlice(axis, p), 100);
    },
    [axis, doSlice]
  );

  // ── CFD run handler (worker-based, no API) ─────────────────
  const handleRunCfd = useCallback(
    (params: {
      flowDirection: FlowDirection;
      reynolds: number;
      gridNx: number;
      gridNy: number;
      tEnd: number;
      nFrames: number;
    }) => {
      if (!sliceResult?.polygons.length) return;

      setStep("simulating");
      setCfdDomain([0, 4, 0, 2]); // approximate

      run(
        {
          polygons: sliceResult.polygons,
          flowDirection: params.flowDirection,
          reynolds: params.reynolds,
          gridNx: params.gridNx,
          gridNy: params.gridNy,
          tEnd: params.tEnd,
          nFrames: params.nFrames,
        },
        () => {} // progress handled in hook
      );
    },
    [sliceResult, run]
  );

  // monitor worker completion
  useEffect(() => {
    if (!cfdRunning && frames.length > 0 && step === "simulating") {
      setResultFrames(frames);
      setStep("done");
    }
  }, [cfdRunning, frames, step]);

  // ── range ───────────────────────────────────────────────────
  const range: [number, number] = modelBounds
    ? (() => {
        const idx = { x: 0, y: 1, z: 2 }[axis];
        return [modelBounds.min.getComponent(idx), modelBounds.max.getComponent(idx)] as [number, number];
      })()
    : [0, 1];

  // ── steps ───────────────────────────────────────────────────
  const steps = [
    { id: "upload" as const, label: "Upload STL" },
    { id: "slice" as const, label: "Slice Model" },
    { id: "configure" as const, label: "Run CFD" },
    { id: "simulating" as const, label: "Running..." },
    { id: "done" as const, label: "Results" },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);
  const progressPct = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="flex h-screen">
      {/* ── LEFT PANEL ──────────────────────────────────────── */}
      <div className="w-[420px] min-w-[420px] bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-y-auto">
        <div className="p-5 pb-3">
          <h1 className="text-lg font-bold text-violet-400 flex items-center gap-2">
            🌊 CFD from STL
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">Upload • Slice • Simulate — all in browser</p>
        </div>

        <div className="px-5 pb-2">
          <Progress value={progressPct} className="h-1" />
          <div className="flex justify-between mt-1.5">
            {steps.map((s, i) => (
              <span key={s.id} className={`text-[10px] ${i <= stepIndex ? "text-violet-400" : "text-zinc-600"}`}>
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        <div className="flex-1 p-5 space-y-5 overflow-y-auto">
          {/* Step 1: Upload */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-3">📤 1. Upload STL</h2>
            <FileUpload onUpload={handleUpload} disabled={step !== "upload"} />
            {modelBounds && (
              <p className="text-xs text-zinc-500 mt-2">Loaded ✓</p>
            )}
          </div>

          {/* Step 2: Slice */}
          <AnimatePresence>
            {step !== "upload" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
              >
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">✂️ 2. Slice the Model</h2>
                <SliceControls
                  axis={axis} onAxisChange={handleAxisChange}
                  position={position} onPositionChange={handlePositionChange}
                  range={range} sliceResult={sliceResult} loading={sliceLoading}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 3: CFD Config */}
          <AnimatePresence>
            {sliceResult && sliceResult.polygons.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
              >
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">🌊 3. Run CFD (in-browser)</h2>
                <CfdConfig onRun={handleRunCfd} running={cfdRunning}
                           disabled={!sliceResult?.polygons.length} />
                {cfdError && <p className="text-red-400 text-sm mt-2">{cfdError}</p>}
                {cfdRunning && (
                  <div className="mt-3 space-y-1">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-violet-400 text-center">
                      <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
                      Simulating... {progress}%
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 4: Results */}
          <AnimatePresence>
            {resultFrames.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">✅ Results</h2>
                <CfdResults frames={resultFrames} domain={cfdDomain} />
                <button
                  onClick={() => { setStep("upload"); setResultFrames([]); }}
                  className="mt-3 w-full py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700 transition-colors"
                >
                  Start New Simulation
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── RIGHT: 3D VIEWER + 2D SECTION ──────────────────── */}
      <div className="flex-1 flex flex-col p-4 gap-4 bg-zinc-950">
        {/* Top: 3D model */}
        <div className="flex-1 min-h-0">
          <StlViewer
            stlUrl={stlUrl}
            sliceAxis={axis}
            slicePosition={position}
            showPlane={step !== "upload"}
            onBoundsReady={handleBoundsReady}
            onGeometryReady={handleGeometryReady}
          />
        </div>

        {/* Bottom: 2D cross-section */}
        {sliceResult && step !== "upload" && (
          <div className="h-[280px] shrink-0">
            <Slice2DView
              polygons={sliceResult.polygons}
              axis={axis}
              position={position}
            />
          </div>
        )}

        <p className="text-[11px] text-zinc-600 text-center shrink-0">
          🖱 drag=rotate · scroll=zoom · right-drag=pan
        </p>
      </div>
    </div>
  );
}
