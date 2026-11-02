import {
  clamp, columnStep, columnWidth, nearestPosition, positionAt, readingPlane,
  rebasedPosition, restoredPosition, slotRange,
  type ReadingGeometry,
} from "./reading-geometry";

const STORAGE_KEY = "dispositif:reading-mode";
const OVERLAP_STORAGE_KEY = "dispositif:reading-overlap-px";
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
  const overlapInput = document.querySelector<HTMLInputElement>("[data-rm-overlap]");
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const toolbar = document.querySelector<HTMLElement>(".rm-toolbar");
  if (!source || !viewport || !reader || !plane || !ruler || !toggle || !overlapInput) return;

  const controller = new AbortController();
  const { signal } = controller;
  const printing = window.matchMedia("print");
  let preference: string | null = null;
  let overlapPreference: number | null = null;
  try { preference = localStorage.getItem(STORAGE_KEY); } catch { /* storage is optional */ }
  try {
    const saved = localStorage.getItem(OVERLAP_STORAGE_KEY);
    if (saved !== null && saved.trim() !== "") {
      const value = Number(saved);
      if (Number.isFinite(value) && value >= 0) overlapPreference = Math.round(value);
    }
  } catch { /* storage is optional */ }
  let enabled = false;
  let geometry: ReadingGeometry | undefined;
  let position = 0;
  let measuring = 0;
  let scrolling = 0;
  let rangeStart = NaN;
  let velocity = 0;
  let lastScroll: { x: number; at: number } | undefined;
  let placedOrigin = "";
  const placements = new WeakMap<HTMLElement, { left: number; top: number }>();
  let dirty = true;
  let activeHeading = "";
  let navigationHeading: { id: string; position: number } | undefined;
  let slots: HTMLElement[] = [];
  let headings: { id: string; t: number }[] = [];

  const offsetOf = (element: Element) =>
    element.getBoundingClientRect().top - source.getBoundingClientRect().top;

  const announceHeading = () => {
    if (navigationHeading && Math.abs(navigationHeading.position - position) >= 1) navigationHeading = undefined;
    const id = navigationHeading?.id ?? [...headings].reverse().find((heading) => heading.t <= position + 64)?.id
      ?? headings[0]?.id ?? "";
    if (id === activeHeading) return;
    activeHeading = id;
    document.dispatchEvent(new CustomEvent("rm:heading", { detail: { id } }));
  };

  const cloneContent = () => {
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
    return content;
  };

  const updateSlots = () => {
    if (!geometry) return;
    const range = slotRange(viewport.scrollLeft, geometry.viewportWidth, geometry, velocity);
    const start = range.start + geometry.originColumn;
    const { count } = range;
    const origin = `${geometry.originColumn}:${geometry.originY}:${geometry.p}:${geometry.step}`;
    if (start === rangeStart && slots.length === count && !dirty && origin === placedOrigin) return;
    const wanted = new Set(Array.from({ length: count }, (_, i) => start + i));
    // Retain existing frames/rasterized content when the pool changes size.
    // Removing the whole pool discards even the pages currently on screen.
    let excess = slots.length - count;
    slots = slots.filter((slot) => {
      if (excess > 0 && !wanted.has(Number(slot.dataset.rmK))) {
        slot.parentElement?.remove();
        excess--;
        return false;
      }
      return true;
    });
    if (dirty) {
      const replacements = slots.map(() => cloneContent());
      slots.forEach((slot, i) => {
        slot.replaceChildren(replacements[i]);
        placements.delete(slot);
      });
    }
    while (slots.length < count) {
      const content = cloneContent();
      const track = document.createElement("div");
      track.className = "rm-track";
      const slot = document.createElement("div");
      slot.className = "rm-slot";
      slot.setAttribute("aria-hidden", "true");
      slot.appendChild(content);
      track.appendChild(slot);
      plane.appendChild(track);
      slots.push(slot);
    }
    dirty = false;
    const retained = new Set(slots.map((slot) => Number(slot.dataset.rmK)));
    const missing = [...wanted].filter((k) => !retained.has(k));
    for (const slot of slots) {
      const old = slot.dataset.rmK;
      const k = old !== undefined && wanted.has(Number(old)) ? Number(old) : missing.shift();
      if (k === undefined) continue;
      if (old !== String(k)) slot.dataset.rmK = String(k);
      const left = (k - geometry.originColumn) * geometry.p;
      const top = -(k * geometry.step + geometry.originY);
      const previous = placements.get(slot);
      const content = slot.firstElementChild as HTMLElement;
      // Pixel offsets belong only to the two positioning boxes. Inherited CSS
      // variables here used to invalidate every MathJax descendant on recycling.
      if (previous?.left !== left) {
        slot.parentElement!.style.left = `${left}px`;
        content.style.left = `${left}px`;
      }
      if (previous?.top !== top) content.style.translate = `0 ${top}px`;
      placements.set(slot, { left, top });
    }
    rangeStart = start;
    placedOrigin = origin;
  };

  const rebase = (left: number, top: number) => {
    if (!geometry) return { left, top };
    const next = rebasedPosition(left, top, geometry);
    if (next.originColumn !== geometry.originColumn || next.originY !== geometry.originY
      || next.n !== geometry.n || next.maxY !== geometry.maxY) {
      const { left: _left, top: _top, ...bounds } = next;
      Object.assign(geometry, bounds);
      plane.dataset.rmOriginColumn = String(next.originColumn);
      plane.dataset.rmOriginY = String(next.originY);
      plane.style.width = `${(geometry.n - 1) * geometry.p + geometry.w}px`;
      plane.style.height = `${geometry.maxY + geometry.h}px`;
    }
    return next;
  };

  const syncPosition = () => {
    if (!enabled || !geometry || printing.matches) return;
    const now = performance.now();
    const logicalX = viewport.scrollLeft + geometry.originColumn * geometry.p;
    const elapsed = lastScroll ? now - lastScroll.at : Infinity;
    velocity = lastScroll && elapsed > 0 && elapsed < 160
      ? (logicalX - lastScroll.x) / elapsed : 0;
    lastScroll = { x: logicalX, at: now };
    const next = rebase(viewport.scrollLeft, viewport.scrollTop);
    if (next.left !== viewport.scrollLeft || next.top !== viewport.scrollTop) {
      // This is an occasional change of origin, not per-scroll synchronization.
      // The shared CSS origin and native offset change together before paint.
      // Preserve native movement on the other axis when extending one edge.
      if (next.left !== viewport.scrollLeft) viewport.scrollLeft = next.left;
      if (next.top !== viewport.scrollTop) viewport.scrollTop = next.top;
    }
    position = positionAt(viewport.scrollLeft, viewport.scrollTop, geometry);
    updateSlots();
    announceHeading();
  };

  // One scroll owner. Never synchronize scrollTop between different elements.
  const scrollTo = (left: number, top: number) => {
    const next = rebase(left, top);
    viewport.scrollTo({ left: next.left, top: next.top, behavior: "instant" });
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
    const maximumOverlap = Math.floor(Math.min(h / 4, h - 1));
    const requestedOverlap = overlapPreference
      ?? Math.round(parseFloat(getComputedStyle(ruler).paddingTop) || 0);
    const overlap = clamp(requestedOverlap, 0, maximumOverlap);
    const step = columnStep(h, overlap);
    overlapInput.max = String(maximumOverlap);
    if (document.activeElement !== overlapInput || overlapInput.value !== "") {
      const value = String(overlap);
      if (overlapInput.value !== value) overlapInput.value = value;
    }
    const l = Math.max(1, Math.ceil(source.getBoundingClientRect().height));
    const p = w + gap;
    headings = Array.from(source.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
      (heading) => ({ id: heading.id, t: offsetOf(heading) }));
    // ResizeObserver may report the same layout again after our own writes.
    // Do not canonicalize a deliberate heading jump or rebuild unchanged slots.
    if (geometry && geometry.w === w && geometry.p === p && geometry.h === h
      && geometry.step === step && geometry.l === l && geometry.unit === scrollStep
      && geometry.viewportWidth === viewport.clientWidth) {
      updateSlots();
      announceHeading();
      return;
    }
    if (geometry?.w !== w) dirty = true;
    navigationHeading = undefined;
    plane.style.setProperty("--rm-w", `${w}px`);
    plane.style.setProperty("--rm-p", `${p}px`);
    plane.style.setProperty("--rm-h", `${h}px`);
    plane.style.setProperty("--rm-step", `${step}px`);
    plane.style.setProperty("--rm-overlap", `${h - step}px`);
    plane.style.setProperty("--rm-l", `${l}px`);
    geometry = readingPlane(w, p, h, step, l, viewport.clientWidth, scrollStep, anchor);
    velocity = 0;
    lastScroll = undefined;
    plane.style.width = `${geometry.n * p - gap}px`;
    plane.style.height = `${geometry.maxY + h}px`;
    plane.dataset.rmOriginColumn = String(geometry.originColumn);
    plane.dataset.rmOriginY = String(geometry.originY);
    rangeStart = NaN;
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
    if (!enabled || !geometry) return;
    const fromColumn = viewport.scrollLeft / geometry.p + geometry.originColumn;
    const fromY = viewport.scrollTop + geometry.originY;
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
    const destination = nearestPosition(offsetOf(target),
      (fromColumn - geometry.originColumn) * geometry.p, fromY - geometry.originY, geometry);
    scrollTo(destination.left, destination.top);
    if (target.matches("h2[id], h3[id]")) {
      // At the trailing edge a heading can land in a column to the right.
      // Keep the selected TOC entry until the reader moves again.
      navigationHeading = { id: target.id, position };
      announceHeading();
    }
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
    const readingInset = (header?.getBoundingClientRect().bottom ?? 0)
      + (parseFloat(getComputedStyle(root).fontSize) || 16);
    if (next) position = Math.max(0, readingInset - source.getBoundingClientRect().top);
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
      rangeStart = NaN;
      window.scrollTo({ top: window.scrollY + source.getBoundingClientRect().top + position - readingInset, behavior: "instant" });
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

  const updateOverlap = () => {
    const requested = overlapInput.valueAsNumber;
    if (!Number.isFinite(requested)) return;
    // Capture the latest native position even if its scroll rAF is pending.
    if (enabled && geometry) position = positionAt(viewport.scrollLeft, viewport.scrollTop, geometry);
    overlapPreference = clamp(Math.round(requested), 0, Number(overlapInput.max) || 0);
    const value = String(overlapPreference);
    if (overlapInput.value !== value) overlapInput.value = value;
    try { localStorage.setItem(OVERLAP_STORAGE_KEY, String(overlapPreference)); } catch { /* storage is optional */ }
    scheduleMeasure();
  };
  overlapInput.addEventListener("input", updateOverlap, { signal });
  overlapInput.addEventListener("change", () => {
    if (!Number.isFinite(overlapInput.valueAsNumber)) {
      overlapInput.value = String(geometry ? geometry.h - geometry.step : 0);
      return;
    }
    updateOverlap();
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
    // The header's handler still needs the click to close its disclosure.
    if (!link.closest("[data-toc]")) event.stopPropagation();
    navigate(target);
    history.replaceState(history.state, "", url.hash);
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
    const { p, step } = geometry;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      x += event.key === "ArrowLeft" ? -p : p;
    } else if (["PageDown", "PageUp", " "].includes(event.key)) {
      const direction = event.key === "PageUp" || (event.key === " " && event.shiftKey) ? -1 : 1;
      const first = Math.floor(x / p);
      const last = Math.min(geometry.n - 1, Math.floor((x + viewport.clientWidth - 1) / p));
      const delta = direction * (last - first + 1) * step;
      const column = first + geometry.originColumn;
      y = clamp(y + delta, -column * step - geometry.originY,
        Math.max(0, geometry.l - Math.max(1, geometry.unit)) - column * step - geometry.originY);
    } else if (event.key === "Home" || event.key === "End") {
      const target = restoredPosition(event.key === "Home" ? 0 : Math.max(0, geometry.l - geometry.h), geometry);
      x = target.left;
      y = target.top;
    }
    else return;
    event.preventDefault();
    scrollTo(x, y);
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
