import type { ReadingGeometry } from "./reading-geometry";
import { createLayout, fromCss, toCss, ticks, zero, paperWindow, slotColumns, visibleColumnCount,
  ReadingState, endPoint } from "./reading-coordinates";
import { ReadingViewport } from "./reading-viewport";
import { ReadingFragments } from "./reading-fragments";
import { ReadingMotion } from "./reading-motion";

const STORAGE_KEY = "dispositif:reading-mode";
let dispose: (() => void) | undefined;

export function initializeReadingMode() {
  dispose?.();
  const root = document.documentElement;
  const source = document.querySelector<HTMLElement>(".rm-source");
  const articleScrollport = document.querySelector<HTMLElement>(".rm-article-scrollport");
  const viewport = document.querySelector<HTMLElement>(".rm-viewport");
  const reader = document.querySelector<HTMLElement>(".rm-reader");
  const plane = document.querySelector<HTMLElement>(".rm-plane");
  const ruler = document.querySelector<HTMLElement>(".rm-ruler");
  const toggle = document.querySelector<HTMLButtonElement>(".rm-toggle");
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const toolbar = document.querySelector<HTMLElement>(".rm-toolbar");
  const toolbarParent = toolbar?.parentNode;
  const toolbarNextSibling = toolbar?.nextSibling ?? null;
  if (!source || !articleScrollport || !viewport || !reader || !plane || !ruler || !toggle) return;

  const sourceParent = source.parentNode!;
  const sourceNextSibling = source.nextSibling;
  const controller = new AbortController();
  const { signal } = controller;
  const printing = window.matchMedia("print");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let preference: string | null = null;
  try { preference = localStorage.getItem(STORAGE_KEY); } catch { /* storage is optional */ }
  let enabled = false;
  let suspendedForPrint = false;
  let resumeAfterPrint = false;
  let printPosition = 0;
  let geometry: ReadingGeometry | undefined;
  let position = 0;
  let measuring = 0;
  let scrolling = 0;
  let reading: ReadingState | undefined;
  const native = new ReadingViewport(viewport, plane);
  let rangeStart = NaN;
  const placements = new WeakMap<HTMLElement, {
    left: number; top: number; clip: string; paperTop: number; paperHeight: number;
    shadeTop: number; shadeBottom: number;
  }>();
  let dirty = true;
  let activeHeading = "";
  let navigationHeading: { id: string; position: number } | undefined;
  let slots: HTMLElement[] = [];
  let headings: { id: string; t: number }[] = [];
  const fragments = new ReadingFragments(source);

  const offsetOf = (element: Element) => {
    const box = source.getBoundingClientRect();
    const scale = box.width / (parseFloat(getComputedStyle(source).width) || box.width);
    return (element.getBoundingClientRect().top - box.top) / scale;
  };

  const announceHeading = () => {
    if (navigationHeading && Math.abs(navigationHeading.position - position) >= 1) navigationHeading = undefined;
    const id = navigationHeading?.id ?? [...headings].reverse().find((heading) => heading.t <= position + 64)?.id
      ?? headings[0]?.id ?? "";
    if (id === activeHeading) return;
    activeHeading = id;
    document.dispatchEvent(new CustomEvent("rm:heading", { detail: { id } }));
  };

  const updateSlots = () => {
    if (!geometry || !reading) return;
    const { start, count } = slotColumns(reading.point, reading.layout);
    // Read native geometry before any DOM edits. Reading scrollTop inside the
    // slot loop used to force layout after inserting each new math fragment.
    const nativeY = viewport.scrollTop;
    if (start !== rangeStart || slots.length !== count || dirty) {
      const wanted = new Set(Array.from({ length: count }, (_, i) => start + i));
      // Retain existing frames/rasterized content when the pool changes size.
      // Removing the whole pool discards even the pages currently on screen.
      // The original is also a displayed tree. Keep it alive when shrinking the
      // pool, even if that means assigning it to a different column.
      const removable = slots.filter((slot) => slot.firstElementChild !== source)
        .sort((a, b) => Number(wanted.has(Number(a.dataset.rmK))) - Number(wanted.has(Number(b.dataset.rmK))));
      const removed = new Set(removable.slice(0, Math.max(0, slots.length - count)));
      slots = slots.filter((slot) => {
        if (removed.has(slot)) {
          slot.parentElement?.remove();
          return false;
        }
        return true;
      });
      while (slots.length < count) {
        const content: HTMLElement = slots.length === 0 ? source : fragments.createContent();
        content.classList.add("rm-content");
        const track = document.createElement("div");
        track.className = "rm-track";
        const slot = document.createElement("div");
        slot.className = "rm-slot";
        if (content !== source) slot.setAttribute("aria-hidden", "true");
        slot.appendChild(content);
        const shade = document.createElement("div");
        shade.className = "rm-shade";
        shade.setAttribute("aria-hidden", "true");
        slot.appendChild(shade);
        const paper = document.createElement("div");
        paper.className = "rm-paper";
        paper.setAttribute("aria-hidden", "true");
        slot.appendChild(paper);
        track.appendChild(slot);
        plane.appendChild(track);
        slots.push(slot);
      }
      const retained = new Set(slots.map((slot) => Number(slot.dataset.rmK)));
      const missing = [...wanted].filter((k) => !retained.has(k));
      for (const slot of slots) {
        const old = slot.dataset.rmK;
        const k = old !== undefined && wanted.has(Number(old)) ? Number(old) : missing.shift();
        if (k === undefined) continue;
        if (old !== String(k)) slot.dataset.rmK = String(k);
      }
      rangeStart = start;
      dirty = false;
    }
    const state = reading;
    for (const slot of slots) {
      const k = Number(slot.dataset.rmK);
      const content = slot.firstElementChild as HTMLElement;
      const track = slot.parentElement!;
      const paper = slot.lastElementChild as HTMLElement;
      const shade = paper.previousElementSibling as HTMLElement;
      const fromTicks = ticks(k * state.layout.step + state.point.y);
      const surface = paperWindow(fromTicks, state.layout);
      const from = toCss(fromTicks), paperTop = toCss(surface.top), paperHeight = toCss(surface.height);
      const shift = toCss(surface.shift);
      const left = geometry.leading + geometry.edge + (k - geometry.originColumn) * geometry.p;
      const top = -(k * geometry.step + geometry.originY) + shift;
      const clipped = from < 0 || from + geometry.h > geometry.l;
      const clip = paperHeight === 0 ? "inset(50%)" : clipped
        ? `polygon(-4px ${nativeY + paperTop}px, calc(100% + 4px) ${nativeY + paperTop}px, calc(100% + 4px) ${nativeY + paperTop + paperHeight}px, -4px ${nativeY + paperTop + paperHeight}px)`
        : "inset(0px -4px)";
      const shadeTop = shift - paperTop, shadeBottom = paperTop + paperHeight - geometry.h - shift;
      const previous = placements.get(slot);
      if (previous?.left !== left) track.style.left = `${left}px`;
      // Translate the text in both axes. Moving its layout left offset would
      // lay out the entire MathJax tree again when recycling a column.
      if (previous?.left !== left || previous?.top !== top) content.style.translate = `${left}px ${top}px`;
      if (previous?.clip !== clip) track.style.clipPath = clip;
      if (previous?.paperTop !== paperTop) {
        paper.style.top = shade.style.top = `${paperTop}px`;
      }
      if (previous?.paperHeight !== paperHeight) {
        paper.style.height = shade.style.height = `${paperHeight}px`;
      }
      if (previous?.shadeTop !== shadeTop) shade.style.setProperty("--rm-shade-top", `${shadeTop}px`);
      if (previous?.shadeBottom !== shadeBottom) shade.style.setProperty("--rm-shade-bottom", `${shadeBottom}px`);
      slot.toggleAttribute("data-rm-head", from <= 0);
      slot.toggleAttribute("data-rm-tail", from + geometry.h >= geometry.l);
      placements.set(slot, { left, top, clip, paperTop, paperHeight, shadeTop, shadeBottom });
      // Slots outside the article have no visible paper. Keep their existing
      // fragments until they become visible instead of cloning/removing blocks
      // that would immediately be clipped away.
      if (content !== source && paperHeight > 0) fragments.render(content, toCss(fromTicks - surface.shift), geometry.h, geometry.l);
    }
  };

  const present = (force = false) => {
    if (!enabled || !reading || printing.matches) return;
    geometry = native.place(reading.point, reading.layout, force);
    position = toCss(reading.anchor);
    updateSlots();
    announceHeading();
  };

  const motion = new ReadingMotion(
    () => reading?.layout,
    () => reading?.point ?? { x: zero, y: zero },
    (point) => {
      if (!reading) return;
      reading.horizontal(point.x);
      present(true);
    },
    reducedMotion,
    (active) => viewport.toggleAttribute("data-rm-animating", active),
    signal,
  );

  const syncPosition = () => {
    if (!enabled || !reading || printing.matches) return;
    const movement = native.read(reading.point);
    if (!movement) return;
    motion.cancelAnimation();
    if (movement.x !== undefined) reading.horizontal(movement.x);
    if (movement.y !== undefined) reading.vertical(movement.y);
    present();
  };

  const goToEdge = (end: boolean) => {
    if (!reading) return;
    syncPosition();
    motion.reset();
    if (end) reading.end(); else reading.home();
    present(true);
  };

  const measure = () => {
    measuring = 0;
    if (!enabled || printing.matches) return;
    const anchor = fromCss(position);
    const oldPoint = reading?.point;
    const oldEnd = reading && endPoint(reading.layout);
    const wasEnd = oldPoint && oldEnd && oldPoint.x === oldEnd.x && oldPoint.y === oldEnd.y;
    const wasHome = oldPoint?.x === 0 && oldPoint?.y === 0;
    root.style.setProperty("--rm-header-height", `${header?.getBoundingClientRect().height ?? 0}px`);
    const gap = Math.max(0, parseFloat(getComputedStyle(ruler).marginRight) || 0);
    const edge = Math.max(0, parseFloat(getComputedStyle(ruler).paddingRight) || 0);
    // DPR alone is insufficient: browser zoom and device emulation can round
    // scrollLeft differently. Probe a hidden, lightweight CSS ruler instead.
    ruler.scrollLeft = 1 / (window.devicePixelRatio || 1);
    if (!ruler.scrollLeft) ruler.scrollLeft = 1;
    const scrollStep = ruler.scrollLeft || 1;
    ruler.scrollLeft = 0;
    native.setUnit(scrollStep);
    const w = toCss(fromCss(Math.min(parseFloat(getComputedStyle(ruler).width), Math.max(1, viewport.clientWidth - 2 * edge))));
    source.style.width = `${w}px`;
    const h = Math.max(1, viewport.clientHeight);
    const sourceBox = source.getBoundingClientRect();
    const scale = sourceBox.width / (parseFloat(getComputedStyle(source).width) || sourceBox.width);
    const l = Math.max(1, Math.ceil(sourceBox.height / scale));
    fragments.measure(dirty);
    headings = Array.from(source.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
      (heading) => ({ id: heading.id, t: offsetOf(heading) }));
    const layout = createLayout(w, gap, h, 0, l, viewport.clientWidth, edge);
    // Layout changes preserve the logical anchor; ordinary observations never
    // reconstruct application state from native positions.
    if (reading && Object.keys(layout).every(key => layout[key as keyof typeof layout] === reading!.layout[key as keyof typeof layout])) {
      present();
      return;
    }
    if (geometry?.w !== w) dirty = true;
    navigationHeading = undefined;
    motion.reset();
    plane.style.setProperty("--rm-w", `${w}px`);
    plane.style.setProperty("--rm-p", `${toCss(layout.p)}px`);
    plane.style.setProperty("--rm-h", `${h}px`);
    plane.style.setProperty("--rm-step", `${h}px`);
    plane.style.setProperty("--rm-overlap", "0px");
    plane.style.setProperty("--rm-l", `${l}px`);
    plane.style.setProperty("--rm-edge", `${edge}px`);
    reading = new ReadingState(layout, anchor);
    if (wasHome) reading.home(); else if (wasEnd) reading.end();
    native.reset();
    rangeStart = NaN;
    present(true);
  };

  const scheduleMeasure = () => {
    if (enabled && !measuring) measuring = requestAnimationFrame(measure);
  };

  const syncDetails = () => {
    const originals = source.querySelectorAll<HTMLDetailsElement>("details");
    slots.forEach((slot) => {
      slot.querySelectorAll<HTMLDetailsElement>("details[data-rm-details]").forEach((details) => {
        const original = originals[Number(details.dataset.rmDetails)];
        if (original) details.open = original.open;
      });
    });
  };

  const navigate = (target: HTMLElement) => {
    if (!enabled || !geometry) return;
    syncPosition();
    let parent = target.parentElement;
    while (parent && parent !== source) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    syncDetails();
    // Flush measurement so freshly opened details and loaded images are included.
    cancelAnimationFrame(measuring);
    measure();
    if (!reading) return;
    motion.reset();
    reading.navigate(fromCss(offsetOf(target)));
    present(true);
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

  const restoreSource = () => {
    sourceParent.insertBefore(source, sourceNextSibling);
    source.classList.remove("rm-content");
    for (const property of ["width", "left", "translate"]) source.style.removeProperty(property);
  };

  const setEnabled = (next: boolean, anchor?: number) => {
    if (next === enabled) return;
    const toggleFocused = document.activeElement === toggle;
    motion.reset();
    // Single-column reading scrolls the article above the backdrop. Its
    // reading inset is the original 1.5rem, not the n-column
    // header's height. At the beginning keep the card at its normal position.
    const readingInset = 1.5 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    if (next) position = anchor ?? Math.max(0, readingInset - source.getBoundingClientRect().top);
    enabled = next;
    root.classList.toggle("rm-active", enabled);
    articleScrollport.tabIndex = enabled ? -1 : 0;
    if (toolbar) {
      if (enabled && header) header.appendChild(toolbar);
      else toolbarParent?.insertBefore(toolbar, toolbarNextSibling);
    }
    reader.hidden = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.title = enabled ? "1段表示に切り替える" : "n段表示に切り替える";
    activeHeading = "";
    if (enabled) {
      // All displayed trees need identical image dimensions for measurement,
      // including parts of the original outside its current column window.
      source.querySelectorAll<HTMLImageElement>("img").forEach((image) => { image.loading = "eager"; });
      dirty = true;
      measure();
      articleScrollport.scrollTo({ top: 0, behavior: "instant" });
    } else {
      restoreSource();
      plane.replaceChildren();
      slots = [];
      geometry = undefined;
      reading = undefined;
      native.reset();
      rangeStart = NaN;
      articleScrollport.scrollTo({ top: position <= 0 ? 0 : articleScrollport.scrollTop + source.getBoundingClientRect().top + position - readingInset, behavior: "instant" });
      document.dispatchEvent(new CustomEvent("rm:off"));
    }
    if (toggleFocused) toggle.focus({ preventScroll: true });
  };

  const applyDefault = () => {
    if (suspendedForPrint || printing.matches) return;
    const p = ruler.getBoundingClientRect().width + (parseFloat(getComputedStyle(ruler).marginRight) || 0);
    setEnabled(preference === "multi" || (preference !== "single" && window.innerWidth >= 2 * p));
  };

  // The original normally lives inside the reader. Return it to the document
  // for printing, where the reader is hidden, then resume the saved position.
  const suspendForPrint = () => {
    if (suspendedForPrint) return;
    suspendedForPrint = true;
    resumeAfterPrint = enabled;
    // By the media change event the hidden viewport can already have lost its
    // native offsets. Keep the last logical position instead of reading it now.
    printPosition = position;
    setEnabled(false);
  };
  const resumeFromPrint = () => {
    if (!suspendedForPrint || printing.matches) return;
    suspendedForPrint = false;
    if (resumeAfterPrint) setEnabled(true, printPosition);
    resumeAfterPrint = false;
    scheduleMeasure();
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
  // Native vertical input never initiates horizontal movement, including at
  // an edge. Manual gestures only interrupt an explicit key animation.
  viewport.addEventListener("wheel", () => motion.cancelAnimation(), { passive: true, signal });
  viewport.addEventListener("pointerdown", () => motion.cancelAnimation(), { passive: true, signal });
  viewport.addEventListener("touchstart", () => motion.cancelAnimation(), { passive: true, signal });

  document.addEventListener("click", (event) => {
    if (!enabled || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const element = event.target instanceof Element ? event.target : null;
    const slot = element?.closest(".rm-slot");
    const control = element?.closest("summary, [data-details-close]");
    if (slot && control) {
      const details = control.closest<HTMLDetailsElement>("details");
      const original = details && source.contains(details) ? details
        : source.querySelectorAll<HTMLDetailsElement>("details")[Number(details?.dataset.rmDetails)];
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
    if (!reading) return;
    syncPosition();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      motion.column(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (["PageDown", "PageUp", " "].includes(event.key)) {
      const direction = event.key === "PageUp" || (event.key === " " && event.shiftKey) ? -1 : 1;
      motion.reset();
      const count = visibleColumnCount(reading.point, reading.layout);
      reading.vertical(ticks(reading.point.y + direction * count * reading.layout.step));
      present(true);
    } else if (event.key === "Home" || event.key === "End") {
      goToEdge(event.key === "End");
    } else return;
    event.preventDefault();
  }, { signal });

  window.addEventListener("hashchange", followHash, { signal });
  window.addEventListener("resize", () => { applyDefault(); scheduleMeasure(); }, { signal });
  window.visualViewport?.addEventListener("resize", scheduleMeasure, { signal });
  window.addEventListener("beforeprint", suspendForPrint, { signal });
  window.addEventListener("afterprint", resumeFromPrint, { signal });
  printing.addEventListener("change", () => {
    if (printing.matches) suspendForPrint();
    else resumeFromPrint();
  }, { signal });
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
    motion.reset();
    controller.abort();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    [initialFrame, measuring, scrolling].forEach(cancelAnimationFrame);
    root.classList.remove("rm-active", "rm-ready");
    root.style.removeProperty("--rm-header-height");
    if (toolbar) toolbarParent?.insertBefore(toolbar, toolbarNextSibling);
    restoreSource();
    reader.hidden = true;
    plane.replaceChildren();
  };
  document.addEventListener("astro:before-swap", () => { dispose?.(); dispose = undefined; }, { once: true, signal });
}
