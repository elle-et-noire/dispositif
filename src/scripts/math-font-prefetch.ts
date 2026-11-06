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
// MathJax declares each face with a name and URL only, so the article renders
// with the same font either way.
const loaded = new Set<FontFace>();
document.addEventListener("astro:after-swap", () => {
  for (const face of loaded) if (!document.fonts.has(face)) document.fonts.add(face);
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
    loaded.add(face);
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
