export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export interface ReadingGeometry {
  w: number;
  p: number;
  h: number;
  step: number;
  l: number;
  n: number;
  maxX: number;
  maxY: number;
}

export function columnStep(height: number, overlap: number) {
  return height - clamp(overlap, 0, Math.min(height / 4, height - 1));
}

export function columnWidth(requested: number, gap: number, scrollStep: number) {
  // Align the period to the browser's actual scroll-coordinate precision,
  // keeping the requested gap, so rounding cannot put x just BEFORE k * P.
  return Math.max(1, Math.round((requested + gap) / scrollStep) * scrollStep - gap);
}

export function positionAt(x: number, y: number, geometry: ReadingGeometry) {
  return Math.floor((x + 0.01) / geometry.p) * geometry.step + y;
}

// Only aligned columns that the native scroll range can actually reach qualify.
// Minimizing squared Euclidean distance gives the least movement in the plane.
export function nearestPosition(
  t: number,
  x: number,
  y: number,
  geometry: ReadingGeometry,
) {
  const { p, step, maxX, maxY, n } = geometry;
  const first = Math.max(0, Math.ceil((t - maxY) / step));
  const last = Math.min(n - 1, Math.floor(t / step), Math.floor(maxX / p));
  if (first > last) {
    // A short article may have no scrolling at all; put the target in view.
    return { left: 0, top: clamp(t, 0, maxY) };
  }
  const optimum = (p * x + step * (t - y)) / (p * p + step * step);
  const k = clamp(Math.round(optimum), first, last);
  return { left: k * p, top: t - k * step };
}

export function restoredPosition(t: number, geometry: ReadingGeometry) {
  const k = clamp(
    Math.floor(t / geometry.step),
    0,
    Math.floor(geometry.maxX / geometry.p),
  );
  return {
    left: k * geometry.p,
    top: clamp(t - k * geometry.step, 0, geometry.maxY),
  };
}

export function slotRange(x: number, width: number, geometry: ReadingGeometry) {
  const count = Math.min(geometry.n, Math.ceil(width / geometry.p) + 2);
  const start = clamp(Math.floor(x / geometry.p) - 1, 0, geometry.n - count);
  return { start, count };
}
