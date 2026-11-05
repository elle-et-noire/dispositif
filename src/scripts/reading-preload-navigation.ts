import { navigate } from "astro:transitions/client";
import { ReadingPreloader } from "./reading-preload";
import { PreparedReadingFrame } from "./reading-preload-frame";

interface SwapEvent extends Event {
  to: URL;
  newDocument: Document;
  signal: AbortSignal;
}
interface PreparationEvent extends Event {
  to: URL;
  signal: AbortSignal;
}

// An article loaded for preparation has the same components as a top-level
// page. Never create nested speculative readers inside that document.
if (window.top === window) install();

function install(): void {
  const preloader = new ReadingPreloader();
  let hoverTimer = 0;
  let leaveTimer = 0;
  let scheduled = "";
  let active: { reader: PreparedReadingFrame; url: string; started: boolean; committed: boolean; adopted: boolean; queued?: string } | undefined;

  const indexLink = (target: EventTarget | null): HTMLAnchorElement | null => {
    if (!(target instanceof Element) || document.documentElement.dataset.pageKind !== "index") return null;
    return target.closest<HTMLAnchorElement>("[data-article-index] a[href]");
  };
  const schedule = (link: HTMLAnchorElement) => {
    if (active || link.origin !== location.origin || link.target || link.hasAttribute("download")) return;
    if (scheduled === link.href) return;
    scheduled = link.href;
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    hoverTimer = window.setTimeout(() => { void preloader.prepare(link.href); }, 120);
  };
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const link = indexLink(event.target);
    if (link) schedule(link);
  }, { passive: true });
  document.addEventListener("pointerout", (event) => {
    const link = indexLink(event.target);
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return;
    clearTimeout(hoverTimer);
    scheduled = "";
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => preloader.cancel(), 1000);
  }, { passive: true });
  document.addEventListener("focusin", (event) => {
    const link = indexLink(event.target);
    if (link && !link.matches(".index-restored-pointer-focus, .index-restored-keyboard-focus")) schedule(link);
  });

  const remove = (entry: NonNullable<typeof active>) => {
    if (active === entry) active = undefined;
    entry.reader.dispose();
  };

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = indexLink(event.target);
    if (!link || link.target || link.hasAttribute("download") || link.hash) return;
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    scheduled = "";
    const prepared = preloader.take(link.href);
    if (!prepared) return;
    const indexScroll = document.querySelector<HTMLElement>(".article-index-shell")?.scrollTop ?? 0;
    let reader: PreparedReadingFrame | undefined;
    try {
      let entry: NonNullable<typeof active>;
      reader = new PreparedReadingFrame(prepared, (url, replace) => {
        if (!entry.committed && !replace) { entry.queued = url; return; }
        if (replace && document.documentElement.dataset.pageKind === "index") {
          document.addEventListener("astro:after-swap", () => {
            document.querySelector<HTMLElement>(".article-index-shell")?.scrollTo({ top: indexScroll, behavior: "instant" });
            const restored = [...document.querySelectorAll<HTMLAnchorElement>("[data-article-index] a[href]")]
              .find(item => item.href === link.href);
            restored?.focus({ preventScroll: true });
          }, { once: true });
        }
        void navigate(url, { history: replace ? "replace" : "auto" });
      });
      entry = { reader, url: prepared.url, started: false, committed: false, adopted: false };
      active = entry;
      reader.show(indexScroll);
      // If another handler prevents the click, do not leave a speculative
      // document covering the index indefinitely.
      window.setTimeout(() => { if (active === entry && !entry.started) remove(entry); }, 0);
    } catch {
      if (active?.reader === reader) active = undefined;
      if (reader) reader.dispose(); else prepared.frame.remove();
    }
  }, { capture: true });

  document.addEventListener("astro:before-preparation", (raw) => {
    const event = raw as PreparationEvent;
    const entry = active;
    if (!entry) return;
    if (entry.committed) {
      entry.reader.saveBeforeSwap();
      event.signal.addEventListener("abort", () => entry.reader.cancelPendingSave(), { once: true });
      return;
    }
    if (event.to.href.split("#")[0] !== entry.url) return;
    entry.started = true;
    event.signal.addEventListener("abort", () => {
      if (active === entry && !entry.committed) remove(entry);
    }, { once: true });
  });
  document.addEventListener("astro:before-swap", (raw) => {
    const event = raw as SwapEvent;
    const entry = active;
    if (!entry) { preloader.cancel(); return; }
    if (!entry.committed && event.to.href.split("#")[0] === entry.url
      && event.newDocument.documentElement.dataset.pageKind === "article" && entry.reader.isCurrent()) {
      event.newDocument.querySelector("[data-site-header]")?.remove();
      event.newDocument.querySelector(".rm-backdrop")?.remove();
      event.newDocument.querySelector(".rm-article-scrollport")?.remove();
      entry.adopted = true;
      return;
    }
    entry.reader.saveBeforeSwap();
    event.signal.addEventListener("abort", () => entry.reader.cancelPendingSave(), { once: true });
    document.addEventListener("astro:after-swap", () => remove(entry), { once: true });
  });
  document.addEventListener("astro:after-swap", () => {
    const entry = active;
    if (!entry || !entry.adopted || entry.committed) return;
    entry.committed = true;
    try {
      entry.reader.commit();
      document.documentElement.classList.remove("rm-pending");
      if (entry.queued) void navigate(entry.queued);
    } catch {
      // The prepared document may have disappeared or navigated while the
      // destination was loading. Reload the ordinary article in that case.
      remove(entry);
      location.reload();
    }
  });
}
