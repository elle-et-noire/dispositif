export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const PLANE_PAGES = 128;
const REBASE_MARGIN = 16;
const SLOT_OVERSCAN = 8;

export interface ReadingGeometry {
  w: number;
  p: number;
  h: number;
  step: number;
  l: number;
  n: number;
  maxX: number;
  maxY: number;
  /** Logical column and vertical coordinate at the native plane's origin. */
  originColumn: number;
  originY: number;
  unit: number;
  viewportWidth: number;
  capacity: number;
  capacityY: number;
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
  return (Math.floor((x + 0.01) / geometry.p) + geometry.originColumn)
    * geometry.step + y + geometry.originY;
}

/** A movable native window, limited by both ends of the article. */
export function readingPlane(
  w: number, p: number, h: number, step: number, l: number,
  viewportWidth: number, unit: number, anchor: number,
): ReadingGeometry {
  // Give native scrolling a long runway, independently of the bounded DOM
  // pool. Input must never wait for JavaScript to extend a tiny native window.
  const n = Math.max(PLANE_PAGES, Math.ceil(viewportWidth / p) + 32);
  const maxX = n * p - (p - w) - viewportWidth;
  const maxY = (PLANE_PAGES - 1) * h;
  const k = Math.floor(clamp(anchor, 0, Math.max(0, l - Math.max(1, unit))) / step);
  const geometry = {
    w, p, h, step, l, n, maxX, maxY, unit, viewportWidth, capacity: n, capacityY: maxY,
    originColumn: Math.max(0, k - Math.floor(maxX / (2 * p))),
    originY: Math.max(-k * step, -Math.round(maxY / (2 * unit)) * unit),
  };
  const initial = restoredPosition(anchor, geometry);
  const { left, top, ...bounds } = rebasedPosition(initial.left, initial.top, geometry);
  return { ...geometry, ...bounds };
}

// Rebase near a native boundary or when the article's leading edge changes.
// Integral column shifts preserve the
// horizontal phase, and scroll-unit-aligned vertical shifts avoid zoom drift.
export function rebasedPosition(x: number, y: number, geometry: ReadingGeometry) {
  const { p, w, h, step, maxX, maxY, unit, viewportWidth, capacity, capacityY } = geometry;
  const end = Math.max(0, geometry.l - Math.max(1, unit));
  let logicalY = y + geometry.originY;
  // A column becomes available only when its first visible text is >= 0.
  // Keeping this as the native plane's edge blocks wheel/touch/scrollbar input
  // too, without undoing each horizontal scroll in an event handler.
  let firstColumn = -Math.floor((logicalY + 1e-7) / step);
  let lastColumn = Math.floor((end - logicalY + 1e-7) / step);
  // A short article can fit between two text advances. Keep at least its last
  // real fragment in view, including programmatic jumps beyond the end.
  if (lastColumn < firstColumn) {
    const k = Math.floor((x + 0.01) / p) + geometry.originColumn;
    logicalY = clamp(logicalY, -k * step, end - k * step);
    firstColumn = -Math.floor((logicalY + 1e-7) / step);
    lastColumn = Math.floor((end - logicalY + 1e-7) / step);
  }
  // End with the page that reaches the article's bottom. A fragment containing
  // only the context overlap must not create another mostly empty page.
  lastColumn = Math.max(firstColumn, Math.min(lastColumn,
    Math.ceil((geometry.l - h - logicalY - 1e-7) / step)));
  const logicalX = clamp(x + geometry.originColumn * p, firstColumn * p,
    Math.max(firstColumn * p, lastColumn * p + w - viewportWidth));
  x = logicalX - geometry.originColumn * p;
  y = logicalY - geometry.originY;
  const column = Math.floor((logicalX + 0.01) / p);
  // Leave room for fast diagonal gestures between scroll-event frames.
  const marginX = Math.min(maxX / 4, REBASE_MARGIN * p);
  const marginY = Math.min(maxY / 4, REBASE_MARGIN * h);
  const shiftColumns = x < marginX || x > maxX - marginX
    ? Math.floor((x - maxX / 2) / p) : 0;
  const shiftY = y < marginY || y > maxY - marginY
    ? Math.round((y - maxY / 2) / unit) * unit : 0;
  const originColumn = clamp(geometry.originColumn + shiftColumns,
    firstColumn, Math.max(firstColumn, lastColumn - capacity + 1));
  // Extend/shrink the leading edge in native scroll units as well. Otherwise
  // a whole-CSS-pixel step can drift at zoom levels with fractional units.
  const minimumShiftY = Math.ceil((-column * step - geometry.originY - 1e-7) / unit) * unit;
  const lastOriginY = Math.max(-column * step, end - column * step - capacityY);
  const maximumShiftY = Math.floor((lastOriginY - geometry.originY + 1e-7) / unit) * unit;
  const originY = Math.min(logicalY, geometry.originY
    + clamp(shiftY, minimumShiftY, Math.max(minimumShiftY, maximumShiftY)));
  const n = Math.min(capacity, lastColumn - originColumn + 1);
  return {
    left: logicalX - originColumn * p,
    top: logicalY - originY,
    originColumn,
    originY,
    n,
    maxX: Math.max(0, (n - 1) * p + w - viewportWidth),
    maxY: Math.min(capacityY, Math.max(0, Math.floor((end - column * step - originY + 1e-7) / unit) * unit)),
  };
}

// Candidates are all integer columns, with an unbounded logical y coordinate.
// The chosen destination is rebased into the native plane before scrolling.
export function nearestPosition(
  t: number,
  x: number,
  y: number,
  geometry: ReadingGeometry,
) {
  const { p, step, originColumn, originY } = geometry;
  const localT = t - originColumn * step - originY;
  const optimum = (p * x + step * (localT - y)) / (p * p + step * step);
  const k = Math.round(optimum);
  return { left: k * p, top: localT - k * step };
}

export function restoredPosition(t: number, geometry: ReadingGeometry) {
  t = clamp(t, 0, Math.max(0, geometry.l - Math.max(1, geometry.unit)));
  const k = Math.floor(t / geometry.step);
  return {
    left: (k - geometry.originColumn) * geometry.p,
    top: t - k * geometry.step - geometry.originY,
  };
}

export function slotRange(x: number, width: number, geometry: ReadingGeometry, velocity = 0) {
  // Include both partial edge columns. Reuse a fixed pool: faster travel moves
  // its spare columns toward the direction of travel, rather than adding DOM.
  const visible = Math.ceil(width / geometry.p) + 1;
  const count = Math.min(geometry.n, visible + SLOT_OVERSCAN);
  const lookahead = clamp(Math.round(velocity * 120 / geometry.p), -2, 2);
  const behind = SLOT_OVERSCAN / 2 - lookahead;
  const start = clamp(Math.floor(x / geometry.p) - behind, 0, geometry.n - count);
  return { start, count };
}
