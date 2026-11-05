// Prefetch an article's math fonts together with Astro's hover prefetch of its
// HTML. Without this, MathJax fonts are discovered one by one during the first
// layout after the swap, and each arrival lays the article out again.
//
// The list per link comes from the build (data-math-fonts, lib/math-fonts.ts).
// Timing and conditions follow Astro's "hover" strategy: 80 ms of hover or
// focus, cancelled on leave, skipped offline or on a slow connection.

const HOVER_DELAY = 80;
const requested = new Set<string>();
let timer = 0;
let pending: HTMLAnchorElement | undefined;

const slowConnection = () => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection && (connection.saveData || /2g/.test(connection.effectiveType ?? "")));
};

// Astro swaps the page inside the same document. A font already loaded here is
// reused from memory when the article's @font-face names the same URL, while
// an HTTP-cache prefetch alone still leaves each font to arrive (and re-lay out
// the article) after the swap. Load under a private family name and keep the
// faces out of document.fonts, so nothing on the index changes.
const loaded: FontFace[] = [];

function prefetchFonts(anchor: HTMLAnchorElement) {
  if (!navigator.onLine || slowConnection() || typeof FontFace === "undefined") return;
  for (const url of anchor.dataset.mathFonts?.split(/\s+/) ?? []) {
    if (!url || requested.has(url)) continue;
    requested.add(url);
    const face = new FontFace(`rm-prefetch-${requested.size}`, `url("${url}") format("woff2")`);
    loaded.push(face);
    face.load().catch(() => {
      requested.delete(url);
      loaded.splice(loaded.indexOf(face), 1);
    });
  }
}

const fontLink = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLAnchorElement>("a[data-math-fonts]") ?? undefined : undefined;

const schedule = (anchor: HTMLAnchorElement) => {
  if (pending === anchor) return;
  cancel();
  pending = anchor;
  timer = window.setTimeout(() => { timer = 0; pending = undefined; prefetchFonts(anchor); }, HOVER_DELAY);
};

const cancel = () => {
  window.clearTimeout(timer);
  timer = 0;
  pending = undefined;
};

document.addEventListener("pointerover", (event) => {
  const anchor = fontLink(event.target);
  if (anchor) schedule(anchor);
}, { passive: true });
document.addEventListener("pointerout", (event) => {
  const anchor = fontLink(event.target);
  if (anchor && anchor === pending && !anchor.contains(event.relatedTarget as Node | null)) cancel();
}, { passive: true });
document.addEventListener("focusin", (event) => {
  const anchor = fontLink(event.target);
  if (anchor) schedule(anchor);
});
document.addEventListener("focusout", (event) => {
  if (fontLink(event.target) === pending) cancel();
});
