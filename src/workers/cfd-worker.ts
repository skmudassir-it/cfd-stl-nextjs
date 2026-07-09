// @ts-nocheck — Web Worker global scope
/**
 * Web Worker entry point for CFD solver.
 */

import { runCfd } from "@/lib/cfd-solver";
import type { CfdInput, CfdFrame } from "@/lib/cfd-solver";

const ctx = self as any;

self.onmessage = (e: MessageEvent<CfdInput>) => {
  try {
    const frames = runCfd(e.data, (frame: CfdFrame) => {
      self.postMessage(
        {
          type: "frame" as const,
          width: frame.width,
          height: frame.height,
          step: frame.step,
          t: frame.t,
          data: frame.data.buffer,
          solidMask: frame.solidMask.buffer,
        },
        [frame.data.buffer, frame.solidMask.buffer] as any
      );
    });

    self.postMessage({
      type: "done" as const,
      frameCount: frames.length,
      width: frames[frames.length - 1]?.width || 0,
      height: frames[frames.length - 1]?.height || 0,
    });
  } catch (err: any) {
    self.postMessage({ type: "error" as const, message: err.message });
  }
};
