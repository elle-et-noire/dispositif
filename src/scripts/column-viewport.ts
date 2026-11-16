import { fromCss, ticks, toCss, type ColumnMetrics, type ReadingPoint, type Tick } from "./column-coordinates.ts";
import { cssGeometry, nativeWindow, type NativeAxis, type NativeWindow, type ColumnGeometry } from "./column-geometry.ts";

const sameAxis = (a: NativeAxis, b: NativeAxis) => a.origin === b.origin && a.span === b.span;

export interface NativeMovement { x?: Tick; y?: Tick }
/** The sole boundary between browser floats and integer application positions. */
export class ColumnViewport {
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
  /** True while place() keeps an axis's old window. A place() without `moved` replaces it. */
  deferred = false;
  /** `moved` is the native movement that led to this point. */
  place(point: ReadingPoint, layout: ColumnMetrics, force = false, moved?: NativeMovement): ColumnGeometry {
    const previous = this.window;
    let next = nativeWindow(point, layout, previous);
    // Crossing a column boundary along one axis shifts the other axis's range,
    // and a new window there needs an offset write on that axis. WebKit stops
    // a running scroll animation on any offset write, so the rest of a wheel
    // scroll would be lost. The point has not moved along that axis, so its
    // old window still holds it: keep it until the scroll ends.
    const keepX = !force && !!moved && moved.x === undefined && !!previous && !sameAxis(next.x, previous.x);
    const keepY = !force && !!moved && moved.y === undefined && !!previous && !sameAxis(next.y, previous.y);
    if (keepX || keepY) next = nativeWindow(point, layout, previous, { x: keepX, y: keepY });
    this.deferred = keepX || keepY;
    const changed = !previous || !sameAxis(next.x, previous.x) || !sameAxis(next.y, previous.y);
    this.window = next;
    const width = `calc(100% + ${toCss(next.x.span)}px)`, height = `calc(100% + ${toCss(next.y.span)}px)`;
    if (this.plane.style.width !== width) this.plane.style.width = width;
    if (this.plane.style.height !== height) this.plane.style.height = height;
    if (force || changed) {
      const x = toCss(point.x - next.x.origin), y = toCss(point.y - next.y.origin);
      if (force) this.viewport.scrollTo({ left: x, top: y, behavior: "instant" });
      else {
        // Firefox carries a running scroll animation over a relative scroll,
        // but stops it on an absolute write.
        const dx = x - this.viewport.scrollLeft, dy = y - this.viewport.scrollTop;
        const left = Math.abs(dx) > this.unit / 2 ? dx : 0, top = Math.abs(dy) > this.unit / 2 ? dy : 0;
        if (left || top) this.viewport.scrollBy({ left, top, behavior: "instant" });
      }
    }
    // A write is acknowledged by its REALIZED offsets, never fed back as input.
    this.observe();
    const view = cssGeometry(layout, point, next, this.lastX, this.lastY, this.unit);
    const data = this.plane.dataset;
    const update = (key: string, value: number) => {
      const text = String(value);
      if (data[key] !== text) data[key] = text;
    };
    update("clOriginColumn", view.originColumn);
    update("clOriginY", view.originY);
    update("clLeading", view.leading);
    update("clXTicks", point.x);
    update("clYTicks", point.y);
    return view;
  }
}
