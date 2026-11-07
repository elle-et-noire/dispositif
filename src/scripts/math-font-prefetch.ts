// Prefetch an article's math fonts together with Astro's hover prefetch of its
// HTML. Without this, MathJax fonts are discovered one by one during the first
// layout after the swap, and each arrival lays the article out again.
//
// The list per link comes from the build (data-math-fonts, lib/math-fonts.ts):
// a JSON array of [family, url] pairs.
// Timing and conditions follow Astro's "hover" strategy: 80 ms of mouse hover
// or focus, cancelled on leave, skipped offline or on a slow connection. Touch
// is ignored: a finger resting on a card before scrolling is not a hover.

const HOVER_DELAY = 80;
const requested = new Set<string>();
let timer = 0;
let pending: HTMLAnchorElement | undefined;

const slowConnection = () => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection && (connection.saveData || /2g/.test(connection.effectiveType ?? "")));
};

// Astro swaps the page inside the same document, so a font loaded here can
// serve the article without being fetched and decoded again after the swap.
// Chromium reuses a loaded font for any @font-face with the same URL. Firefox
// only uses a face in the document's font set under the same family name, so
// each face takes the name the article's @font-face gives it and joins the set
// at the swap (not on hover, so the index's own fonts stay as they are).
//
// The article's own @font-face for a family must not stay next to the loaded
// face, though. MathJax's font stacks start with MJX-TEX-ZERO, a 1 KB face
// with almost no glyphs: in the first layout, characters missing from the
// loaded face fall through to the article's face of the same family, which is
// still unloaded, so it loads after that layout and the whole article is laid
// out again. The article page therefore puts each prefetched family's
// @font-face in its own <style data-math-font> (lib/math-fonts.ts), and before
// the swap we drop those whose face here has loaded. A face still loading or
// never prefetched keeps the article's rule, as on a direct load.
//
// This relies on MathJax declaring each face with a family and URL only (no
// weight, style, unicode-range...), so the loaded face is the same font as the
// rule it replaces. The Firefox reuse above relies on the same.
const loaded = new Map<FontFace, { family: string; url: string }>();
const resolve = (url: string) => new URL(url, location.href).href;

document.addEventListener("astro:before-swap", (event) => {
  // Before the swap rather than after: Astro may scroll (and so lay out) the
  // new page between the swap and astro:after-swap, as on history traversal.
  for (const face of loaded.keys()) if (!document.fonts.has(face)) document.fonts.add(face);
  const ready = [...loaded].filter(([face]) => face.status === "loaded").map(([, font]) => font);
  if (!ready.length) return;
  const head = event.newDocument.head;
  for (const style of head.querySelectorAll<HTMLStyleElement>("style[data-math-font]")) {
    const { mathFont: family, mathFontUrl: url = "" } = style.dataset;
    if (ready.some((font) => font.family === family && resolve(font.url) === resolve(url))) style.remove();
  }
  // Nothing is left to preload once its face has loaded here.
  for (const link of head.querySelectorAll<HTMLLinkElement>("link[data-math-font-preload]")) {
    const href = resolve(link.getAttribute("href") ?? "");
    if (ready.some((font) => resolve(font.url) === href)) link.remove();
  }
});

function parseFonts(anchor: HTMLAnchorElement): [family: string, url: string][] {
  try {
    const fonts: unknown = JSON.parse(anchor.dataset.mathFonts ?? "[]");
    return Array.isArray(fonts)
      ? fonts.filter((font): font is [string, string] => Array.isArray(font)
        && typeof font[0] === "string" && typeof font[1] === "string")
      : [];
  } catch {
    return [];
  }
}

function prefetchFonts(anchor: HTMLAnchorElement) {
  if (!navigator.onLine || slowConnection() || typeof FontFace === "undefined") return;
  for (const [family, url] of parseFonts(anchor)) {
    if (requested.has(url)) continue;
    requested.add(url);
    const face = new FontFace(family, `url("${url}") format("woff2")`);
    loaded.set(face, { family, url });
    face.load().catch(() => {
      requested.delete(url);
      loaded.delete(face);
      document.fonts.delete(face);
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
  if (event.pointerType === "touch") return;
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
