import { prefersMulti, READING_MODE_STORAGE_KEY } from "./reading-preference";

/** An already initialized reader. Its owner must remove the frame when done. */
export interface PreparedReading {
  url: string;
  frame: HTMLIFrameElement;
  width: number;
  height: number;
  pixelRatio: number;
}

interface Candidate extends PreparedReading {
  controller: AbortController;
  promise: Promise<PreparedReading | null>;
  ready: boolean;
  preference: string | null;
  expiry?: number;
}

const PREPARATION_TIMEOUT_MS = 20_000;
const RETENTION_MS = 15_000;

function currentPreference(): string | null {
  try { return localStorage.getItem(READING_MODE_STORAGE_KEY); }
  catch { return null; }
}

/** Avoid a speculative full article on explicit data saving or very low RAM. */
function resourcesAllowPreparation(): boolean {
  const hints = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return !hints.connection?.saveData && !(typeof hints.deviceMemory === "number" && hints.deviceMemory > 0 && hints.deviceMemory <= 2);
}

/** Measure the same CSS ruler used by the article's first-visit heuristic. */
export function shouldPrepareMulti(): boolean {
  if (matchMedia("print").matches || !resourcesAllowPreparation()) return false;
  const preference = currentPreference();
  if (preference === "multi") return true;
  if (preference === "single") return false;
  const ruler = document.createElement("div");
  ruler.className = "rm-ruler";
  document.body.append(ruler);
  const pitch = ruler.getBoundingClientRect().width + (parseFloat(getComputedStyle(ruler).marginRight) || 0);
  ruler.remove();
  return prefersMulti(preference, innerWidth, pitch);
}

function canonicalUrl(input: string): string | null {
  try {
    const url = new URL(input, location.href);
    if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/**
 * Keeps at most one offscreen, fully initialized reader. This coordinator does
 * not install navigation handlers: a caller must explicitly take a ready
 * reader and integrate its history, controls, print and disposal lifecycle.
 */
export class ReadingPreloader {
  private candidate?: Candidate;
  private readonly controller = new AbortController();

  constructor(private readonly retentionMs = RETENTION_MS, private readonly timeoutMs = PREPARATION_TIMEOUT_MS) {
    const invalidateChangedViewport = () => {
      if (this.candidate && !this.sameViewport(this.candidate)) this.cancel();
    };
    window.addEventListener("resize", invalidateChangedViewport, { signal: this.controller.signal });
    window.visualViewport?.addEventListener("resize", invalidateChangedViewport, { signal: this.controller.signal });
    window.addEventListener("storage", (event) => {
      if (event.key === READING_MODE_STORAGE_KEY || event.key === null) this.cancel();
    }, { signal: this.controller.signal });
  }

  prepare(input: string): Promise<PreparedReading | null> {
    const url = canonicalUrl(input);
    if (this.controller.signal.aborted || !url || !shouldPrepareMulti()) {
      this.cancel();
      return Promise.resolve(null);
    }
    if (this.candidate?.url === url) return this.candidate.promise;
    this.cancel();

    const frame = document.createElement("iframe");
    frame.title = "";
    // The child can distinguish an abandoned speculative load from an opened
    // article and avoid saving an unused history entry.
    frame.dataset.rmPreparing = "";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.inert = true;
    frame.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:-1;pointer-events:none;transform:translateX(-200vw)";
    const controller = new AbortController();
    const candidate: Candidate = {
      url, frame, width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio,
      controller, ready: false, preference: currentPreference(), promise: Promise.resolve(null),
    };
    this.candidate = candidate;
    // Install the observer before starting navigation; do not mistake the
    // initial about:blank document for the requested reader.
    candidate.promise = this.waitUntilReady(candidate);
    frame.src = url;
    document.documentElement.append(frame);
    return candidate.promise;
  }

  private waitUntilReady(candidate: Candidate): Promise<PreparedReading | null> {
    return new Promise((resolve) => {
      let interval = 0;
      let timeout = 0;
      let stableFrames = 0;
      let generation = 0;
      let framePending = false;
      let lastDocument: Document | undefined;
      let loadedDocument: Document | undefined;
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        candidate.controller.signal.removeEventListener("abort", abort);
        candidate.frame.removeEventListener("error", error);
        candidate.frame.removeEventListener("load", loaded);
        if (!ready || this.candidate !== candidate) {
          if (this.candidate === candidate) this.cancel();
          resolve(null);
          return;
        }
        candidate.ready = true;
        candidate.frame.dataset.rmPreloadReady = "";
        candidate.expiry = window.setTimeout(() => {
          if (this.candidate === candidate) this.cancel();
        }, this.retentionMs);
        resolve(candidate);
      };
      const abort = () => finish(false);
      const error = () => finish(false);
      const loaded = () => {
        try {
          const doc = candidate.frame.contentDocument;
          if (doc && doc.URL !== "about:blank" && canonicalUrl(doc.URL) === candidate.url) loadedDocument = doc;
        } catch { /* A redirected cross-origin frame is rejected by check. */ }
      };
      const check = () => {
        if (candidate.controller.signal.aborted || this.candidate !== candidate) { finish(false); return; }
        if (!this.sameViewport(candidate) || currentPreference() !== candidate.preference || matchMedia("print").matches || !resourcesAllowPreparation()) { finish(false); return; }
        try {
          const child = candidate.frame.contentWindow;
          const doc = candidate.frame.contentDocument;
          if (!child || !doc || child.location.href === "about:blank") { stableFrames = 0; return; }
          if (canonicalUrl(child.location.href) !== candidate.url) { finish(false); return; }
          const root = doc.documentElement;
          if (loadedDocument === doc && doc.readyState === "complete" && root.dataset.pageKind !== "article") { finish(false); return; }
          const source = doc.querySelector<HTMLElement>(".rm-source");
          const ready = root.dataset.pageKind === "article" && root.classList.contains("rm-active")
            && !root.classList.contains("rm-pending") && !root.classList.contains("rm-fallback")
            && !!source && !!doc.querySelector(".rm-slot") && doc.fonts.status === "loaded"
            && [...source.querySelectorAll("img")].every(image => image.complete)
            && child.innerWidth === candidate.width && child.innerHeight === candidate.height;
          if (!ready || lastDocument !== doc) {
            stableFrames = 0;
            generation++;
            lastDocument = doc;
            if (!ready) return;
          }
          // Observe two real frames, not just timers: pending font, image and
          // resize notifications can otherwise follow an apparently ready DOM.
          if (stableFrames >= 2) { finish(true); return; }
          if (!framePending) {
            framePending = true;
            const observedGeneration = generation;
            child.requestAnimationFrame(() => {
              framePending = false;
              if (!settled && observedGeneration === generation) stableFrames++;
            });
          }
        } catch { finish(false); }
      };
      candidate.controller.signal.addEventListener("abort", abort, { once: true });
      candidate.frame.addEventListener("error", error, { once: true });
      candidate.frame.addEventListener("load", loaded);
      interval = window.setInterval(check, 50);
      timeout = window.setTimeout(() => finish(false), this.timeoutMs);
    });
  }

  private sameViewport(candidate: Candidate): boolean {
    return candidate.width === innerWidth && candidate.height === innerHeight && candidate.pixelRatio === devicePixelRatio;
  }

  /** Return a finished candidate only when its mode and viewport still match. */
  take(input: string): PreparedReading | null {
    const entry = this.candidate;
    if (!entry || !entry.ready || canonicalUrl(input) !== entry.url || !this.sameViewport(entry) || !shouldPrepareMulti()) {
      this.cancel();
      return null;
    }
    try {
      const doc = entry.frame.contentDocument;
      const source = doc?.querySelector<HTMLElement>(".rm-source");
      const child = entry.frame.contentWindow;
      if (!entry.frame.isConnected || !doc || !child || canonicalUrl(child.location.href) !== entry.url
        || child.innerWidth !== entry.width || child.innerHeight !== entry.height
        || !doc.documentElement.classList.contains("rm-active") || doc.documentElement.classList.contains("rm-pending")
        || doc.fonts.status !== "loaded" || !source || !doc.querySelector(".rm-slot")
        || [...source.querySelectorAll("img")].some(image => !image.complete)) {
        this.cancel();
        return null;
      }
    } catch { this.cancel(); return null; }
    this.candidate = undefined;
    clearTimeout(entry.expiry);
    return entry;
  }

  cancel(): void {
    const entry = this.candidate;
    if (!entry) return;
    this.candidate = undefined;
    clearTimeout(entry.expiry);
    entry.controller.abort();
    entry.frame.remove();
  }

  dispose(): void {
    this.cancel();
    this.controller.abort();
  }
}
