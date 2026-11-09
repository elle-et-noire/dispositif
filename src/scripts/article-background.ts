// The list itself persists; its shell belongs to the destination page so inert
// and aria-hidden change with the route rather than persisting stale attributes.
const index = () => document.querySelector<HTMLElement>("[data-article-index]");
const indexScrollport = () => document.querySelector<HTMLElement>(".article-index-shell");
const isArticle = () => document.documentElement.dataset.pageKind === "article";
let returningToIndex = false;
let lastInput: "pointer" | "keyboard" = "keyboard";
let returnByPointer = false;

document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, { capture: true, passive: true });
document.addEventListener("keydown", (event) => {
  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
  lastInput = "keyboard";
  const focused = document.querySelector<HTMLElement>(".index-restored-pointer-focus:focus");
  if (focused) {
    focused.classList.remove("index-restored-pointer-focus");
    focused.classList.add("index-restored-keyboard-focus");
  }
}, { capture: true });
document.addEventListener("focusout", (event) => {
  if (event.target instanceof HTMLElement) {
    event.target.classList.remove("index-restored-pointer-focus", "index-restored-keyboard-focus");
  }
});

const saveIndexPosition = () => {
  const list = index();
  const scrollport = indexScrollport();
  if (!list || !scrollport || isArticle()) return;
  list.dataset.scrollY = String(scrollport.scrollTop);
  list.style.setProperty("--article-index-offset", `${-scrollport.scrollTop}px`);
};

document.addEventListener("astro:before-preparation", (event) => {
  // History traversal (Alt+←, the back button, a mouse back button) is not a
  // keyboard activation of a control on the page, even when its last input
  // was the Alt+← keydown, so restore the card like a pointer return: no ring
  // until the next key press.
  if (isArticle()) returnByPointer = lastInput === "pointer" || event.navigationType === "traverse";
  saveIndexPosition();
});

document.addEventListener("astro:before-swap", () => {
  returningToIndex = isArticle();
  // Include scrolling that happened while the destination was being fetched.
  saveIndexPosition();
});

const restoreIndex = () => {
  const list = index();
  if (!list) return;
  if (isArticle()) {
    list.dataset.returnPath = location.pathname;
    return;
  }
  if (!returningToIndex) return;
  indexScrollport()?.scrollTo({ top: Number(list.dataset.scrollY) || 0, behavior: "instant" });
  const link = Array.from(list.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .find((item) => item.pathname === list.dataset.returnPath);
  if (link) {
    link.classList.toggle("index-restored-pointer-focus", returnByPointer);
    link.classList.toggle("index-restored-keyboard-focus", !returnByPointer);
    link.focus({ preventScroll: true });
  }
};

document.addEventListener("astro:after-swap", restoreIndex);
document.addEventListener("astro:page-load", () => {
  restoreIndex();
  returningToIndex = false;
});

let press: { x: number; y: number; scrollX: number; scrollY: number; selected: boolean } | undefined;
document.addEventListener("pointerdown", (event) => {
  const viewport = document.querySelector<HTMLElement>(".cl-viewport");
  press = { x: event.clientX, y: event.clientY,
    scrollX: viewport?.scrollLeft ?? 0, scrollY: viewport?.scrollTop ?? 0,
    selected: !window.getSelection()?.isCollapsed };
}, { passive: true });

document.addEventListener("click", (event) => {
  if (!document.documentElement.classList.contains("cl-multi")
    || event.defaultPrevented || event.button !== 0 || event.detail === 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".cl-article")
    || target.closest("a, button, input, select, textarea, summary")) return;
  const viewport = document.querySelector<HTMLElement>(".cl-viewport");
  if (!viewport || !press || press.selected || !window.getSelection()?.isCollapsed
    || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5
    || Math.abs(viewport.scrollLeft - press.scrollX) > 1
    || Math.abs(viewport.scrollTop - press.scrollY) > 1) return;
  // Native scrollbar events target the viewport too. Keep both strips operable.
  const frame = viewport.getBoundingClientRect();
  const scale = frame.height / viewport.offsetHeight;
  if (event.clientX >= frame.left && event.clientX <= frame.right
    && event.clientY >= frame.top && event.clientY <= frame.bottom
    && (event.clientX >= frame.left + viewport.clientWidth * scale
      || event.clientY >= frame.top + viewport.clientHeight * scale)) return;
  const onPaper = Array.from(document.querySelectorAll<HTMLElement>(".cl-paper"))
    .some((paper) => {
      const rect = paper.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (!rect.height || x < 0 || x >= rect.width || y < 0 || y >= rect.height) return false;
      const style = getComputedStyle(paper);
      const scale = rect.width / paper.offsetWidth;
      // CSS reduces radii when a tiny tail is shorter than its rounded ends.
      const top = parseFloat(style.borderTopLeftRadius) * scale;
      const bottom = parseFloat(style.borderBottomLeftRadius) * scale;
      const fit = Math.min(1, rect.height / (top + bottom || 1), rect.width / (2 * Math.max(top, bottom) || 1));
      const topRadius = top * fit, bottomRadius = bottom * fit;
      if (y < topRadius) {
        if (x < topRadius) return Math.hypot(x - topRadius, y - topRadius) <= topRadius;
        if (x > rect.width - topRadius) return Math.hypot(x - rect.width + topRadius, y - topRadius) <= topRadius;
      }
      if (y > rect.height - bottomRadius) {
        if (x < bottomRadius) return Math.hypot(x - bottomRadius, y - rect.height + bottomRadius) <= bottomRadius;
        if (x > rect.width - bottomRadius) return Math.hypot(x - rect.width + bottomRadius, y - rect.height + bottomRadius) <= bottomRadius;
      }
      return true;
    });
  if (onPaper) return;
  document.querySelector<HTMLAnchorElement>(".cl-dismiss")?.click();
});
