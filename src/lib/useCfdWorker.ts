"use client";

import { useRef, useCallback, useState } from "react";
import type { CfdFrame, CfdInput } from "@/lib/cfd-solver";

interface WorkerMessage {
  type: "frame" | "done" | "error";
  width?: number;
  height?: number;
  step?: number;
  t?: number;
  data?: ArrayBuffer;
  solidMask?: ArrayBuffer;
  frameCount?: number;
  message?: string;
}

export function useCfdWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [frames, setFrames] = useState<CfdFrame[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (
      input: CfdInput,
      onProgress?: (pct: number) => void
    ) => {
      // terminate previous worker
      workerRef.current?.terminate();

      setFrames([]);
      setRunning(true);
      setError(null);
      setProgress(0);

      const collected: CfdFrame[] = [];
      const totalSteps = Math.floor(
        input.tEnd /
          Math.min(
            0.25 * (1 / (input.gridNx - 1)) / 1.0,
            0.2 * (1 / (input.gridNx - 1)) ** 2 / ((1.0 * 0.2) / input.reynolds)
          )
      );
      const saveEvery = Math.max(1, Math.floor(totalSteps / input.nFrames));

      const worker = new Worker(
        new URL("@/workers/cfd-worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data;

        if (msg.type === "frame" && msg.data && msg.solidMask) {
          const frame: CfdFrame = {
            data: new Float64Array(msg.data),
            width: msg.width!,
            height: msg.height!,
            solidMask: new Uint8Array(msg.solidMask),
            step: msg.step!,
            t: msg.t!,
          };
          collected.push(frame);
          const pct = Math.round((collected.length / input.nFrames) * 100);
          setProgress(pct);
          onProgress?.(pct);
        } else if (msg.type === "done") {
          setFrames([...collected]);
          setRunning(false);
        } else if (msg.type === "error") {
          setError(msg.message || "Simulation failed");
          setRunning(false);
        }
      };

      worker.onerror = (err) => {
        setError(err.message || "Worker error");
        setRunning(false);
      };

      worker.postMessage(input);
    },
    []
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  }, []);

  return { frames, running, progress, error, run, cancel };
}
