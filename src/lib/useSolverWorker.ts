"use client";

import { useState, useRef, useCallback } from "react";
import type { SolverInput, SolverFrame } from "./solver";

interface WorkerState {
  running: boolean;
  frames: SolverFrame[];
  progress: number;
  error: string | null;
}

export function useSolverWorker() {
  const [state, setState] = useState<WorkerState>({ running: false, frames: [], progress: 0, error: null });
  const workerRef = useRef<Worker | null>(null);
  const frameCountRef = useRef(0);

  const run = useCallback((input: SolverInput) => {
    workerRef.current?.terminate();
    setState({ running: true, frames: [], progress: 0, error: null });
    frameCountRef.current = 0;

    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, frame, message } = e.data;
      if (type === "frame") {
        frameCountRef.current++;
        setState(prev => ({
          ...prev,
          frames: [...prev.frames, frame],
          progress: Math.min(100, Math.round((frameCountRef.current / input.nFrames) * 100)),
        }));
      } else if (type === "done") {
        setState(prev => ({ ...prev, running: false, progress: 100 }));
      } else if (type === "error") {
        setState(prev => ({ ...prev, running: false, error: message }));
      }
    };
    worker.onerror = (err) => setState(prev => ({ ...prev, running: false, error: `Worker error: ${err.message}` }));
    worker.postMessage(input);
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState(prev => ({ ...prev, running: false }));
  }, []);

  return { ...state, run, cancel };
}
