/**
 * Shape mask generators for CFD obstacles.
 * Each returns a Uint8Array (1 = solid, 0 = fluid) for a given grid.
 */

export type ShapeKind = "circle" | "square" | "diamond" | "ellipse" | "triangle";

export interface ShapeParams {
  kind: ShapeKind;
  cx: number;       // center x in domain coords
  cy: number;       // center y in domain coords
  size: number;     // characteristic size (diameter for circle, side for square, height for triangle, major axis for ellipse)
  aspect: number;   // width/height ratio (1 = uniform). Used for ellipse, rectangle, diamond, triangle.
  gridNx: number;
  gridNy: number;
  domainLx: number;
  domainLy: number;
}

export function generateMask(p: ShapeParams): Uint8Array {
  const { kind, cx, cy, size, aspect, gridNx, gridNy, domainLx, domainLy } = p;
  const dx = domainLx / (gridNx - 1);
  const dy = domainLy / (gridNy - 1);
  const mask = new Uint8Array(gridNy * gridNx);
  const idx = (j: number, i: number) => j * gridNx + i;

  const rx = (size / 2) * (aspect >= 1 ? aspect : 1);
  const ry = (size / 2) * (aspect >= 1 ? 1 : 1 / aspect);

  for (let j = 0; j < gridNy; j++) {
    for (let i = 0; i < gridNx; i++) {
      const x = i * dx - cx;
      const y = j * dy - cy;
      let inside = false;

      switch (kind) {
        case "circle":
          inside = (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.0;
          break;

        case "ellipse":
          // same formula as circle, but rx/ry differ by aspect
          inside = (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.0;
          break;

        case "square": {
          const hw = size / 2;
          const hh = hw / aspect;
          inside = Math.abs(x) <= hw && Math.abs(y) <= hh;
          break;
        }

        case "diamond": {
          // |x|/rx + |y|/ry <= 1
          inside = Math.abs(x) / rx + Math.abs(y) / ry <= 1.0;
          break;
        }

        case "triangle": {
          // isosceles triangle pointing right (base at left, tip at right)
          const hh = size / 2;          // half height
          const hw = size * aspect;     // base→tip length
          // scale coords so base spans [-hh, hh] in y at x = -hw/2, tip at x = +hw/2
          const sx = x / (hw / 2);
          const sy = y / hh;
          inside = sy >= -1 && sy <= 1 && sx >= -1 && sx <= 1 &&
                   Math.abs(sy) <= 1 - sx;  // sx goes from -1 (base) to +1 (tip)
          break;
        }
      }

      if (inside) mask[idx(j, i)] = 1;
    }
  }

  return mask;
}
