/**
 * STL cross-section slicer — computes 2D polygons from a Three.js geometry
 * by intersecting it with a plane at a given position along X, Y, or Z axis.
 *
 * No backend needed — runs entirely in the browser.
 */

import * as THREE from "three";

export type SlicePoint = [number, number];
export type SliceAxis = "x" | "y" | "z";

export interface SliceOutput {
  axis: SliceAxis;
  position: number;
  polygons: SlicePoint[][];
}

/**
 * Slice a Three.js BufferGeometry with a plane perpendicular to `axis` at `position`.
 * Returns 2D polygons ready for CFD simulation.
 */
export function sliceGeometry(
  geometry: THREE.BufferGeometry,
  axis: SliceAxis,
  position: number
): SliceOutput {
  // ensure we have indexed geometry
  if (!geometry.index) {
    geometry = geometry.toNonIndexed();
  }

  const posAttr = geometry.getAttribute("position");
  const indexAttr = geometry.index!;
  const vertices = posAttr.array as Float32Array;
  const indices = indexAttr.array as Uint16Array | Uint32Array;

  const axisIdx = { x: 0, y: 1, z: 2 }[axis];
  const uIdx = axis === "x" ? 1 : 0; // first projected coordinate
  const vIdx = axis === "x" ? 2 : axis === "y" ? 2 : 1; // second projected coordinate

  // collect intersection segments (unordered)
  const segments: Array<[number, number, number, number]> = []; // [u1, v1, u2, v2]

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const d0 = vertices[i0 + axisIdx] - position;
    const d1 = vertices[i1 + axisIdx] - position;
    const d2 = vertices[i2 + axisIdx] - position;

    // all same sign → no intersection
    if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    // all zero → degenerate, skip
    if (d0 === 0 && d1 === 0 && d2 === 0) continue;

    // collect intersection points on edges
    const points: Array<[number, number]> = [];

    const checkEdge = (a: number, b: number, da: number, db: number) => {
      if (da === 0 && db === 0) return; // edge lies in plane
      if (da * db > 0) return; // no crossing

      const t = da / (da - db); // interpolation factor (0 = at a, 1 = at b)
      const u = (1 - t) * vertices[a + uIdx] + t * vertices[b + uIdx];
      const v = (1 - t) * vertices[a + vIdx] + t * vertices[b + vIdx];
      points.push([u, v]);
    };

    checkEdge(i0, i1, d0, d1);
    checkEdge(i1, i2, d1, d2);
    checkEdge(i2, i0, d2, d0);

    if (points.length === 2) {
      segments.push([points[0][0], points[0][1], points[1][0], points[1][1]]);
    } else if (points.length === 3) {
      // triangle touches plane at one vertex + crosses two edges
      // connect the two crossing points
      let crossingPoints = points.filter((_, idx) => {
        return !([d0, d1, d2][idx] === 0);
      });
      // actually, the full-triangle case: 3 intersection points = 2 distinct
      // Take all pairs that don't both touch at vertices
      // Simplification: just take first 2
      if (points.length >= 2) {
        segments.push([points[0][0], points[0][1], points[1][0], points[1][1]]);
      }
    }
  }

  // connect segments into closed polygons
  const polygons = connectSegments(segments);

  return { axis, position, polygons };
}

/**
 * Connect unordered line segments into closed polygon loops.
 */
function connectSegments(
  segments: Array<[number, number, number, number]>
): SlicePoint[][] {
  if (segments.length === 0) return [];

  const EPS = 1e-9;

  const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

  const remaining = segments.map(
    (s) => [[s[0], s[1]] as SlicePoint, [s[2], s[3]] as SlicePoint] as const
  );

  const polygons: SlicePoint[][] = [];

  while (remaining.length > 0) {
    const poly: SlicePoint[] = [];
    let [start, end] = remaining.pop()!;
    poly.push(start);
    poly.push(end);

    let extended = true;
    while (extended) {
      extended = false;
      const lastPoint = poly[poly.length - 1];

      for (let i = remaining.length - 1; i >= 0; i--) {
        const seg = remaining[i];

        if (eq(seg[0][0], lastPoint[0]) && eq(seg[0][1], lastPoint[1])) {
          poly.push(seg[1]);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (eq(seg[1][0], lastPoint[0]) && eq(seg[1][1], lastPoint[1])) {
          poly.push(seg[0]);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }

    // close the loop if start ≈ end
    if (
      eq(poly[0][0], poly[poly.length - 1][0]) &&
      eq(poly[0][1], poly[poly.length - 1][1])
    ) {
      poly.pop(); // remove duplicate
    }

    if (poly.length >= 3) {
      polygons.push(poly);
    }
  }

  return polygons;
}
