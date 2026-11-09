import { devicePixels, type ColumnGeometry } from "./column-geometry";
import type { ColumnMetrics, ReadingPoint } from "./column-coordinates";
import { createLayout, fromCss, toCss, ticks, zero, paperWindow, slotColumns, visibleColumnCount,
  ReadingState, endPoint, refitPoint } from "./column-coordinates";
import { ColumnViewport } from "./column-viewport";
import { ColumnFragments } from "./column-fragments";
import { ColumnMotion } from "./column-motion";
import { opensMulti, COLUMNS_STORAGE_KEY } from "./column-preference";
import { type HistoryPosition, HISTORY_STORAGE_KEY, parseSavedHistory, mergeHistory, resolveHistoryEntry } from "./reading-history";

let dispose: (() => void) | undefined;
// Saves the active reader's current position; the single pagehide listener
// below calls it before persisting so storage is written once per unload.
let saveActiveReader: (() => void) | undefined;
const sameLayout = (a: ColumnMetrics, b: ColumnMetrics) =>
  (Object.keys(a) as (keyof ColumnMetrics)[]).every((key) => a[key] === b[key]);
const historyPositions = new Map<string, HistoryPosition>();
const dirtyHistoryPositions = new Set<string>();
// Throws when storage is unavailable; callers decide how to degrade.
const readSavedHistory = () => parseSavedHistory(sessionStorage.getItem(HISTORY_STORAGE_KEY));
try {
  for (const [key, value] of readSavedHistory()) historyPositions.set(key, value);
} catch { /* session storage is optional */ }
const persistHistoryPositions = () => {
  if (!dirtyHistoryPositions.size) return;
  // A damaged stored copy must not stop every later save in this tab.
  let stored = new Map<string, HistoryPosition>();
  try { stored = readSavedHistory(); } catch { /* replaced below */ }
  try {
    const merged = mergeHistory(stored, historyPositions, dirtyHistoryPositions);
    sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(merged));
    dirtyHistoryPositions.clear();
  } catch { /* reading remains available without storage */ }
};
window.addEventListener("pagehide", () => {
  saveActiveReader?.();
  persistHistoryPositions();
});

export function initializeColumnLayout() {
  dispose?.();
  const root = document.documentElement;
  const source = document.querySelector<HTMLElement>(".cl-source");
  const articleScrollport = document.querySelector<HTMLElement>(".cl-article-scrollport");
  const viewport = document.querySelector<HTMLElement>(".cl-viewport");
  const reader = document.querySelector<HTMLElement>(".cl-reader");
  const plane = document.querySelector<HTMLElement>(".cl-plane");
  const ruler = document.querySelector<HTMLElement>(".cl-ruler");
  const toggle = document.querySelector<HTMLButtonElement>(".cl-toggle");
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const article = document.querySelector<HTMLElement>(".cl-article") ?? root;
  const toolbar = document.querySelector<HTMLElement>(".cl-toolbar");
  const toolbarParent = toolbar?.parentNode;
  const toolbarNextSibling = toolbar?.nextSibling ?? null;
  if (!source || !articleScrollport || !viewport || !reader || !plane || !ruler || !toggle) return;

  // Astro preserves state properties on history traversal. Give each article
  // entry its own key; the positions stay in memory rather than writing to
  // history or storage on every scroll frame.
  const restoringEntry = typeof history.state?.dispositifReadingKey === "string";
  const newHistoryKey = () => `${Date.now()}-${Math.random()}`;
  const ensureHistoryKey = () => {
    const key: string = history.state?.dispositifReadingKey ?? newHistoryKey();
    if (history.state && !history.state.dispositifReadingKey) {
      history.replaceState({ ...history.state, dispositifReadingKey: key }, "");
    }
    return key;
  };
  let entryKey = ensureHistoryKey();
  const articlePath = location.pathname + location.search;
  let historyIndex = Number.isFinite(history.state?.index) ? Number(history.state.index) : 0;
  // A freshly generated key cannot have a saved entry, so skip the storage
  // read on ordinary navigations.
  if (restoringEntry) {
    const changedLocally = dirtyHistoryPositions.has(entryKey);
    let stored: HistoryPosition | undefined;
    if (!changedLocally) try { stored = readSavedHistory().get(entryKey); } catch { /* storage is optional */ }
    const resolved = resolveHistoryEntry(historyPositions.get(entryKey), stored, changedLocally);
    if (resolved) historyPositions.set(entryKey, resolved);
  }
  const savedHistoryPosition = historyPositions.get(entryKey);
  let historyReady = false;

  // With n段 stored, Layout.astro has already put the original in the first
  // column (at astro:before-swap, or while a full load parses it), so that its
  // first layout is at the column width. Adopt that slot instead of mounting
  // the original again.
  let premounted = source.parentElement?.matches(".cl-plane > .cl-track > .cl-slot")
    ? source.parentElement : undefined;
  // The pre-mounted original came from just after the reader.
  const sourceParent = premounted ? reader.parentNode! : source.parentNode!;
  const sourceNextSibling = premounted ? reader.nextSibling : source.nextSibling;
  const controller = new AbortController();
  const { signal } = controller;
  const printing = window.matchMedia("print");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let preference: string | null = null;
  try { preference = localStorage.getItem(COLUMNS_STORAGE_KEY); } catch { /* storage is optional */ }
  // ?columns= is read once: the toggle changes the column layout without rewriting the URL.
  const startMulti = opensMulti(location.search, preference, savedHistoryPosition?.mode);
  let multi = false;
  let suspendedForPrint = false;
  let resumeAfterPrint = false;
  let printPosition = 0;
  let printPoint: { point: ReadingPoint; layout: ColumnMetrics } | undefined;
  let geometry: ColumnGeometry | undefined;
  let position = 0;
  let measuring = 0;
  let scrolling = 0;
  let reading: ReadingState | undefined;
  const native = new ColumnViewport(viewport, plane);
  let rangeStart = NaN;
  const placements = new WeakMap<HTMLElement, {
    left: number; translate: string; clip: string; paperTop: number; paperHeight: number;
  }>();
  let dirty = true;
  let activeHeading = "";
  let navigationHeading: { id: string; position: number } | undefined;
  let slots: HTMLElement[] = [];
  let preferredSourceColumn: number | undefined;
  let headings: { id: string; t: number }[] = [];
  const fragments = new ColumnFragments(source);

  const offsetOf = (element: Element) => {
    const box = source.getBoundingClientRect();
    const scale = box.width / (parseFloat(getComputedStyle(source).width) || box.width);
    return (element.getBoundingClientRect().top - box.top) / scale;
  };

  // Preserve a position within the same block when the article is reflowed
  // at a different width. This is only measured when the column layout changes.
  const captureAnchor = (offset: number) => {
    const sourceBox = source.getBoundingClientRect();
    const scale = sourceBox.width / (parseFloat(getComputedStyle(source).width) || sourceBox.width);
    const y = sourceBox.top + offset * scale;
    let best: { element: HTMLElement; ratio: number; height: number; distance: number } | undefined;
    for (const element of source.querySelectorAll<HTMLElement>("h1, h2, h3, h4, p, li, pre, table, figure, details")) {
      const rect = element.getBoundingClientRect();
      if (!rect.height) continue;
      const distance = Math.max(rect.top - y, y - rect.bottom, 0);
      if (!best || distance < best.distance || (distance === best.distance && rect.height < best.height)) {
        best = { element, ratio: Math.max(0, Math.min(1, (y - rect.top) / rect.height)), height: rect.height, distance };
      }
    }
    return best;
  };
  const anchorOffset = (anchor: ReturnType<typeof captureAnchor>) => {
    if (!anchor || !source.contains(anchor.element)) return undefined;
    const box = source.getBoundingClientRect();
    const scale = box.width / (parseFloat(getComputedStyle(source).width) || box.width);
    return offsetOf(anchor.element) + anchor.ratio * anchor.element.getBoundingClientRect().height / scale;
  };

  const saveHistoryAnchor = (offsetOverride?: number) => {
    const entry = historyPositions.get(entryKey);
    if (!entry || suspendedForPrint) return;
    const inset = 1.5 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    const offset = offsetOverride ?? (multi ? position : Math.max(0, inset - source.getBoundingClientRect().top));
    const anchor = offset > 0 ? captureAnchor(offset) : undefined;
    if (!anchor) { delete entry.anchor; dirtyHistoryPositions.add(entryKey); return; }
    const path: number[] = [];
    let element: Element = anchor.element;
    while (element !== source && element.parentElement) {
      path.unshift(Array.prototype.indexOf.call(element.parentElement.children, element));
      element = element.parentElement;
    }
    if (element === source) {
      entry.anchor = { path, ratio: anchor.ratio,
        width: parseFloat(getComputedStyle(source).width) || source.getBoundingClientRect().width };
      dirtyHistoryPositions.add(entryKey);
    }
  };
  const saveHistoryDetails = () => {
    const entry = historyPositions.get(entryKey);
    if (!entry || suspendedForPrint) return;
    entry.details = Array.from(source.querySelectorAll<HTMLDetailsElement>("details"), (details) => details.open);
    dirtyHistoryPositions.add(entryKey);
  };
  const historyAnchorOffset = (anchor: HistoryPosition["anchor"]) => {
    if (!anchor || !Array.isArray(anchor.path) || !Number.isFinite(anchor.ratio)) return undefined;
    let element: Element = source;
    for (const index of anchor.path) {
      const child = element.children[index];
      if (!child) return undefined;
      element = child;
    }
    return anchorOffset({ element: element as HTMLElement, ratio: anchor.ratio, height: 0, distance: 0 });
  };

  const announceHeading = () => {
    if (navigationHeading && Math.abs(navigationHeading.position - position) >= 1) navigationHeading = undefined;
    const id = navigationHeading?.id ?? [...headings].reverse().find((heading) => heading.t <= position + 64)?.id
      ?? headings[0]?.id ?? "";
    if (id === activeHeading) return;
    activeHeading = id;
    document.dispatchEvent(new CustomEvent("cl:heading", { detail: { id } }));
  };

  const mountSlot = (content: HTMLElement) => {
    content.classList.add("cl-content");
    const track = document.createElement("div");
    track.className = "cl-track";
    const slot = document.createElement("div");
    slot.className = "cl-slot";
    if (content !== source) slot.setAttribute("aria-hidden", "true");
    slot.appendChild(content);
    const paper = document.createElement("div");
    paper.className = "cl-paper";
    paper.setAttribute("aria-hidden", "true");
    slot.appendChild(paper);
    track.appendChild(slot);
    plane.appendChild(track);
    slots.push(slot);
  };

  // Columns entirely outside the viewport are filled a frame later, so their
  // copies are not styled and laid out before the visible ones are painted.
  let offscreenFrame = 0;
  const updateSlots = (includeOffscreen = false) => {
    if (!geometry || !reading) return;
    const { start, count } = slotColumns(reading.point, reading.layout);
    // Read native geometry before any DOM edits. Reading scrollTop inside the
    // slot loop used to force layout after inserting each new math fragment.
    const nativeY = viewport.scrollTop;
    const nativeX = viewport.scrollLeft, viewportWidth = viewport.clientWidth;
    if (start !== rangeStart || slots.length !== count || dirty) {
      const wanted = new Set(Array.from({ length: count }, (_, i) => start + i));
      // Retain existing frames/rasterized content when the pool changes size.
      // Removing the whole pool discards even the pages currently on screen.
      // The original is also a displayed tree. Keep it alive when shrinking the
      // pool, even if that means assigning it to a different column.
      const removable = slots.filter((slot) => slot.firstElementChild !== source)
        .sort((a, b) => Number(wanted.has(Number(a.dataset.clK))) - Number(wanted.has(Number(b.dataset.clK))));
      const removed = new Set(removable.slice(0, Math.max(0, slots.length - count)));
      slots = slots.filter((slot) => {
        if (removed.has(slot)) {
          slot.parentElement?.remove();
          return false;
        }
        return true;
      });
      while (slots.length < count) mountSlot(slots.length === 0 ? source : fragments.createContent());
      const retained = new Set(slots.map((slot) => Number(slot.dataset.clK)));
      const missing = [...wanted].filter((k) => !retained.has(k));
      for (const slot of slots) {
        const old = slot.dataset.clK;
        const k = old !== undefined && wanted.has(Number(old)) ? Number(old) : missing.shift();
        if (k === undefined) continue;
        if (old !== String(k)) slot.dataset.clK = String(k);
      }
      if (preferredSourceColumn !== undefined && wanted.has(preferredSourceColumn)) {
        const original = slots.find((slot) => slot.firstElementChild === source);
        const destination = slots.find((slot) => Number(slot.dataset.clK) === preferredSourceColumn);
        if (original && destination && original !== destination) {
          const previous = original.dataset.clK!;
          original.dataset.clK = destination.dataset.clK!;
          destination.dataset.clK = previous;
        }
      } else preferredSourceColumn = undefined;
      rangeStart = start;
      dirty = false;
    }
    const state = reading;
    // The raster grid: one device pixel in CSS px, including browser zoom. The
    // scroll step (geometry.unit) can be coarser than this.
    const pixel = 1 / (window.devicePixelRatio || 1);
    for (const slot of slots) {
      const k = Number(slot.dataset.clK);
      const content = slot.firstElementChild as HTMLElement;
      const track = slot.parentElement!;
      const paper = slot.lastElementChild as HTMLElement;
      const fromTicks = ticks(k * state.layout.h + state.point.y);
      const surface = paperWindow(fromTicks, state.layout);
      const from = toCss(fromTicks), paperTop = toCss(surface.top), paperHeight = toCss(surface.height);
      const left = geometry.leading + geometry.edge + (k - geometry.originColumn) * geometry.p;
      const top = -(k * geometry.h + geometry.originY);
      const clipped = from < 0 || from + geometry.h > geometry.l;
      const clip = paperHeight === 0 ? "inset(50%)" : clipped
        ? `polygon(-4px ${nativeY + paperTop}px, calc(100% + 4px) ${nativeY + paperTop}px, calc(100% + 4px) ${nativeY + paperTop + paperHeight}px, -4px ${nativeY + paperTop + paperHeight}px)`
        : "inset(0px -4px)";
      const previous = placements.get(slot);
      if (previous?.left !== left) track.style.left = `${left}px`;
      // Translate the text in both axes. Moving its layout left offset would
      // lay out the entire MathJax tree again when recycling a column.
      // Whole device pixels only: when a column is recycled, Chromium moves
      // its already rasterized text instead of painting it again, so a move by
      // a fraction of a device pixel (e.g. a 706 px step at 125 %) leaves the
      // text resampled and blurred until something repaints it. Compared
      // after rounding, so a zoom change re-rounds an unmoved column.
      const translate = `${devicePixels(left, pixel)}px ${devicePixels(top, pixel)}px`;
      if (previous?.translate !== translate) content.style.translate = translate;
      if (previous?.clip !== clip) track.style.clipPath = clip;
      if (previous?.paperTop !== paperTop) paper.style.top = `${paperTop}px`;
      if (previous?.paperHeight !== paperHeight) paper.style.height = `${paperHeight}px`;
      slot.toggleAttribute("data-cl-head", from <= 0);
      slot.toggleAttribute("data-cl-tail", from + geometry.h >= geometry.l);
      placements.set(slot, { left, translate, clip, paperTop, paperHeight });
      // Slots outside the article have no visible paper. Keep their existing
      // fragments until they become visible instead of cloning/removing blocks
      // that would immediately be clipped away.
      if (content === source || paperHeight === 0) continue;
      if (includeOffscreen || (left < nativeX + viewportWidth && left + geometry.w > nativeX)) {
        fragments.render(content, from, geometry.h, geometry.l);
      } else if (!offscreenFrame) {
        offscreenFrame = requestAnimationFrame(() => { offscreenFrame = 0; updateSlots(true); });
      }
    }
  };

  const present = (force = false) => {
    if (!multi || !reading || printing.matches) return;
    geometry = native.place(reading.point, reading.layout, force);
    position = toCss(reading.anchor);
    updateSlots();
    announceHeading();
  };

  const motion = new ColumnMotion(
    () => reading?.layout,
    () => reading?.point ?? { x: zero, y: zero },
    (point) => {
      if (!reading) return;
      reading.horizontal(point.x);
      present(true);
    },
    reducedMotion,
    (active) => viewport.toggleAttribute("data-cl-animating", active),
    signal,
  );

  const syncPosition = () => {
    if (!multi || !reading || printing.matches) return;
    const movement = native.read(reading.point);
    if (!movement) return;
    motion.cancelAnimation();
    if (movement.x !== undefined) reading.horizontal(movement.x);
    if (movement.y !== undefined) reading.vertical(movement.y);
    present();
  };

  function saveHistoryPosition() {
    if (!historyReady || suspendedForPrint) return;
    const details = historyPositions.get(entryKey)?.details;
    historyPositions.set(entryKey, multi
      ? { mode: "multi", position, point: reading?.point, layout: reading?.layout, details }
      : { mode: "single", position: articleScrollport!.scrollTop, details });
    dirtyHistoryPositions.add(entryKey);
  }

  const goToEdge = (end: boolean) => {
    if (!reading) return;
    syncPosition();
    motion.reset();
    if (end) reading.end(); else reading.home();
    present(true);
  };

  const measure = () => {
    measuring = 0;
    if (!multi || printing.matches) return;
    // On enabling, detach the original while reading the page's new geometry,
    // so it is not laid out at an intermediate width before its column.
    if (!slots.length && !premounted) source.remove();
    // The scroll handler skips a native scroll while this frame is pending.
    // Apply it before reading the old point, or the point kept below (or the
    // offsets present() acknowledges) drops it and the view snaps back. After
    // a resize the browser's clamped offsets are not input: the anchor wins.
    if (reading && fromCss(viewport.clientWidth) === reading.layout.viewportWidth
      && fromCss(Math.max(1, viewport.clientHeight)) === reading.layout.h) syncPosition();
    const anchor = fromCss(position);
    const oldPoint = reading?.point;
    const oldEnd = reading && endPoint(reading.layout);
    const wasEnd = oldPoint && oldEnd && oldPoint.x === oldEnd.x && oldPoint.y === oldEnd.y;
    const wasHome = oldPoint?.x === 0 && oldPoint?.y === 0;
    article.style.setProperty("--cl-header-height", `${header?.getBoundingClientRect().height ?? 0}px`);
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
    plane.style.setProperty("--cl-w", `${w}px`);
    plane.style.setProperty("--cl-h", `${h}px`);
    // Lay the original out once, at W and in its column. A pre-mounted
    // original was laid out there already, at the same width unless the
    // column width differs from the CSS estimate (then once more here).
    if (!slots.length) {
      if (premounted) { slots.push(premounted); premounted = undefined; } else mountSlot(source);
    }
    const sourceBox = source.getBoundingClientRect();
    const scale = sourceBox.width / (parseFloat(getComputedStyle(source).width) || sourceBox.width);
    const l = Math.max(1, Math.ceil(sourceBox.height / scale));
    fragments.measure(dirty);
    headings = Array.from(source.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
      (heading) => ({ id: heading.id, t: offsetOf(heading) }));
    const layout = createLayout(w, gap, h, l, viewport.clientWidth, edge);
    // Layout changes preserve the logical anchor; ordinary observations never
    // reconstruct application state from native positions.
    if (reading && sameLayout(layout, reading.layout)) {
      present();
      return;
    }
    if (geometry?.w !== w) dirty = true;
    navigationHeading = undefined;
    motion.reset();
    plane.style.setProperty("--cl-p", `${toCss(layout.p)}px`);
    plane.style.setProperty("--cl-l", `${l}px`);
    plane.style.setProperty("--cl-edge", `${edge}px`);
    const lengthOnly = reading && (Object.keys(layout) as (keyof ColumnMetrics)[])
      .every((key) => key === "l" || layout[key] === reading!.layout[key]);
    const previous = reading;
    reading = new ReadingState(layout, anchor);
    // Opening or closing a details element changes only the length. Keep the
    // exact point rather than snapping to the anchor's column or the new end.
    if (lengthOnly && previous) reading.restorePoint(refitPoint(previous.point, previous.layout, layout));
    else if (wasHome) reading.home(); else if (wasEnd) reading.end();
    native.reset();
    rangeStart = NaN;
    present(true);
  };

  const scheduleMeasure = () => {
    if (multi && !measuring) measuring = requestAnimationFrame(measure);
  };

  const syncDetails = () => {
    const originals = source.querySelectorAll<HTMLDetailsElement>("details");
    slots.forEach((slot) => {
      slot.querySelectorAll<HTMLDetailsElement>("details[data-cl-details]").forEach((details) => {
        const original = originals[Number(details.dataset.clDetails)];
        if (original) details.open = original.open;
      });
    });
  };

  const navigate = (target: HTMLElement) => {
    if (!multi || !geometry) return;
    syncPosition();
    let parent = target.parentElement;
    while (parent && parent !== source) {
      if (parent instanceof HTMLDetailsElement && parent.querySelector(":scope > summary") !== target) parent.open = true;
      parent = parent.parentElement;
    }
    syncDetails();
    // Flush measurement so freshly opened details and loaded images are included.
    cancelAnimationFrame(measuring);
    measure();
    if (!reading) return;
    motion.reset();
    reading.navigate(fromCss(offsetOf(target)));
    preferredSourceColumn = Math.floor((fromCss(offsetOf(target)) - reading.point.y) / reading.layout.h);
    rangeStart = NaN;
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
    if (!multi || !location.hash) return;
    const target = hashTarget(location.hash);
    if (target) navigate(target);
  };

  const restoreSource = () => {
    premounted = undefined;
    root.classList.remove("cl-premount");
    sourceParent.insertBefore(source, sourceNextSibling);
    source.classList.remove("cl-content");
    for (const property of ["width", "left", "translate"]) source.style.removeProperty(property);
  };

  const setMulti = (next: boolean, anchor?: number) => {
    if (next === multi) return;
    const toggleFocused = document.activeElement === toggle;
    motion.reset();
    // Single-column reading scrolls the article above the backdrop. Its
    // reading inset is the original 1.5rem, not the n-column
    // header's height. At the beginning keep the card at its normal position.
    const readingInset = 1.5 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    if (multi) syncPosition();
    // A pre-mounted original has no single-column position; it starts at the top.
    if (next) position = anchor ?? (premounted ? 0 : Math.max(0, readingInset - source.getBoundingClientRect().top));
    const contentAnchor = !suspendedForPrint && anchor === undefined && position > 0 ? captureAnchor(position) : undefined;
    multi = next;
    root.classList.toggle("cl-multi", multi);
    // The pre-mounted layout (Layout.astro) is now the reader's own.
    root.classList.remove("cl-premount");
    articleScrollport.tabIndex = multi ? -1 : 0;
    if (toolbar) {
      if (multi && header) header.appendChild(toolbar);
      else toolbarParent?.insertBefore(toolbar, toolbarNextSibling);
    }
    reader.hidden = !multi;
    toggle.setAttribute("aria-pressed", String(multi));
    toggle.title = multi ? "1段表示に切り替える" : "n段表示に切り替える";
    activeHeading = "";
    if (multi) {
      // All displayed trees need identical image dimensions for measurement,
      // including parts of the original outside its current column window.
      source.querySelectorAll<HTMLImageElement>("img").forEach((image) => { image.loading = "eager"; });
      dirty = true;
      measure();
      const target = anchorOffset(contentAnchor);
      if (target !== undefined && reading) { reading.restore(fromCss(target)); present(true); }
      articleScrollport.scrollTo({ top: 0, behavior: "instant" });
    } else {
      restoreSource();
      const target = anchorOffset(contentAnchor);
      if (target !== undefined) position = target;
      plane.replaceChildren();
      slots = [];
      geometry = undefined;
      reading = undefined;
      native.reset();
      rangeStart = NaN;
      preferredSourceColumn = undefined;
      articleScrollport.scrollTo({ top: position <= 0 ? 0 : articleScrollport.scrollTop + source.getBoundingClientRect().top + position - readingInset, behavior: "instant" });
      document.dispatchEvent(new CustomEvent("cl:single"));
    }
    if (toggleFocused) toggle.focus({ preventScroll: true });
    saveHistoryPosition();
  };

  // Return a pre-mounted original to the single-column article when the
  // reader does not start in n段 (print, a changed preference, the fallback).
  const releasePremounted = () => {
    if (!premounted || multi) return;
    restoreSource();
    plane.replaceChildren();
    reader.hidden = true;
    // The table of contents skipped its position while pre-mounted (Toc.astro).
    document.dispatchEvent(new CustomEvent("cl:single"));
  };

  const applyDefault = () => {
    if (suspendedForPrint || printing.matches || root.classList.contains("cl-fallback")) return;
    setMulti(startMulti);
  };

  // The original normally lives inside the reader. Return it to the document
  // for printing, where the reader is hidden, then resume the saved position.
  const suspendForPrint = () => {
    if (suspendedForPrint) return;
    suspendedForPrint = true;
    resumeAfterPrint = multi;
    // By the media change event the hidden viewport can already have lost its
    // native offsets. Keep the last logical position instead of reading it now.
    printPosition = position;
    // The anchor alone drops a horizontal offset within a column (native
    // scrolling or an interrupted column step). Keep the exact point as well.
    printPoint = reading ? { point: { ...reading.point }, layout: reading.layout } : undefined;
    setMulti(false);
    releasePremounted();
  };
  const resumeFromPrint = () => {
    if (!suspendedForPrint || printing.matches) return;
    suspendedForPrint = false;
    if (resumeAfterPrint) {
      setMulti(true, printPosition);
      if (printPoint && restoreExactPoint(printPoint.point, printPoint.layout)) {
        present(true);
        saveHistoryPosition();
      }
    }
    resumeAfterPrint = false;
    printPoint = undefined;
    scheduleMeasure();
  };

  toggle.addEventListener("click", () => {
    root.classList.remove("cl-fallback");
    preference = multi ? "single" : "multi";
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, preference); } catch { /* storage is optional */ }
    setMulti(!multi);
  }, { signal });

  viewport.addEventListener("scroll", () => {
    if (!scrolling) scrolling = requestAnimationFrame(() => {
      scrolling = 0;
      // ResizeObserver's anchor takes priority over scrolls caused by resizing.
      if (!measuring) syncPosition();
      saveHistoryPosition();
    });
  }, { passive: true, signal });
  articleScrollport.addEventListener("scroll", saveHistoryPosition, { passive: true, signal });
  // Native vertical input never initiates horizontal movement, including at
  // an edge. Manual gestures only interrupt an explicit key animation.
  viewport.addEventListener("wheel", () => motion.cancelAnimation(), { passive: true, signal });
  viewport.addEventListener("pointerdown", () => motion.cancelAnimation(), { passive: true, signal });
  viewport.addEventListener("touchstart", () => motion.cancelAnimation(), { passive: true, signal });

  // Firefox reports detail=1 for Enter-generated clicks on links. Remember
  // the activating key as well as supporting detail=0 from other browsers
  // and assistive technologies; a pointer press cancels that indication.
  let keyboardActivation: Element | undefined;
  // A pressed control is already on screen. Following its focus would move
  // the view before the click lands, and the click would then miss it.
  let pointerFocus = false;
  document.addEventListener("keydown", (event) => {
    pointerFocus = false;
    keyboardActivation = (event.key === "Enter" || event.key === " ") && event.target instanceof Element
      ? event.target : undefined;
  }, { capture: true, signal });
  document.addEventListener("pointerdown", () => { keyboardActivation = undefined; pointerFocus = true; }, { capture: true, passive: true, signal });
  // Touch moves focus after pointerup, so the press ends at its click.
  document.addEventListener("click", () => { pointerFocus = false; }, { capture: true, passive: true, signal });
  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!multi && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const link = element?.closest<HTMLAnchorElement>(".cl-source a[href]");
      if (link && !link.matches('[href^="#mjx-eqn"]') && !link.closest("[data-toc]")) {
        const url = new URL(link.href, location.href);
        if (url.origin === location.origin && url.pathname + url.search === articlePath && url.hash) {
          // Firefox can scroll to the fragment before popstate fires, so save
          // the departing entry while the original position is still visible.
          saveHistoryPosition(); saveHistoryDetails(); saveHistoryAnchor();
        }
      }
    }
    if (!multi || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const fromKeyboard = event.detail === 0 || Boolean(keyboardActivation && element
      && (keyboardActivation === element || keyboardActivation.contains(element) || element.contains(keyboardActivation)));
    keyboardActivation = undefined;
    const slot = element?.closest(".cl-slot");
    const control = element?.closest("summary, [data-details-close]");
    if (slot && control) {
      const details = control.closest<HTMLDetailsElement>("details");
      const original = details && source.contains(details) ? details
        : source.querySelectorAll<HTMLDetailsElement>("details")[Number(details?.dataset.clDetails)];
      if (original) {
        event.preventDefault();
        event.stopPropagation();
        original.open = control.matches("summary") ? !original.open : false;
        syncDetails();
        scheduleMeasure();
        if (!original.open && fromKeyboard) {
          const summary = original.querySelector<HTMLElement>(":scope > summary");
          if (summary) { navigate(summary); summary.focus({ preventScroll: true }); }
        }
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
    // As in 1段, where the browser follows these links itself, a link in the
    // article adds a history entry; the table of contents and equation
    // references replace the current one.
    const newEntry = Boolean(link.closest(".cl-slot")) && !link.matches('[href^="#mjx-eqn"]')
      && url.href !== location.href;
    if (newEntry) {
      syncPosition();
      saveHistoryPosition(); saveHistoryDetails(); saveHistoryAnchor();
      entryKey = newHistoryKey();
      historyIndex += 1;
      history.pushState({ index: historyIndex, scrollX: window.scrollX, scrollY: window.scrollY,
        dispositifReadingKey: entryKey }, "", url.hash);
      // Astro's router tracks the index and URL it last saw; without this it
      // would treat a later Back to the previous entry as a page change.
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }
    navigate(target);
    if (newEntry) { saveHistoryPosition(); saveHistoryDetails(); }
    else history.replaceState(history.state, "", url.hash);
    if (fromKeyboard) {
      if (!target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
        target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
      }
      target.focus({ preventScroll: true });
    }
  }, { capture: true, signal });

  document.addEventListener("toggle", (event) => {
    if (event.target instanceof HTMLDetailsElement && source.contains(event.target)) {
      if (multi) { syncDetails(); scheduleMeasure(); }
      if (historyReady) saveHistoryDetails();
    }
  }, { capture: true, signal });

  document.addEventListener("keydown", (event) => {
    if (!multi || !geometry || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
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
      reading.vertical(ticks(reading.point.y + direction * count * reading.layout.h));
      present(true);
    } else if (event.key === "Home" || event.key === "End") {
      goToEdge(event.key === "End");
    } else return;
    event.preventDefault();
  }, { signal });

  window.addEventListener("resize", scheduleMeasure, { signal });
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
    const pressed = pointerFocus;
    pointerFocus = false;
    if (event.target instanceof HTMLElement && multi && !pressed) navigate(event.target);
  }, { signal });

  const resizeObserver = new ResizeObserver(scheduleMeasure);
  [source, viewport, ruler, header, toolbar].forEach((element) => { if (element) resizeObserver.observe(element); });
  const mutationObserver = new MutationObserver(() => { dirty = true; scheduleMeasure(); });
  mutationObserver.observe(source, { childList: true, subtree: true, characterData: true });

  const restoreDetails = (saved: HistoryPosition) => {
    let changed = false;
    if (Array.isArray(saved.details)) {
      source.querySelectorAll<HTMLDetailsElement>("details").forEach((details, index) => {
        const open = saved.details![index];
        if (typeof open === "boolean" && details.open !== open) { details.open = open; changed = true; }
      });
    }
    return changed;
  };
  // Restore an exact point only when the layout it was taken in still holds.
  const restoreExactPoint = (point: ReadingPoint, layout: ColumnMetrics) => {
    if (!reading || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !sameLayout(reading.layout, layout)) return false;
    reading.restorePoint(point);
    return true;
  };
  const restoreHistoryPosition = (saved: HistoryPosition) => {
    const sameMode = saved.mode === (multi ? "multi" : "single");
    const sameWidth = !saved.anchor || Math.abs(
      (parseFloat(getComputedStyle(source).width) || source.getBoundingClientRect().width)
        - saved.anchor.width) < 0.5;
    if (multi && reading && sameMode) {
      if (!saved.point || !saved.layout || !restoreExactPoint(saved.point, saved.layout)) {
        reading.restore(fromCss(historyAnchorOffset(saved.anchor) ?? saved.position));
      }
      present(true);
    } else if (!multi && sameMode && sameWidth) articleScrollport.scrollTop = saved.position;
    else {
      const anchor = historyAnchorOffset(saved.anchor);
      if (anchor !== undefined) {
        if (multi && reading) { reading.restore(fromCss(anchor)); present(true); }
        else {
          const inset = 1.5 * (parseFloat(getComputedStyle(root).fontSize) || 16);
          articleScrollport.scrollTop += source.getBoundingClientRect().top + anchor - inset;
        }
      } else if (sameMode && !multi) articleScrollport.scrollTop = saved.position;
      else followHash();
    }
  };

  let restoredHash: string | undefined;
  window.addEventListener("popstate", () => {
    if (!historyReady || location.pathname + location.search !== articlePath) return;
    // Native fragment navigation can create an entry with null state. Astro's
    // router ignores such entries, so give it a normal index and notify it.
    const nativeFragmentEntry = history.state === null;
    if (nativeFragmentEntry) {
      history.replaceState({ index: historyIndex + 1, scrollX: window.scrollX, scrollY: window.scrollY }, "");
    }
    const nextKey = history.state?.dispositifReadingKey;
    if (nextKey && nextKey === entryKey) return;
    if (nextKey) {
      if (multi) syncPosition();
      saveHistoryPosition();
      saveHistoryDetails();
      saveHistoryAnchor();
    } else {
      // A native fragment change may already have moved the scrollport in
      // Firefox. Reconstruct the old document offset from the saved position
      // instead of anchoring the destination that just came into view.
      const previous = historyPositions.get(entryKey);
      if (previous && !previous.anchor) {
        const inset = 1.5 * (parseFloat(getComputedStyle(root).fontSize) || 16);
        const offset = previous.mode === "multi" ? previous.position
          : Math.max(0, inset - source.getBoundingClientRect().top
            + previous.position - articleScrollport.scrollTop);
        saveHistoryAnchor(offset);
      }
    }
    entryKey = ensureHistoryKey();
    if (Number.isFinite(history.state?.index)) historyIndex = Number(history.state.index);
    if (nativeFragmentEntry) window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    const saved = historyPositions.get(entryKey);
    if (saved) {
      const changed = restoreDetails(saved);
      if (changed && multi) { syncDetails(); dirty = true; measure(); }
      restoreHistoryPosition(saved);
      restoredHash = location.hash;
    } else {
      // The browser will move to the new fragment after the popstate event.
      // Subsequent scroll events record that position under the new key.
      saveHistoryPosition();
      saveHistoryDetails();
      restoredHash = undefined;
    }
  }, { signal });
  window.addEventListener("hashchange", () => {
    if (restoredHash === location.hash) { restoredHash = undefined; return; }
    restoredHash = undefined;
    followHash();
  }, { signal });

  root.classList.add("cl-ready");
  // All astro:page-load handlers (including copy-button enhancement) finish first.
  const initialFrame = requestAnimationFrame(() => {
    try {
      // Restore disclosure layout before measuring or applying a saved offset.
      if (savedHistoryPosition) restoreDetails(savedHistoryPosition);
      applyDefault();
      releasePremounted();
      if (savedHistoryPosition) restoreHistoryPosition(savedHistoryPosition);
      else followHash();
      historyReady = true;
      saveHistoryPosition();
    } finally {
      // The layout fallback stands down once cl-ready is set, so never leave
      // the article hidden if restoring throws.
      root.classList.remove("cl-pending");
      // Set with cl-pending by Layout.astro.
      articleScrollport.removeAttribute("aria-hidden");
    }
  });
  const saveReaderState = () => {
    // Before the first frame the entry has not been restored yet; saving now
    // would replace its saved disclosures and anchor with the defaults.
    if (!historyReady) return;
    if (multi) syncPosition();
    saveHistoryPosition();
    saveHistoryDetails();
    saveHistoryAnchor();
  };
  saveActiveReader = saveReaderState;
  dispose = () => {
    saveReaderState();
    saveActiveReader = undefined;
    motion.reset();
    controller.abort();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    [initialFrame, measuring, scrolling, offscreenFrame].forEach(cancelAnimationFrame);
    root.classList.remove("cl-multi", "cl-ready");
    article.style.removeProperty("--cl-header-height");
    if (toolbar) toolbarParent?.insertBefore(toolbar, toolbarNextSibling);
    restoreSource();
    reader.hidden = true;
    plane.replaceChildren();
  };
  document.addEventListener("astro:before-swap", () => { dispose?.(); dispose = undefined; }, { once: true, signal });
}
