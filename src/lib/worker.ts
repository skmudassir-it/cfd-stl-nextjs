import { runSolver, type SolverInput, type SolverFrame } from "./solver";

self.onmessage = (e: MessageEvent<SolverInput>) => {
  try {
    const frames = runSolver(e.data, (frame: SolverFrame) => {
      self.postMessage({ type: "frame", frame });
    });
    self.postMessage({ type: "done", frameCount: frames.length });
  } catch (err: unknown) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
