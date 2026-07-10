/**
 * Incompressible Navier-Stokes — Chorin projection + upwind convection.
 * Supports 4 flow directions. Pure TS, Web Worker safe.
 */

export type FlowDir = "+x" | "-x" | "+y" | "-y";

export interface SolverInput {
  reynolds: number;
  inflowSpeed: number;      // U∞
  flowDir: FlowDir;
  charLength: number;       // D for Re = U∞·D/ν
  solidMask: Uint8Array;
  gridNx: number;
  gridNy: number;
  domainLx: number;
  domainLy: number;
  tEnd: number;
  nFrames: number;
  poissonIters?: number;    // default 40
}

export interface SolverFrame {
  vorticity: Float64Array;
  speed: Float64Array;
  u: Float64Array;
  v: Float64Array;
  solidMask: Uint8Array;
  nx: number; ny: number;
  step: number; t: number;
}

export type ProgressCallback = (frame: SolverFrame) => void;

export function runSolver(input: SolverInput, onFrame?: ProgressCallback): SolverFrame[] {
  const { reynolds, inflowSpeed, flowDir, charLength, solidMask, gridNx, gridNy, domainLx, domainLy, tEnd, nFrames } = input;
  const poissonIters = input.poissonIters ?? 40;
  const nx = gridNx, ny = gridNy;
  const dx = domainLx / (nx - 1), dy = domainLy / (ny - 1);
  const uInf = inflowSpeed;
  const nu = (uInf * charLength) / reynolds;
  const size = ny * nx;
  const idx = (j: number, i: number) => j * nx + i;
  const solid = solidMask;
  const horiz = flowDir === "+x" || flowDir === "-x";

  let dt = 0.22 * Math.min(dx, dy) / uInf;
  dt = Math.min(dt, 0.20 * Math.min(dx, dy) ** 2 / (nu + 1e-12));
  const nSteps = Math.floor(tEnd / dt);
  const saveEvery = Math.max(1, Math.floor(nSteps / nFrames));

  // inflow vector
  const iv = (() => {
    if (flowDir === "+x") return [uInf, 0];
    if (flowDir === "-x") return [-uInf, 0];
    if (flowDir === "+y") return [0, uInf];
    return [0, -uInf];
  })();

  // fields
  let u = new Float64Array(size), v = new Float64Array(size), p = new Float64Array(size);
  for (let k = 0; k < size; k++) { u[k] = solid[k] ? 0 : iv[0]; v[k] = solid[k] ? 0 : iv[1]; p[k] = 0; }

  // ── boundary conditions with mass conservation ──────────────
  const applyBC = (uu: Float64Array, vv: Float64Array) => {
    for (let j = 0; j < ny; j++) {
      if (horiz) {
        const inCol = flowDir === "+x" ? 0 : nx - 1;
        const outCol = flowDir === "+x" ? nx - 1 : 0;
        const nb = flowDir === "+x" ? nx - 2 : 1;
        uu[idx(j, inCol)] = iv[0]; vv[idx(j, inCol)] = 0;
        uu[idx(j, outCol)] = uu[idx(j, nb)]; vv[idx(j, outCol)] = vv[idx(j, nb)];
      } else {
        // vertical flow: left/right are free-slip
        uu[idx(j, 0)] = 0; vv[idx(j, 0)] = vv[idx(j, 1)];
        uu[idx(j, nx - 1)] = 0; vv[idx(j, nx - 1)] = vv[idx(j, nx - 2)];
      }
    }
    for (let i = 0; i < nx; i++) {
      if (!horiz) {
        const inRow = flowDir === "+y" ? 0 : ny - 1;
        const outRow = flowDir === "+y" ? ny - 1 : 0;
        const nb = flowDir === "+y" ? ny - 2 : 1;
        vv[idx(i, inRow)] = iv[1]; uu[idx(i, inRow)] = 0;
        vv[idx(i, outRow)] = vv[idx(i, nb)]; uu[idx(i, outRow)] = uu[idx(i, nb)];
      } else {
        uu[idx(i, 0)] = uu[idx(i, 1)]; vv[idx(i, 0)] = 0;
        uu[idx(i, ny - 1)] = uu[idx(i, ny - 2)]; vv[idx(i, ny - 1)] = 0;
      }
    }
    // global mass conservation: rescale outflow
    if (horiz) {
      const inCol = flowDir === "+x" ? 0 : nx - 1, outCol = flowDir === "+x" ? nx - 1 : 0;
      let fin = 0, fout = 0;
      for (let j = 0; j < ny; j++) { fin += uu[idx(j, inCol)]; fout += uu[idx(j, outCol)]; }
      const corr = (fin - fout) / ny;
      for (let j = 0; j < ny; j++) uu[idx(j, outCol)] += corr;
    } else {
      const inRow = flowDir === "+y" ? 0 : ny - 1, outRow = flowDir === "+y" ? ny - 1 : 0;
      let fin = 0, fout = 0;
      for (let i = 0; i < nx; i++) { fin += vv[idx(i, inRow)]; fout += vv[idx(i, outRow)]; }
      const corr = (fin - fout) / nx;
      for (let i = 0; i < nx; i++) vv[idx(i, outRow)] += corr;
    }
    for (let k = 0; k < size; k++) if (solid[k]) { uu[k] = 0; vv[k] = 0; }
  };

  const applyPBC = () => {
    for (let j = 0; j < ny; j++) { p[idx(j, 0)] = p[idx(j, 1)]; p[idx(j, nx - 1)] = p[idx(j, nx - 2)]; }
    for (let i = 0; i < nx; i++) { p[idx(i, 0)] = p[idx(i, 1)]; p[idx(i, ny - 1)] = p[idx(i, ny - 2)]; }
    if (flowDir === "+x") for (let j = 0; j < ny; j++) p[idx(j, nx - 1)] = 0;
    if (flowDir === "-x") for (let j = 0; j < ny; j++) p[idx(j, 0)] = 0;
    if (flowDir === "+y") for (let i = 0; i < nx; i++) p[idx(i, ny - 1)] = 0;
    if (flowDir === "-y") for (let i = 0; i < nx; i++) p[idx(i, 0)] = 0;
    for (let k = 0; k < size; k++) if (solid[k]) p[k] = 0;
  };

  // Jacobi pressure Poisson
  const dx2 = dx * dx, dy2 = dy * dy;
  const den = 2 * (dx2 + dy2);
  const tmpRhs = new Float64Array(size);
  const solvePressure = () => {
    for (let it = 0; it < poissonIters; it++) {
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const k = idx(j, i);
          p[k] = ((p[k + 1] + p[k - 1]) * dy2 + (p[k + nx] + p[k - nx]) * dx2 - tmpRhs[k] * dx2 * dy2) / den;
        }
      applyPBC();
    }
  };

  const us = new Float64Array(size), vs = new Float64Array(size);
  const frames: SolverFrame[] = [];

  for (let step = 0; step < nSteps; step++) {
    // 1. Tentative velocity — upwind convection
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(j, i);
        if (solid[k]) { us[k] = 0; vs[k] = 0; continue; }
        const uc = u[k], vc = v[k];
        const uE = u[k + 1], uW = u[k - 1], uN = u[k + nx], uS = u[k - nx];
        const vE = v[k + 1], vW = v[k - 1], vN = v[k + nx], vS = v[k - nx];
        // upwind
        const dudx = uc > 0 ? (uc - uW) / dx : (uE - uc) / dx;
        const dudy = vc > 0 ? (uc - uS) / dy : (uN - uc) / dy;
        const dvdx = uc > 0 ? (vc - vW) / dx : (vE - vc) / dx;
        const dvdy = vc > 0 ? (vc - vS) / dy : (vN - vc) / dy;
        const lapu = (uE - 2 * uc + uW) / dx2 + (uN - 2 * uc + uS) / dy2;
        const lapv = (vE - 2 * vc + vW) / dx2 + (vN - 2 * vc + vS) / dy2;
        us[k] = uc + dt * (-(uc * dudx + vc * dudy) + nu * lapu);
        vs[k] = vc + dt * (-(uc * dvdx + vc * dvdy) + nu * lapv);
      }
    applyBC(us, vs);

    // 2. Pressure Poisson RHS
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(j, i);
        tmpRhs[k] = ((us[k + 1] - us[k - 1]) / (2 * dx) + (vs[k + nx] - vs[k - nx]) / (2 * dy)) / dt;
      }
    solvePressure();

    // 3. Velocity correction
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(j, i);
        if (solid[k]) { u[k] = 0; v[k] = 0; continue; }
        u[k] = us[k] - dt * (p[k + 1] - p[k - 1]) / (2 * dx);
        v[k] = vs[k] - dt * (p[k + nx] - p[k - nx]) / (2 * dy);
      }
    applyBC(u, v);

    if (!u.every(isFinite)) throw new Error("Simulation diverged — try lower Re");

    // save frame
    if (step % saveEvery === 0) {
      const omega = new Float64Array(size), spd = new Float64Array(size);
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const k = idx(j, i);
          const w = (v[k + 1] - v[k - 1]) / (2 * dx) - (u[k + nx] - u[k - nx]) / (2 * dy);
          omega[k] = solid[k] ? NaN : w;
          spd[k] = solid[k] ? NaN : Math.hypot(u[k], v[k]);
        }
      const f: SolverFrame = { vorticity: omega, speed: spd, u: new Float64Array(u), v: new Float64Array(v), solidMask: solid, nx, ny, step, t: step * dt };
      frames.push(f);
      onFrame?.(f);
    }
  }
  return frames;
}

function isFinite(v: number) { return Number.isFinite(v); }
