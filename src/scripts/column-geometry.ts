import { ceilDiv, floorDiv, fromCss, ticks, toCss, horizontalInputRange, verticalInputRange,
  type ColumnMetrics, type ReadingPoint, type ReadingRange, type Tick } from "./column-coordinates.ts";

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Rounds a CSS offset to whole device pixels. `unit` is one device pixel in
 * CSS px (1 / devicePixelRatio). Trailing float noise is cut so the same
 * offset always yields the same CSS text. */
export const devicePixels = (value: number, unit: number) => {
  if (!(unit > 0)) return value;
  const rounded = Number((Math.round(value / unit) * unit).toFixed(4));
  return rounded === 0 ? 0 : rounded;
};

/** CSS-only projection. Never use these browser-rounded values as app state. */
export interface ColumnGeometry {
  w: number; p: number; h: number; l: number;
  viewportWidth: number; edge: number; unit: number;
  originColumn: number; originY: number; leading: number;
  n: number; maxX: number; maxY: number;
}
export interface NativeAxis {
  origin: Tick; span: Tick; min: Tick; max: Tick; first: boolean; last: boolean;
}
export interface NativeWindow { x: NativeAxis; y: NativeAxis; column: number; count: number }
function axisWindow(value: Tick, range: ReadingRange, capacity: Tick, period: Tick, previous?: NativeAxis): NativeAxis {
  const span = ticks(Math.min(capacity, range.max - range.min));
  const margin = Math.min(span / 4, 16 * period);
  let origin = previous?.origin ?? ticks(value - Math.floor(span / 2));
  if (value - origin < margin || value - origin > span - margin) origin = ticks(value - Math.floor(span / 2));
  origin = ticks(clamp(origin, range.min, Math.max(range.min, range.max - span)));
  return { origin, span, min: range.min, max: range.max, first: origin === range.min, last: origin + span === range.max };
}
export function nativeWindow(point: ReadingPoint, g: ColumnMetrics, previous?: NativeWindow): NativeWindow {
  const capacity = Math.max(128, ceilDiv(g.viewportWidth, g.p) + 32);
  const x = axisWindow(point.x, horizontalInputRange(point, g), ticks((capacity - 2) * g.p), g.p, previous?.x);
  const y = axisWindow(point.y, verticalInputRange(point, g), ticks(127 * g.h), g.h, previous?.y);
  const column = floorDiv(x.origin, g.p);
  const count = g.l <= g.h ? 1 : Math.max(1, ceilDiv(x.origin + x.span + g.viewportWidth - g.edge, g.p) - column);
  return { x, y, column, count };
}
export function cssGeometry(g: ColumnMetrics, point: ReadingPoint, window: NativeWindow, nativeX: number, nativeY: number, unit: number): ColumnGeometry {
  return { w: toCss(g.w), p: toCss(g.p), h: toCss(g.h), l: toCss(g.l),
    viewportWidth: toCss(g.viewportWidth), edge: toCss(g.edge), unit,
    // Share the adapter's integer grid: native scrolling then leaves these
    // offsets constant instead of rewriting every text root for sub-tick noise.
    originColumn: window.column, originY: toCss(point.y - fromCss(nativeY)),
    leading: toCss(window.column * g.p - point.x + fromCss(nativeX)),
    n: window.count, maxX: toCss(window.x.span), maxY: toCss(window.y.span) };
}
