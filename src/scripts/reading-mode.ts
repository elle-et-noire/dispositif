import {
  clamp, columnStep, columnWidth, nearestPosition, positionAt, restoredPosition, slotRange,
  type ReadingGeometry,
} from "./reading-geometry";

const STORAGE_KEY = "dispositif:reading-mode";
let dispose: (() => void) | undefined;

export function initializeReadingMode() {
  dispose?.();
  const root = document.documentElement;
  const source = document.querySelector<HTMLElement>(".rm-source");
  const viewport = document.querySelector<HTMLElement>(".rm-viewport");
  const reader = document.querySelector<HTMLElement>(".rm-reader");
  const plane = document.querySelector<HTMLElement>(".rm-plane");
  const ruler = document.querySelector<HTMLElement>(".rm-ruler");
  const toggle = document.querySelector<HTMLButtonElement>(".rm-toggle");
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const toolbar = document.querySelector<HTMLElement>(".rm-toolbar");
  if (!source || !viewport || !reader || !plane || !ruler || !toggle) return;

  const controller = new AbortController();
  const { signal } = controller;
  const printing = window.matchMedia("print");
  let preference: string | null = null;
  try { preference = localStorage.getItem(STORAGE_KEY); } catch { /* storage is optional */ }
  let enabled = false;
  let geometry: ReadingGeometry | undefined;
  let position = 0;
  let measuring = 0;
  let scrolling = 0;
  let rangeStart = -1;
  let dirty = true;
  let activeHeading = "";
  let slots: HTMLElement[] = [];
  let headings: { id: string; t: number }[] = [];

  const offsetOf = (element: Element) =>
    element.getBoundingClientRect().top - source.getBoundingClientRect().top;

  const announceHeading = () => {
    const id = [...headings].reverse().find((heading) => heading.t <= position + 64)?.id
      ?? headings[0]?.id ?? "";
    if (id === activeHeading) return;
    activeHeading = id;
    document.dispatchEvent(new CustomEvent("rm:heading", { detail: { id } }));
  };

  const updateSlots = () => {
    if (!geometry) return;
    const { start, count } = slotRange(viewport.scrollLeft, viewport.clientWidth, geometry);
    if (start === rangeStart && slots.length === count && !dirty) return;
    if (dirty || slots.length !== count) {
      slots.forEach((slot) => slot.parentElement?.remove());
      slots = Array.from({ length: count }, () => {
        const track = document.createElement("div");
        track.className = "rm-track";
        const slot = document.createElement("div");
        slot.className = "rm-slot";
        slot.setAttribute("aria-hidden", "true");
        const content = source.cloneNode(true) as HTMLElement;
        content.classList.remove("rm-source");
        content.classList.add("rm-content");
        content.removeAttribute("style");
        content.removeAttribute("id");
        content.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
        content.querySelectorAll<HTMLElement>(
          "a, button, input, select, textarea, summary, [tabindex], [contenteditable], audio, video",
        ).forEach((element) => {
          element.tabIndex = -1;
          element.removeAttribute("autofocus");
          element.removeAttribute("contenteditable");
        });
        // CHTML is already rendered at build time. No MathJax runtime to rerun.
        // Existing copy buttons use document-level event delegation.
        content.querySelectorAll("script").forEach((script) => script.remove());
        slot.appendChild(content);
        track.appendChild(slot);
        plane.appendChild(track);
        return slot;
      });
      dirty = false;
      rangeStart = -1;
    }
    const wanted = new Set(Array.from({ length: count }, (_, i) => start + i));
    const retained = new Set(slots.map((slot) => Number(slot.dataset.rmK)));
    const missing = [...wanted].filter((k) => !retained.has(k));
    for (const slot of slots) {
      const old = slot.dataset.rmK;
      if (old !== undefined && wanted.has(Number(old))) continue;
      const k = missing.shift();
      if (k === undefined) continue;
      slot.dataset.rmK = String(k);
      slot.parentElement!.style.setProperty("--k", String(k));
    }
    rangeStart = start;
  };

  const syncPosition = () => {
    if (!enabled || !geometry) return;
    position = positionAt(viewport.scrollLeft, viewport.scrollTop, geometry);
    updateSlots();
    announceHeading();
  };

  // One scroll owner. Never synchronize scrollTop between different elements.
  const scrollTo = (left: number, top: number) => {
    viewport.scrollTo({ left, top, behavior: "instant" });
    syncPosition();
  };

  const measure = () => {
    measuring = 0;
    if (!enabled || printing.matches) return;
    const anchor = position;
    root.style.setProperty("--rm-header-height", `${header?.getBoundingClientRect().height ?? 0}px`);
    const gap = Math.max(0, parseFloat(getComputedStyle(ruler).marginRight) || 0);
    // DPR alone is insufficient: browser zoom and device emulation can round
    // scrollLeft differently. Probe a hidden, lightweight CSS ruler instead.
    ruler.scrollLeft = 1 / (window.devicePixelRatio || 1);
    if (!ruler.scrollLeft) ruler.scrollLeft = 1;
    const scrollStep = ruler.scrollLeft || 1;
    ruler.scrollLeft = 0;
    const w = columnWidth(
      Math.min(ruler.getBoundingClientRect().width, viewport.clientWidth),
      gap,
      scrollStep,
    );
    source.style.width = `${w}px`;
    const h = Math.max(1, viewport.clientHeight);
    const step = columnStep(h, parseFloat(getComputedStyle(ruler).paddingTop) || 0);
    const l = Math.max(1, Math.ceil(source.getBoundingClientRect().height));
    const n = Math.ceil(Math.max(0, l - h) / step) + 1;
    const p = w + gap;
    headings = Array.from(source.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
      (heading) => ({ id: heading.id, t: offsetOf(heading) }));
    // ResizeObserver may report the same layout again after our own writes.
    // Do not canonicalize a deliberate heading jump or rebuild unchanged slots.
    if (geometry && geometry.w === w && geometry.p === p && geometry.h === h
      && geometry.step === step && geometry.l === l
      && Math.abs(geometry.maxX - Math.max(0, n * p - gap - viewport.clientWidth)) < 0.02) {
      updateSlots();
      announceHeading();
      return;
    }
    if (geometry?.w !== w) dirty = true;
    plane.style.setProperty("--rm-w", `${w}px`);
    plane.style.setProperty("--rm-p", `${p}px`);
    plane.style.setProperty("--rm-h", `${h}px`);
    plane.style.setProperty("--rm-step", `${step}px`);
    plane.style.setProperty("--rm-overlap", `${h - step}px`);
    plane.style.setProperty("--rm-l", `${l}px`);
    plane.style.width = `${n * p - gap}px`;
    plane.style.height = `${l}px`;
    geometry = { w, p, h, step, l, n, maxX: Math.max(0, plane.getBoundingClientRect().width - viewport.clientWidth), maxY: Math.max(0, l - h) };
    rangeStart = -1;
    const restored = restoredPosition(anchor, geometry);
    scrollTo(restored.left, restored.top);
  };

  const scheduleMeasure = () => {
    if (enabled && !measuring) measuring = requestAnimationFrame(measure);
  };

  const syncDetails = () => {
    const originals = source.querySelectorAll<HTMLDetailsElement>("details");
    slots.forEach((slot) => {
      slot.querySelectorAll<HTMLDetailsElement>("details").forEach((details, i) => {
        if (originals[i]) details.open = originals[i].open;
      });
    });
  };

  const navigate = (target: HTMLElement) => {
    if (!enabled) return;
    const fromX = viewport.scrollLeft;
    const fromY = viewport.scrollTop;
    let parent = target.parentElement;
    while (parent && parent !== source) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    syncDetails();
    // Flush measurement so freshly opened details and loaded images are included.
    cancelAnimationFrame(measuring);
    measure();
    if (!geometry) return;
    const destination = nearestPosition(offsetOf(target), fromX, fromY, geometry);
    scrollTo(destination.left, destination.top);
  };

  const hashTarget = (hash: string) => {
    try {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      return target && source.contains(target) ? target : null;
    } catch { return null; }
  };

  const followHash = () => {
    if (!enabled || !location.hash) return;
    const target = hashTarget(location.hash);
    if (target) navigate(target);
  };

  const setEnabled = (next: boolean) => {
    if (next === enabled) return;
    if (next) position = Math.max(0, -source.getBoundingClientRect().top);
    enabled = next;
    root.classList.toggle("rm-active", enabled);
    reader.hidden = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "1段 / n段 ✓" : "1段 / n段";
    activeHeading = "";
    if (enabled) {
      // The hidden measurement tree must acquire image dimensions too; a lazy
      // image only loaded inside a visible clone cannot size the original tree.
      source.querySelectorAll<HTMLImageElement>("img").forEach((image) => { image.loading = "eager"; });
      dirty = true;
      measure();
      window.scrollTo({ top: 0, behavior: "instant" });
    } else {
      source.style.removeProperty("width");
      plane.replaceChildren();
      slots = [];
      geometry = undefined;
      rangeStart = -1;
      window.scrollTo({ top: window.scrollY + source.getBoundingClientRect().top + position, behavior: "instant" });
      document.dispatchEvent(new CustomEvent("rm:off"));
    }
  };

  const applyDefault = () => {
    const p = ruler.getBoundingClientRect().width + (parseFloat(getComputedStyle(ruler).marginRight) || 0);
    setEnabled(preference === "multi" || (preference !== "single" && window.innerWidth >= 2 * p));
  };

  toggle.addEventListener("click", () => {
    preference = enabled ? "single" : "multi";
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* storage is optional */ }
    setEnabled(!enabled);
  }, { signal });

  viewport.addEventListener("scroll", () => {
    if (!scrolling) scrolling = requestAnimationFrame(() => {
      scrolling = 0;
      // ResizeObserver's anchor takes priority over scrolls caused by resizing.
      if (!measuring) syncPosition();
    });
  }, { passive: true, signal });

  document.addEventListener("click", (event) => {
    if (!enabled || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const element = event.target instanceof Element ? event.target : null;
    const slot = element?.closest(".rm-slot");
    const control = element?.closest("summary, [data-details-close]");
    if (slot && control) {
      const details = control.closest("details");
      const index = [...slot.querySelectorAll("details")].indexOf(details!);
      const original = source.querySelectorAll<HTMLDetailsElement>("details")[index];
      if (original) {
        event.preventDefault();
        event.stopPropagation();
        original.open = control.matches("summary") ? !original.open : false;
        syncDetails();
        scheduleMeasure();
      }
      return;
    }
    const link = element?.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
    const target = hashTarget(url.hash);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(target);
    history.replaceState(history.state, "", url.hash);
    link.closest(".rm-toolbar details")?.removeAttribute("open");
    if (event.detail === 0) {
      if (!target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
      }
      target.focus({ preventScroll: true });
    }
  }, { capture: true, signal });

  document.addEventListener("toggle", (event) => {
    if (enabled && event.target instanceof HTMLDetailsElement && source.contains(event.target)) {
      syncDetails();
      scheduleMeasure();
    }
  }, { capture: true, signal });

  document.addEventListener("keydown", (event) => {
    if (!enabled || !geometry || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, button, summary, [contenteditable="true"], [data-toc]')) return;
    if (event.key === " " && target?.closest("a")) return;
    const scrollable = target?.closest<HTMLElement>("pre, .scrollable, table");
    if (scrollable && (scrollable.scrollWidth > scrollable.clientWidth || scrollable.scrollHeight > scrollable.clientHeight)) return;
    let x = viewport.scrollLeft;
    let y = viewport.scrollTop;
    const { p, step, maxX, maxY } = geometry;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      x += event.key === "ArrowLeft" ? -p : p;
    } else if (["PageDown", "PageUp", " "].includes(event.key)) {
      const direction = event.key === "PageUp" || (event.key === " " && event.shiftKey) ? -1 : 1;
      const first = Math.floor(x / p);
      const last = Math.min(geometry.n - 1, Math.floor((x + viewport.clientWidth - 1) / p));
      const delta = direction * (last - first + 1) * step;
      const nextY = clamp(y + delta, 0, maxY);
      if (Math.abs(nextY - y) > 0.5) y = nextY;
      else x += direction * (last - first + 1) * p;
    } else if (event.key === "Home") { x = 0; y = 0; }
    else if (event.key === "End") { x = 0; y = maxY; }
    else return;
    event.preventDefault();
    scrollTo(clamp(x, 0, maxX), clamp(y, 0, maxY));
  }, { signal });

  window.addEventListener("hashchange", followHash, { signal });
  window.addEventListener("resize", () => { applyDefault(); scheduleMeasure(); }, { signal });
  window.visualViewport?.addEventListener("resize", scheduleMeasure, { signal });
  printing.addEventListener("change", scheduleMeasure, { signal });
  document.fonts.addEventListener("loadingdone", scheduleMeasure, { signal });
  void document.fonts.ready.then(() => { if (!signal.aborted) scheduleMeasure(); });
  source.addEventListener("load", scheduleMeasure, { capture: true, signal });
  source.addEventListener("error", scheduleMeasure, { capture: true, signal });
  source.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && enabled) navigate(event.target);
  }, { signal });

  const resizeObserver = new ResizeObserver(scheduleMeasure);
  [source, viewport, ruler, header, toolbar].forEach((element) => { if (element) resizeObserver.observe(element); });
  const mutationObserver = new MutationObserver(() => { dirty = true; scheduleMeasure(); });
  mutationObserver.observe(source, { childList: true, subtree: true, characterData: true });

  root.classList.add("rm-ready");
  // All astro:page-load handlers (including copy-button enhancement) finish first.
  const initialFrame = requestAnimationFrame(() => {
    applyDefault();
    followHash();
  });
  dispose = () => {
    controller.abort();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    [initialFrame, measuring, scrolling].forEach(cancelAnimationFrame);
    root.classList.remove("rm-active", "rm-ready");
    root.style.removeProperty("--rm-header-height");
    source.style.removeProperty("width");
    reader.hidden = true;
    plane.replaceChildren();
  };
  document.addEventListener("astro:before-swap", () => { dispose?.(); dispose = undefined; }, { once: true, signal });
}
