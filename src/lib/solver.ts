/**
 * Incompressible Navier-Stokes — Chorin projection method
 * Flow past arbitrary obstacle shapes. Pure TS, no DOM → Web Worker safe.
 */

export interface SolverInput {
  reynolds: number;
  charLength: number;     // characteristic length for Re (diameter, side, etc.)
  solidMask: Uint8Array;  // pre-computed solid mask (1 = obstacle, 0 = fluid)
  gridNx: number;
  gridNy: number;
  domainLx: number;
  domainLy: number;
  tEnd: number;
  nFrames: number;
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
  const { reynolds, charLength, solidMask, gridNx, gridNy, domainLx, domainLy, tEnd, nFrames } = input;
  const nx = gridNx, ny = gridNy;
  const dx = domainLx / (nx - 1), dy = domainLy / (ny - 1);
  const uInf = 1.0;
  const nu = (uInf * charLength) / reynolds;
  const rho = 1.0;

  let dt = 0.25 * Math.min(dx, dy) / uInf;
  dt = Math.min(dt, 0.20 * Math.min(dx, dy) ** 2 / (nu + 1e-12));
  const nSteps = Math.floor(tEnd / dt);
  const saveEvery = Math.max(1, Math.floor(nSteps / nFrames));

  const size = ny * nx;
  const idx = (j: number, i: number) => j * nx + i;

  // use the pre-computed solid mask
  const solid = solidMask;

  // fields
  let u = new Float64Array(size), v = new Float64Array(size), p = new Float64Array(size);
  for (let k = 0; k < size; k++) { u[k] = solid[k] ? 0 : uInf; v[k] = 0; p[k] = 0; }

  const ddx = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx - 1; i++)
        out[idx(j, i)] = (f[idx(j, i + 1)] - f[idx(j, i - 1)]) / (2 * dx);
  };
  const ddy = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx; i++)
        out[idx(j, i)] = (f[idx(j + 1, i)] - f[idx(j - 1, i)]) / (2 * dy);
  };
  const laplacian = (f: Float64Array, out: Float64Array) => {
    out.fill(0);
    const dx2 = dx * dx, dy2 = dy * dy;
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++)
        out[idx(j, i)] = (f[idx(j, i + 1)] - 2 * f[idx(j, i)] + f[idx(j, i - 1)]) / dx2
                        + (f[idx(j + 1, i)] - 2 * f[idx(j, i)] + f[idx(j - 1, i)]) / dy2;
  };

  const applyBC = () => {
    for (let j = 0; j < ny; j++) { u[idx(j, 0)] = uInf; v[idx(j, 0)] = 0; }
    for (let j = 0; j < ny; j++) { u[idx(j, nx - 1)] = u[idx(j, nx - 2)]; v[idx(j, nx - 1)] = v[idx(j, nx - 2)]; }
    for (let i = 0; i < nx; i++) { u[idx(0, i)] = u[idx(1, i)]; u[idx(ny - 1, i)] = u[idx(ny - 2, i)]; v[idx(0, i)] = 0; v[idx(ny - 1, i)] = 0; }
    for (let k = 0; k < size; k++) if (solid[k]) { u[k] = 0; v[k] = 0; }
  };
  const applyPBC = () => {
    for (let j = 0; j < ny; j++) p[idx(j, nx - 1)] = 0;
    for (let j = 0; j < ny; j++) p[idx(j, 0)] = p[idx(j, 1)];
    for (let i = 0; i < nx; i++) { p[idx(0, i)] = p[idx(1, i)]; p[idx(ny - 1, i)] = p[idx(ny - 2, i)]; }
    for (let k = 0; k < size; k++) if (solid[k]) p[k] = 0;
  };

  // Jacobi pressure Poisson
  const poissonIters = 60;
  const dx2 = dx * dx, dy2 = dy * dy;
  const denom = 2 * (dx2 + dy2);
  const tmpP = new Float64Array(size), tmpRhs = new Float64Array(size);
  const solvePressure = () => {
    for (let iter = 0; iter < poissonIters; iter++) {
      tmpP.set(p);
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const k = idx(j, i);
          if (solid[k]) continue;
          p[k] = ((tmpP[idx(j, i + 1)] + tmpP[idx(j, i - 1)]) * dy2
                + (tmpP[idx(j + 1, i)] + tmpP[idx(j - 1, i)]) * dx2
                - tmpRhs[k] * dx2 * dy2) / denom;
        }
      applyPBC();
    }
  };

  const dudx = new Float64Array(size), dudy = new Float64Array(size);
  const dvdx = new Float64Array(size), dvdy = new Float64Array(size);
  const lapU = new Float64Array(size), lapV = new Float64Array(size);
  const div  = new Float64Array(size);
  const dpdx = new Float64Array(size), dpdy = new Float64Array(size);
  const frames: SolverFrame[] = [];

  for (let step = 0; step < nSteps; step++) {
    // 1. Tentative velocity
    ddx(u, dudx); ddy(u, dudy); ddx(v, dvdx); ddy(v, dvdy);
    laplacian(u, lapU); laplacian(v, lapV);
    const uS = new Float64Array(size), vS = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      uS[k] = u[k] + dt * (-u[k] * dudx[k] - v[k] * dudy[k] + nu * lapU[k]);
      vS[k] = v[k] + dt * (-u[k] * dvdx[k] - v[k] * dvdy[k] + nu * lapV[k]);
    }
    u = uS; v = vS; applyBC();

    // 2. Pressure Poisson
    ddx(u, dudx); ddy(v, dvdy);
    for (let k = 0; k < size; k++) { div[k] = dudx[k] + dvdy[k]; tmpRhs[k] = (rho / dt) * div[k]; }
    solvePressure();

    // 3. Velocity correction
    ddx(p, dpdx); ddy(p, dpdy);
    for (let k = 0; k < size; k++) { u[k] -= (dt / rho) * dpdx[k]; v[k] -= (dt / rho) * dpdy[k]; }
    applyBC();

    if (!u.every(isFinite)) throw new Error("Simulation diverged — try lower Re");

    if (step % saveEvery === 0) {
      ddx(v, dvdx); ddy(u, dudy);
      const omega = new Float64Array(size), spd = new Float64Array(size);
      for (let k = 0; k < size; k++) {
        omega[k] = solid[k] ? NaN : (dvdx[k] - dudy[k]);
        spd[k]   = solid[k] ? NaN : Math.sqrt(u[k] * u[k] + v[k] * v[k]);
      }
      frames.push({ vorticity: omega, speed: spd, u: new Float64Array(u), v: new Float64Array(v), solidMask: solid, nx, ny, step, t: step * dt });
      onFrame?.({ vorticity: omega, speed: spd, u: new Float64Array(u), v: new Float64Array(v), solidMask: solid, nx, ny, step, t: step * dt });
    }
  }
  return frames;
}

function isFinite(v: number) { return Number.isFinite(v); }
