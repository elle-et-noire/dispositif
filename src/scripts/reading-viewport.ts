import { fromCss, ticks, toCss, type ReadingLayout, type ReadingPoint, type Tick } from "./reading-coordinates.ts";
import { cssGeometry, nativeWindow, type NativeWindow, type ReadingGeometry } from "./reading-geometry.ts";

export interface NativeMovement { x?: Tick; y?: Tick }
/** The sole boundary between browser floats and integer application positions. */
export class ReadingViewport {
  private window?: NativeWindow;
  private lastX = 0;
  private lastY = 0;
  private viewport: HTMLElement;
  private plane: HTMLElement;
  private unit: number;
  constructor(viewport: HTMLElement, plane: HTMLElement, unit = 1) { this.viewport = viewport; this.plane = plane; this.unit = unit; }
  setUnit(unit: number) { this.unit = unit; }
  reset() { this.window = undefined; this.observe(); }
  private observe() { this.lastX = this.viewport.scrollLeft; this.lastY = this.viewport.scrollTop; }
  read(point: ReadingPoint): NativeMovement | undefined {
    if (!this.window) { this.observe(); return; }
    const x = this.viewport.scrollLeft, y = this.viewport.scrollTop;
    const dx = x - this.lastX, dy = y - this.lastY;
    // Quantize each observed offset once, then subtract. These differences
    // telescope exactly, and use the same grid as the CSS projection. Rounding
    // accumulated floating deltas made the projection wobble by one tick.
    const deltaX = fromCss(x) - fromCss(this.lastX), deltaY = fromCss(y) - fromCss(this.lastY);
    this.observe();
    if (!dx && !dy) return;
    const movement: NativeMovement = {};
    // Integer extents and native offset quantization have different rounding.
    // This tolerance belongs only to the browser adapter, not layout rules.
    const tolerance = 1 + this.unit;
    if (dx) {
      movement.x = ticks(point.x + deltaX);
      if (dx < 0 && this.window.x.first && x <= tolerance && Math.abs(toCss(movement.x - this.window.x.min)) <= tolerance) movement.x = this.window.x.min;
      if (dx > 0 && this.window.x.last && x >= this.viewport.scrollWidth - this.viewport.clientWidth - tolerance
        && Math.abs(toCss(movement.x - this.window.x.max)) <= tolerance) movement.x = this.window.x.max;
    }
    if (dy) {
      movement.y = ticks(point.y + deltaY);
      if (dy < 0 && this.window.y.first && y <= tolerance && Math.abs(toCss(movement.y - this.window.y.min)) <= tolerance) movement.y = this.window.y.min;
      if (dy > 0 && this.window.y.last && y >= this.viewport.scrollHeight - this.viewport.clientHeight - tolerance
        && Math.abs(toCss(movement.y - this.window.y.max)) <= tolerance) movement.y = this.window.y.max;
    }
    return movement;
  }
  place(point: ReadingPoint, layout: ReadingLayout, force = false): ReadingGeometry {
    const next = nativeWindow(point, layout, this.window);
    const changed = !this.window || next.x.origin !== this.window.x.origin || next.y.origin !== this.window.y.origin
      || next.x.span !== this.window.x.span || next.y.span !== this.window.y.span;
    this.window = next;
    const width = `calc(100% + ${toCss(next.x.span)}px)`, height = `calc(100% + ${toCss(next.y.span)}px)`;
    if (this.plane.style.width !== width) this.plane.style.width = width;
    if (this.plane.style.height !== height) this.plane.style.height = height;
    if (force || changed) {
      const x = toCss(point.x - next.x.origin), y = toCss(point.y - next.y.origin);
      if (force) this.viewport.scrollTo({ left: x, top: y, behavior: "instant" });
      else {
        if (Math.abs(this.viewport.scrollLeft - x) > this.unit / 2) this.viewport.scrollLeft = x;
        if (Math.abs(this.viewport.scrollTop - y) > this.unit / 2) this.viewport.scrollTop = y;
      }
    }
    // A write is acknowledged by its REALIZED offsets, never fed back as input.
    this.observe();
    const view = cssGeometry(layout, point, next, this.lastX, this.lastY, this.unit);
    this.plane.dataset.rmOriginColumn = String(view.originColumn);
    this.plane.dataset.rmOriginY = String(view.originY);
    this.plane.dataset.rmLeading = String(view.leading);
    this.plane.dataset.rmXTicks = String(point.x);
    this.plane.dataset.rmYTicks = String(point.y);
    return view;
  }
}
