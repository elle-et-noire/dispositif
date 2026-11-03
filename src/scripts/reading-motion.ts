import { ticks, horizontalDestination, type ReadingPoint as Point, type ReadingLayout } from "./reading-coordinates";
interface ColumnAnimation {
  from: Point;
  to: Point;
  direction: number;
  start: number;
}

/** Interruptible, time-based motion only for explicit column keys. */
export class ReadingMotion {
  private animation: ColumnAnimation | undefined;
  private frame = 0;

  constructor(
    private geometry: () => ReadingLayout | undefined,
    private current: () => Point,
    private move: (point: Point) => void,
    private reducedMotion: MediaQueryList,
    private animationChanged: (active: boolean) => void,
    signal: AbortSignal,
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
    if (this.reducedMotion.matches || from.x === to.x) {
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
      this.move({
        x: ticks(animation.from.x + (animation.to.x - animation.from.x) * eased),
        y: animation.from.y,
      });
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else this.cancelAnimation();
    };
    this.frame = requestAnimationFrame(tick);
  }
}
