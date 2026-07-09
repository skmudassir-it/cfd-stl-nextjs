"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import * as THREE from "three";

import FileUpload from "@/components/FileUpload";
import StlViewer from "@/components/StlViewer";
import SliceControls from "@/components/SliceControls";
import CfdConfig from "@/components/CfdConfig";
import ResultsView from "@/components/ResultsView";

import { uploadStl, sliceMesh, runSimulation } from "@/lib/api";
import type {
  StlBounds,
  SliceResult,
  CfdResult,
  PlaneAxis,
  FlowDirection,
  AppStep,
} from "@/lib/types";

export default function Home() {
  const [step, setStep] = useState<AppStep>("upload");
  const [stlUrl, setStlUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<StlBounds | null>(null);

  // slice state
  const [axis, setAxis] = useState<PlaneAxis>("z");
  const [position, setPosition] = useState(0);
  const [sliceResult, setSliceResult] = useState<SliceResult | null>(null);
  const [sliceLoading, setSliceLoading] = useState(false);

  // cfd state
  const [cfdResult, setCfdResult] = useState<CfdResult | null>(null);
  const [cfdRunning, setCfdRunning] = useState(false);
  const [cfdError, setCfdError] = useState<string | null>(null);

  const sliceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── upload handler ──────────────────────────────────────────
  const handleUpload = useCallback(async (file: File) => {
    const result = await uploadStl(file);
    setSessionId(result.session_id);
    setBounds(result);
    setStlUrl(URL.createObjectURL(file));
    setStep("slice");

    // auto-slice at center
    const mid = (result.bounds[0][2] + result.bounds[1][2]) / 2;
    setPosition(mid);
    const slice = await sliceMesh(result.session_id, "z", mid);
    setSliceResult(slice);
  }, []);

  // ── slice handler ───────────────────────────────────────────
  const handleSlice = useCallback(
    async (newAxis: PlaneAxis, newPos: number) => {
      if (!sessionId) return;
      setSliceLoading(true);
      try {
        const result = await sliceMesh(sessionId, newAxis, newPos);
        setSliceResult(result);
      } catch {
        // silently fail — user can retry
      } finally {
        setSliceLoading(false);
      }
    },
    [sessionId]
  );

  const handleAxisChange = useCallback(
    (a: PlaneAxis) => {
      setAxis(a);
      const idx = { x: 0, y: 1, z: 2 }[a];
      if (bounds) {
        const mid = (bounds.bounds[0][idx] + bounds.bounds[1][idx]) / 2;
        setPosition(mid);
        handleSlice(a, mid);
      }
    },
    [bounds, handleSlice]
  );

  const handlePositionChange = useCallback(
    (p: number) => {
      setPosition(p);
      // debounce slice requests
      if (sliceTimeoutRef.current) clearTimeout(sliceTimeoutRef.current);
      sliceTimeoutRef.current = setTimeout(() => handleSlice(axis, p), 100);
    },
    [axis, handleSlice]
  );

  // ── CFD run handler ─────────────────────────────────────────
  const handleRunCfd = useCallback(
    async (params: {
      flowDirection: FlowDirection;
      reynolds: number;
      gridNx: number;
      gridNy: number;
      tEnd: number;
      nFrames: number;
    }) => {
      if (!sliceResult?.polygons.length) return;

      setCfdRunning(true);
      setCfdError(null);
      setStep("simulating");

      try {
        const result = await runSimulation({
          polygons: sliceResult.polygons,
          flow_direction: params.flowDirection,
          reynolds: params.reynolds,
          grid_nx: params.gridNx,
          grid_ny: params.gridNy,
          t_end: params.tEnd,
          n_frames: params.nFrames,
        });
        setCfdResult(result);
        setStep("done");
      } catch (e: any) {
        setCfdError(e.message || "Simulation failed");
        setStep("configure");
      } finally {
        setCfdRunning(false);
      }
    },
    [sliceResult]
  );

  // ── range for current axis ──────────────────────────────────
  const range: [number, number] = bounds
    ? (() => {
        const idx = { x: 0, y: 1, z: 2 }[axis];
        return [bounds.bounds[0][idx], bounds.bounds[1][idx]] as [number, number];
      })()
    : [0, 1];

  // ── step indicator ──────────────────────────────────────────
  const steps: { id: AppStep; label: string }[] = [
    { id: "upload", label: "Upload STL" },
    { id: "slice", label: "Slice Model" },
    { id: "configure", label: "Run CFD" },
    { id: "simulating", label: "Running..." },
    { id: "done", label: "Results" },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);
  const progressPct = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="flex h-screen">
      {/* ── LEFT PANEL ──────────────────────────────────────── */}
      <div className="w-[420px] min-w-[420px] bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-y-auto">
        {/* header */}
        <div className="p-5 pb-3">
          <h1 className="text-lg font-bold text-violet-400 flex items-center gap-2">
            🌊 CFD from STL
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Upload • Slice • Simulate
          </p>
        </div>

        <div className="px-5 pb-2">
          <Progress value={progressPct} className="h-1" />
          <div className="flex justify-between mt-1.5">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`text-[10px] ${
                  i <= stepIndex ? "text-violet-400" : "text-zinc-600"
                }`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <Separator className="bg-zinc-800" />

        {/* scrollable content */}
        <div className="flex-1 p-5 space-y-5 overflow-y-auto">
          {/* Step 1: Upload */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-300 mb-3">
              📤 1. Upload STL
            </h2>
            <FileUpload onUpload={handleUpload} disabled={step !== "upload"} />
            {bounds && (
              <p className="text-xs text-zinc-500 mt-2">
                Loaded —{" "}
                {bounds.extent.map((v) => v.toFixed(1)).join(" × ")} mm
              </p>
            )}
          </div>

          {/* Step 2: Slice — visible after upload */}
          <AnimatePresence>
            {step !== "upload" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">
                  ✂️ 2. Slice the Model
                </h2>
                <SliceControls
                  axis={axis}
                  onAxisChange={handleAxisChange}
                  position={position}
                  onPositionChange={handlePositionChange}
                  range={range}
                  sliceResult={sliceResult}
                  loading={sliceLoading}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 3: CFD Config — visible after slicing */}
          <AnimatePresence>
            {sliceResult && sliceResult.polygons.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">
                  🌊 3. Run CFD Simulation
                </h2>
                <CfdConfig
                  onRun={handleRunCfd}
                  running={cfdRunning}
                  disabled={!sliceResult?.polygons.length}
                />
                {cfdError && (
                  <p className="text-red-400 text-sm mt-2">{cfdError}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 4: Results */}
          <AnimatePresence>
            {cfdResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Separator className="bg-zinc-800 mb-4" />
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">
                  ✅ Results
                </h2>
                <ResultsView result={cfdResult} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── RIGHT: 3D VIEWER ─────────────────────────────────── */}
      <div className="flex-1 p-4 bg-zinc-950">
        <StlViewer
          stlUrl={stlUrl}
          sliceAxis={axis}
          slicePosition={position}
          showPlane={step !== "upload"}
        />
        <p className="text-[11px] text-zinc-600 mt-2 text-center">
          🖱 drag=rotate · scroll=zoom · right-drag=pan · X/Y/Z to slice
        </p>
      </div>
    </div>
  );
}
