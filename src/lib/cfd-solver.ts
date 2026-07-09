/**
 * Incompressible Navier-Stokes CFD solver — pure TypeScript
 * Same algorithm as the Python version: Chorin's projection + explicit time-stepping
 *
 * Designed to run in a Web Worker. Posts frames back via onFrame callback.
 */

import type { SlicePoint } from "./stl-slicer";

// ── types ──────────────────────────────────────────────────────────
export type FlowDirection =
  | "left_to_right"
  | "right_to_left"
  | "bottom_to_top"
  | "top_to_bottom";

export interface CfdInput {
  polygons: SlicePoint[][];
  flowDirection: FlowDirection;
  reynolds: number;
  gridNx: number;
  gridNy: number;
  tEnd: number;
  nFrames: number;
}

export interface CfdFrame {
  data: Float64Array;       // flattened vorticity field (gridNy × gridNx)
  width: number;
  height: number;
  solidMask: Uint8Array;    // 1 = solid, 0 = fluid
  step: number;
  t: number;
}

export type CfdProgress = CfdFrame & { done: false };
export type CfdDone = { done: true; frames: CfdFrame[]; domain: [number, number, number, number] };

/**
 * Run CFD simulation synchronously, calling onFrame for each saved frame.
 * Returns all frames when done.
 */
export function runCfd(
  input: CfdInput,
  onFrame?: (frame: CfdFrame) => void
): CfdFrame[] {
  const {
    polygons,
    flowDirection,
    reynolds,
    gridNx,
    gridNy,
    tEnd,
    nFrames,
  } = input;

  // ── compute domain ─────────────────────────────────────────────
  const allPts = polygons.flat();
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const [u, v] of allPts) {
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }

  const shapeW = maxU - minU || 1;
  const shapeH = maxV - minV || 1;
  const margin = Math.max(shapeW, shapeH) * 2;
  const LX = Math.max(shapeW * 3, margin);
  const LY = Math.max(shapeH * 3, margin);
  const offsetU = (LX - shapeW) / 2 - minU;
  const offsetV = (LY - shapeH) / 2 - minV;

  // shift polygons
  const shifted: SlicePoint[][] = polygons.map(poly =>
    poly.map(([u, v]) => [u + offsetU, v + offsetV] as SlicePoint)
  );

  // ── grid ────────────────────────────────────────────────────────
  const nx = gridNx;
  const ny = gridNy;
  const dx = LX / (nx - 1);
  const dy = LY / (ny - 1);

  // ── solid mask (ray-casting) ────────────────────────────────────
  const solid = new Uint8Array(ny * nx);
  const X = new Float64Array(nx);
  const Y = new Float64Array(ny);
  for (let i = 0; i < nx; i++) X[i] = i * dx;
  for (let j = 0; j < ny; j++) Y[j] = j * dy;

  for (const poly of shifted) {
    const n = poly.length;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const px = X[i];
        const py = Y[j];
        let inside = false;
        for (let k = 0, l = n - 1; k < n; l = k++) {
          const [xi, yi] = poly[k];
          const [xj, yj] = poly[l];
          if (((yi > py) !== (yj > py)) &&
              (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)) {
            inside = !inside;
          }
        }
        if (inside) solid[j * nx + i] = 1;
      }
    }
  }

  // ── physics ─────────────────────────────────────────────────────
  const D = Math.max(shapeW, shapeH, 0.1);
  const uInlet = 1.0;
  const nu = (uInlet * D) / reynolds;
  const rho = 1.0;

  let dt = 0.25 * Math.min(dx, dy) / uInlet;
  dt = Math.min(dt, 0.20 * Math.min(dx, dy) ** 2 / nu);
  const nSteps = Math.floor(tEnd / dt);
  const saveEvery = Math.max(1, Math.floor(nSteps / nFrames));

  // ── fields ──────────────────────────────────────────────────────
  const size = ny * nx;
  let u = new Float64Array(size);
  let v = new Float64Array(size);
  let p = new Float64Array(size);

  // index helper
  const idx = (j: number, i: number) => j * nx + i;

  // ── differential operators ──────────────────────────────────────
  const ddx = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx - 1; i++) {
        out[idx(j, i)] = (f[idx(j, i + 1)] - f[idx(j, i - 1)]) / (2 * dx);
      }
    }
    return out;
  };

  const ddy = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < nx; i++) {
        out[idx(j, i)] = (f[idx(j + 1, i)] - f[idx(j - 1, i)]) / (2 * dy);
      }
    }
    return out;
  };

  const laplacian = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        out[idx(j, i)] =
          (f[idx(j, i + 1)] - 2 * f[idx(j, i)] + f[idx(j, i - 1)]) / (dx * dx) +
          (f[idx(j + 1, i)] - 2 * f[idx(j, i)] + f[idx(j - 1, i)]) / (dy * dy);
      }
    }
    return out;
  };

  // ── BCs ─────────────────────────────────────────────────────────
  const applyBC = () => {
    if (flowDirection === "left_to_right") {
      for (let j = 0; j < ny; j++) { u[idx(j, 0)] = uInlet; v[idx(j, 0)] = 0; }
      for (let j = 0; j < ny; j++) { u[idx(j, nx - 1)] = u[idx(j, nx - 2)]; v[idx(j, nx - 1)] = v[idx(j, nx - 2)]; }
      for (let i = 0; i < nx; i++) { u[idx(0, i)] = u[idx(1, i)]; u[idx(ny - 1, i)] = u[idx(ny - 2, i)]; v[idx(0, i)] = 0; v[idx(ny - 1, i)] = 0; }
    } else if (flowDirection === "right_to_left") {
      for (let j = 0; j < ny; j++) { u[idx(j, nx - 1)] = uInlet; v[idx(j, nx - 1)] = 0; }
      for (let j = 0; j < ny; j++) { u[idx(j, 0)] = u[idx(j, 1)]; v[idx(j, 0)] = v[idx(j, 1)]; }
      for (let i = 0; i < nx; i++) { u[idx(0, i)] = u[idx(1, i)]; u[idx(ny - 1, i)] = u[idx(ny - 2, i)]; v[idx(0, i)] = 0; v[idx(ny - 1, i)] = 0; }
    } else if (flowDirection === "bottom_to_top") {
      for (let i = 0; i < nx; i++) { u[idx(0, i)] = 0; v[idx(0, i)] = uInlet; }
      for (let i = 0; i < nx; i++) { u[idx(ny - 1, i)] = u[idx(ny - 2, i)]; v[idx(ny - 1, i)] = v[idx(ny - 2, i)]; }
      for (let i = 0; i < nx; i++) { u[idx(0, i)] = 0; v[idx(ny - 1, i)] = 0; }  // fix
      for (let j = 0; j < ny; j++) { u[idx(j, 0)] = 0; u[idx(j, nx - 1)] = 0; v[idx(j, 0)] = v[idx(j, 1)]; v[idx(j, nx - 1)] = v[idx(j, nx - 2)]; }
    } else if (flowDirection === "top_to_bottom") {
      for (let i = 0; i < nx; i++) { u[idx(ny - 1, i)] = 0; v[idx(ny - 1, i)] = uInlet; }
      for (let i = 0; i < nx; i++) { u[idx(0, i)] = u[idx(1, i)]; v[idx(0, i)] = v[idx(1, i)]; }
      for (let j = 0; j < ny; j++) { u[idx(j, 0)] = 0; u[idx(j, nx - 1)] = 0; v[idx(j, 0)] = v[idx(j, 1)]; v[idx(j, nx - 1)] = v[idx(j, nx - 2)]; }
    }

    // zero out solids
    for (let k = 0; k < size; k++) {
      if (solid[k]) { u[k] = 0; v[k] = 0; }
    }
  };

  const applyPressureBC = () => {
    // Neumann on walls, Dirichlet at outlet
    if (flowDirection === "left_to_right" || flowDirection === "right_to_left") {
      const outCol = flowDirection === "left_to_right" ? nx - 1 : 0;
      for (let j = 0; j < ny; j++) p[idx(j, outCol)] = 0;
      for (let j = 0; j < ny; j++) p[idx(j, outCol === 0 ? nx - 1 : 0)] = p[idx(j, outCol === 0 ? nx - 2 : 1)];
      for (let i = 0; i < nx; i++) { p[idx(0, i)] = p[idx(1, i)]; p[idx(ny - 1, i)] = p[idx(ny - 2, i)]; }
    } else {
      const outRow = flowDirection === "bottom_to_top" ? ny - 1 : 0;
      for (let i = 0; i < nx; i++) p[idx(outRow, i)] = 0;
      for (let i = 0; i < nx; i++) p[idx(outRow === 0 ? ny - 1 : 0, i)] = p[idx(outRow === 0 ? ny - 2 : 1, i)];
      for (let j = 0; j < ny; j++) { p[idx(j, 0)] = p[idx(j, 1)]; p[idx(j, nx - 1)] = p[idx(j, nx - 2)]; }
    }
    // zero solids
    for (let k = 0; k < size; k++) { if (solid[k]) p[k] = 0; }
  };

  // ── pressure Poisson ────────────────────────────────────────────
  const poissonIters = 60;
  const tmpP = new Float64Array(size);
  const tmpRhs = new Float64Array(size);
  const dx2 = dx * dx;
  const dy2 = dy * dy;
  const denom = 2 * (dx2 + dy2);

  const solvePressure = () => {
    for (let iter = 0; iter < poissonIters; iter++) {
      tmpP.set(p);
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = idx(j, i);
          if (solid[k]) continue;
          p[k] = (
            (tmpP[idx(j, i + 1)] + tmpP[idx(j, i - 1)]) * dy2 +
            (tmpP[idx(j + 1, i)] + tmpP[idx(j - 1, i)]) * dx2 -
            tmpRhs[k] * dx2 * dy2
          ) / denom;
        }
      }
      applyPressureBC();
    }
  };

  // ── time loop ───────────────────────────────────────────────────
  const dudx = new Float64Array(size);
  const dudy = new Float64Array(size);
  const dvdx = new Float64Array(size);
  const dvdy = new Float64Array(size);
  const lapU = new Float64Array(size);
  const lapV = new Float64Array(size);
  const div = new Float64Array(size);
  const dpdx = new Float64Array(size);
  const dpdy = new Float64Array(size);

  const frames: CfdFrame[] = [];

  for (let step = 0; step < nSteps; step++) {
    // 1. tentative velocity
    ddx(u, dudx); ddy(u, dudy);
    ddx(v, dvdx); ddy(v, dvdy);
    laplacian(u, lapU); laplacian(v, lapV);

    const uStar = new Float64Array(size);
    const vStar = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      uStar[k] = u[k] + dt * (-u[k] * dudx[k] - v[k] * dudy[k] + nu * lapU[k]);
      vStar[k] = v[k] + dt * (-u[k] * dvdx[k] - v[k] * dvdy[k] + nu * lapV[k]);
    }
    u = uStar; v = vStar;
    applyBC();

    // 2. pressure Poisson
    ddx(u, dudx); ddy(v, dvdy);
    for (let k = 0; k < size; k++) {
      div[k] = dudx[k] + dvdy[k];
      tmpRhs[k] = (rho / dt) * div[k];
    }
    solvePressure();

    // 3. velocity correction
    ddx(p, dpdx); ddy(p, dpdy);
    for (let k = 0; k < size; k++) {
      u[k] -= (dt / rho) * dpdx[k];
      v[k] -= (dt / rho) * dpdy[k];
    }
    applyBC();

    // save frame
    if (step % saveEvery === 0) {
      // vorticity ω = dv/dx - du/dy
      ddx(v, dvdx); ddy(u, dudy);
      const omega = new Float64Array(size);
      for (let k = 0; k < size; k++) {
        omega[k] = solid[k] ? NaN : (dvdx[k] - dudy[k]);
      }

      const frame: CfdFrame = {
        data: omega,
        width: nx,
        height: ny,
        solidMask: solid,
        step,
        t: step * dt,
      };
      frames.push(frame);
      onFrame?.(frame);
    }

    // check divergence
    if (!u.every(isFinite)) {
      throw new Error("Simulation diverged — try lower Reynolds number");
    }
  }

  return frames;
}

function isFinite(v: number) { return Number.isFinite(v); }
