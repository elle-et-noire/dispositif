import { fromCss, ticks, horizontalDestination, type ReadingPoint as Point, type ColumnMetrics } from "./column-coordinates";
interface ColumnAnimation {
  from: Point;
  to: Point;
  direction: number;
  start: number;
}

/** Interruptible, time-based motion only for explicit column keys. */
export class ColumnMotion {
  private animation: ColumnAnimation | undefined;
  private frame = 0;

  constructor(
    private geometry: () => ColumnMetrics | undefined,
    private current: () => Point,
    private move: (point: Point) => void,
    private reducedMotion: MediaQueryList,
    private animationChanged: (active: boolean) => void,
    signal: AbortSignal,
    // The native scroll step in CSS px (0 when unknown).
    private scrollUnit: () => number = () => 0,
  ) {
    reducedMotion.addEventListener("change", () => {
      if (!reducedMotion.matches || !this.animation) return;
      const target = this.animation.to;
      this.cancelAnimation();
      this.move(target);
    }, { signal });
  }

  cancelAnimation() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.animation = undefined;
    this.animationChanged(false);
  }

  reset() { this.cancelAnimation(); }

  column(direction: number) {
    const geometry = this.geometry();
    if (!geometry) return;
    const current = this.current();
    const base = this.animation?.direction === direction ? this.animation.to.x : current.x;
    this.animateTo({ x: ticks(base + direction * geometry.p), y: current.y }, direction);
  }

  private animateTo(target: Point, direction = 0) {
    const geometry = this.geometry();
    if (!geometry) return;
    const to = horizontalDestination(this.current(), target.x, geometry);
    const from = this.current();
    this.reset();
    // An arrow pressed against an edge has no destination change. Avoid a
    // forced native scroll and a full presentation update for the same point.
    if (from.x === to.x) return;
    if (this.reducedMotion.matches) {
      this.move(to);
      return;
    }
    const animation = { from, to, direction, start: performance.now() };
    this.animation = animation;
    this.animationChanged(true);
    const tick = (time: number) => {
      if (this.animation !== animation) return;
      const progress = Math.min(1, Math.max(0, (time - animation.start) / 180));
      const eased = 1 - (1 - progress) ** 3;
      // Step the frames between the ends by whole native scroll steps. The
      // browser rounds a scroll offset to its step, and the columns absorb
      // the rounded-off fraction (cssGeometry's leading), so an off-step
      // frame rewrote every column's position and repainted the text.
      const step = fromCss(this.scrollUnit());
      const distance = (animation.to.x - animation.from.x) * eased;
      const x = progress < 1 && step > 0
        ? ticks(animation.from.x + Math.round(distance / step) * step)
        : ticks(animation.from.x + distance);
      this.move({ x, y: animation.from.y });
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else this.cancelAnimation();
    };
    this.frame = requestAnimationFrame(tick);
  }
}
