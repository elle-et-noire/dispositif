// The list itself persists; its shell belongs to the destination page so inert
// and aria-hidden change with the route rather than persisting stale attributes.
const index = () => document.querySelector<HTMLElement>("[data-article-index]");
const isArticle = () => document.documentElement.dataset.pageKind === "article";
let returningToIndex = false;

const saveIndexPosition = () => {
  const list = index();
  if (!list || isArticle()) return;
  list.dataset.scrollY = String(window.scrollY);
  list.style.setProperty("--article-index-offset", `${-window.scrollY}px`);
};

document.addEventListener("astro:before-preparation", saveIndexPosition);

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
  window.scrollTo({ top: Number(list.dataset.scrollY) || 0, behavior: "instant" });
  const link = Array.from(list.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .find((item) => item.pathname === list.dataset.returnPath);
  link?.focus({ preventScroll: true });
};

document.addEventListener("astro:after-swap", restoreIndex);
document.addEventListener("astro:page-load", () => {
  restoreIndex();
  returningToIndex = false;
});

let press: { x: number; y: number; scrollX: number; scrollY: number; selected: boolean } | undefined;
document.addEventListener("pointerdown", (event) => {
  const viewport = document.querySelector<HTMLElement>(".rm-viewport");
  press = { x: event.clientX, y: event.clientY,
    scrollX: viewport?.scrollLeft ?? 0, scrollY: viewport?.scrollTop ?? 0,
    selected: !window.getSelection()?.isCollapsed };
}, { passive: true });

document.addEventListener("click", (event) => {
  if (!document.documentElement.classList.contains("rm-active")
    || event.defaultPrevented || event.button !== 0 || event.detail === 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".rm-article")
    || target.closest("a, button, input, select, textarea, summary, .rm-scrollbar")) return;
  const viewport = document.querySelector<HTMLElement>(".rm-viewport");
  if (!viewport || !press || press.selected || !window.getSelection()?.isCollapsed
    || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5
    || Math.abs(viewport.scrollLeft - press.scrollX) > 1
    || Math.abs(viewport.scrollTop - press.scrollY) > 1) return;
  // Native scrollbar events target the viewport too. Keep that strip operable.
  const frame = viewport.getBoundingClientRect();
  const scale = frame.height / viewport.offsetHeight;
  if (event.clientY >= frame.top + viewport.clientHeight * scale && event.clientY <= frame.bottom) return;
  const onPaper = Array.from(document.querySelectorAll<HTMLElement>(".rm-paper"))
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
  document.querySelector<HTMLAnchorElement>(".rm-backdrop")?.click();
});
