/** Application coordinates are integer multiples of 1/1024 CSS px. */
export const SCALE = 1024;
declare const tickBrand: unique symbol;
export type Tick = number & { readonly [tickBrand]: true };
export const ticks = (value: number) => { const rounded = Math.round(value); return (rounded === 0 ? 0 : rounded) as Tick; };
export const fromCss = (value: number) => ticks(value * SCALE);
export const toCss = (value: number) => value / SCALE;
export const zero = ticks(0);
const bounded = (value: number, min: number, max: number) => ticks(Math.min(Math.max(value, min), Math.max(min, max)));
export const floorDiv = (value: number, divisor: number) => Math.floor(value / divisor);
export const ceilDiv = (value: number, divisor: number) => -floorDiv(-value, divisor);

export interface ReadingPoint { readonly x: Tick; readonly y: Tick }
export interface ColumnMetrics {
  readonly w: Tick;
  readonly p: Tick;
  readonly h: Tick;
  readonly l: Tick;
  readonly viewportWidth: Tick;
  readonly edge: Tick;
}
export interface ReadingRange { min: Tick; max: Tick }
export function createLayout(w: number, gap: number, h: number, l: number, viewportWidth: number, edge: number): ColumnMetrics {
  const width = fromCss(w);
  return { w: width, p: ticks(width + fromCss(gap)), h: fromCss(h),
    l: fromCss(l), viewportWidth: fromCss(viewportWidth), edge: fromCss(edge) };
}
export function articleColumns(y: Tick, g: ColumnMetrics) {
  if (g.l <= g.h) return { first: 0, last: 0 };
  return { first: floorDiv(-y, g.h), last: ceilDiv(g.l - g.h - y, g.h) };
}

/** Ordinary horizontal input aligns the first/last sheet with the viewport. */
export function horizontalRange(y: Tick, g: ColumnMetrics): ReadingRange {
  if (g.l <= g.h) return { min: zero, max: zero };
  const { first, last } = articleColumns(y, g);
  const min = ticks(first * g.p);
  const right = ticks(last * g.p + g.w + 2 * g.edge - g.viewportWidth);
  // When the whole note fits across the screen, keep it at the leading edge.
  return { min, max: ticks(Math.max(min, right)) };
}

/** The extra runway is for vertical continuity, never an automatic x move. */
export function verticalRange(x: Tick, g: ColumnMetrics): ReadingRange {
  if (g.l <= g.h) return { min: zero, max: zero };
  const extra = Math.min(g.p, Math.max(0, g.viewportWidth - g.w - 2 * g.edge));
  const first = floorDiv(x + extra, g.p);
  const last = ceilDiv(x + g.viewportWidth - g.w - 2 * g.edge - extra, g.p);
  return { min: ticks(-first * g.h), max: ticks(Math.max(0, g.l - g.h) - last * g.h) };
}

/** A fringe reached vertically may be exited continuously, but not enlarged. */
export function horizontalInputRange(point: ReadingPoint, g: ColumnMetrics): ReadingRange {
  const range = horizontalRange(point.y, g);
  return { min: ticks(Math.min(point.x, range.min)), max: ticks(Math.max(point.x, range.max)) };
}
export function verticalInputRange(point: ReadingPoint, g: ColumnMetrics): ReadingRange {
  const range = verticalRange(point.x, g);
  return { min: ticks(Math.min(point.y, range.min)), max: ticks(Math.max(point.y, range.max)) };
}
export function horizontalDestination(point: ReadingPoint, x: Tick, g: ColumnMetrics): ReadingPoint {
  const range = horizontalInputRange(point, g);
  return { x: bounded(x, range.min, range.max), y: point.y };
}
export function verticalDestination(point: ReadingPoint, y: Tick, g: ColumnMetrics): ReadingPoint {
  const range = verticalInputRange(point, g);
  return { x: point.x, y: bounded(y, range.min, range.max) };
}
export function restoredPoint(anchor: Tick, g: ColumnMetrics): ReadingPoint {
  const t = bounded(anchor, 0, Math.max(0, g.l - g.h));
  if (g.l <= g.h) return { x: zero, y: zero };
  const k = floorDiv(t, g.h), y = ticks(t - k * g.h);
  const range = horizontalRange(y, g);
  return { x: bounded(k * g.p, range.min, range.max), y };
}
export function endPoint(g: ColumnMetrics): ReadingPoint {
  const t = ticks(Math.max(0, g.l - g.h));
  const restored = restoredPoint(t, g);
  const k = floorDiv(t, g.h), range = horizontalRange(restored.y, g);
  return { x: bounded(k * g.p + g.w + 2 * g.edge - g.viewportWidth, range.min, range.max), y: restored.y };
}
export function readingPosition(point: ReadingPoint, g: ColumnMetrics): Tick {
  return bounded(floorDiv(point.x, g.p) * g.h + point.y, 0, Math.max(0, g.l - g.h));
}
export function nearestPoint(anchor: Tick, point: ReadingPoint, g: ColumnMetrics): ReadingPoint {
  const t = bounded(anchor, 0, Math.max(0, g.l - g.h));
  // Only candidate selection uses a floating distance. The resulting position
  // and all constraints are exact integer coordinates.
  const p = toCss(g.p), s = toCss(g.h);
  const k = Math.round((p * toCss(point.x) + s * toCss(t - point.y)) / (p * p + s * s));
  const y = ticks(t - k * g.h), range = horizontalRange(y, g);
  return { x: bounded(k * g.p, range.min, range.max), y };
}
/** A change in article length alone (a details element opened or closed, an
 * image loaded) keeps the point, so everything before the change stays put.
 * Only the ends move with the length, so each axis is pulled back by at most
 * the amount its end moved; a fringe already reached is kept, not enlarged. */
export function refitPoint(point: ReadingPoint, from: ColumnMetrics, to: ColumnMetrics): ReadingPoint {
  if (to.l <= to.h) return { x: zero, y: zero };
  if (from.l <= from.h) return point;
  const x = ticks(Math.min(point.x,
    horizontalRange(point.y, to).max + Math.max(0, point.x - horizontalRange(point.y, from).max)));
  const y = ticks(Math.min(point.y,
    verticalRange(x, to).max + Math.max(0, point.y - verticalRange(point.x, from).max)));
  return { x, y };
}
export function slotColumns(point: ReadingPoint, g: ColumnMetrics) {
  if (g.l <= g.h) return { start: 0, count: 1 };
  return { start: floorDiv(point.x - g.edge + g.p - g.w, g.p), count: ceilDiv(g.viewportWidth, g.p) + 1 };
}
export function visibleColumnCount(point: ReadingPoint, g: ColumnMetrics) {
  const article = articleColumns(point.y, g);
  const first = Math.max(article.first, floorDiv(point.x - g.edge + g.p - g.w, g.p));
  const last = Math.min(article.last, ceilDiv(point.x + g.viewportWidth - g.edge, g.p) - 1);
  return Math.max(1, last - first + 1);
}

/** The part of a column that holds article text, from the column's top. */
export function paperWindow(from: Tick, g: ColumnMetrics) {
  const top = bounded(-from, 0, g.h), bottom = bounded(g.l - from, top, g.h);
  return { top, height: ticks(bottom - top) };
}

export class ReadingState {
  private location: ReadingPoint;
  readonly layout: ColumnMetrics;
  constructor(layout: ColumnMetrics, anchor: Tick = zero) { this.layout = layout; this.location = restoredPoint(anchor, layout); }
  get point() { return this.location; }
  get anchor() { return readingPosition(this.location, this.layout); }
  horizontal(x: Tick) { this.location = horizontalDestination(this.location, x, this.layout); }
  vertical(y: Tick) { this.location = verticalDestination(this.location, y, this.layout); }
  home() { this.location = { x: zero, y: zero }; }
  end() { this.location = endPoint(this.layout); }
  restore(anchor: Tick) { this.location = restoredPoint(anchor, this.layout); }
  // Only restore points previously produced by this same layout.
  restorePoint(point: ReadingPoint) { this.location = { x: point.x, y: point.y }; }
  navigate(anchor: Tick) { this.location = nearestPoint(anchor, this.location, this.layout); }
}
