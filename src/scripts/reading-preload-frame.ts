import type { PreparedReading } from "./reading-preload";

type Navigate = (url: string, replace: boolean) => void;

/** Owns a prepared document after it has been selected for navigation. */
export class PreparedReadingFrame {
  private readonly frame: HTMLIFrameElement;
  private readonly url: string;
  private readonly child: Window & typeof globalThis;
  private readonly doc: Document;
  private readonly controller = new AbortController();
  private readonly printStyle: HTMLStyleElement;
  private printPaper?: HTMLElement;
  private printStyles: HTMLStyleElement[] = [];
  private readonly replaceChildHistory: History["replaceState"];
  private committed = false;
  private disposed = false;

  constructor(prepared: PreparedReading, private readonly navigate: Navigate) {
    this.frame = prepared.frame;
    this.url = prepared.url;
    const child = this.frame.contentWindow as (Window & typeof globalThis) | null;
    const doc = this.frame.contentDocument;
    if (!child || !doc) throw new Error("Prepared reader is no longer available");
    this.child = child;
    this.doc = doc;
    const { signal } = this.controller;

    // History changes within the reader must be reflected in the address bar.
    this.replaceChildHistory = child.history.replaceState;
    const original = this.replaceChildHistory;
    const owner = this;
    child.history.replaceState = function (state, unused, url) {
      original.call(this, state, unused, url);
      owner.syncHash();
    };
    child.addEventListener("hashchange", () => this.syncHash(), { signal });
    doc.addEventListener("click", (event) => this.forwardLink(event), { capture: true, signal });
    doc.fonts.addEventListener("loadingdone", () => this.preparePrintFonts(), { signal });
    window.addEventListener("beforeprint", () => this.beforePrint(), { signal });
    window.addEventListener("afterprint", () => this.afterPrint(), { signal });

    this.printStyle = document.createElement("style");
    this.printStyle.textContent = "@media print { html.rm-prepared-reader-print iframe[data-rm-prepared-reader], html.rm-prepared-reader-print body > main:not([data-rm-print]) { display:none !important; } }";
    document.documentElement.append(this.printStyle);
  }

  /** Make the already laid out article visible without moving its document. */
  show(indexScroll: number): void {
    const list = this.doc.querySelector<HTMLElement>("[data-article-index]");
    list?.style.setProperty("--article-index-offset", `${-indexScroll}px`);
    delete this.frame.dataset.rmPreparing;
    this.frame.dataset.rmPreparedReader = "";
    this.frame.title = this.doc.title || "記事";
    this.frame.inert = false;
    this.frame.removeAttribute("aria-hidden");
    this.frame.tabIndex = 0;
    this.frame.style.zIndex = "2147483647";
    this.frame.style.pointerEvents = "auto";
    this.frame.style.transform = "translateX(0)";
    document.documentElement.classList.add("rm-prepared-reader-print");
    this.doc.querySelector<HTMLElement>(".rm-viewport")?.focus({ preventScroll: true });
  }

  /** Reject a frame which navigated or was replaced during the transition. */
  isCurrent(): boolean {
    if (this.disposed || !this.frame.isConnected) return false;
    try {
      const url = new URL(this.child.location.href);
      url.hash = "";
      return this.frame.contentDocument === this.doc && url.href === this.url;
    } catch { return false; }
  }

  /** Called after Astro has committed the matching outer history entry. */
  commit(): void {
    if (!this.isCurrent()) throw new Error("Prepared reader changed during navigation");
    this.committed = true;
    document.documentElement.classList.add("rm-prepared-reader-print");
    const key: unknown = this.child.history.state?.dispositifReadingKey;
    if (typeof key === "string") {
      history.replaceState({ ...history.state, dispositifReadingKey: key }, "", location.pathname + location.search + this.child.location.hash);
    }
    this.preparePrintFonts();
  }

  private syncHash(): void {
    if (!this.committed || this.disposed) return;
    try {
      if (location.pathname !== this.child.location.pathname || location.search !== this.child.location.search) return;
      history.replaceState(history.state, "", location.pathname + location.search + this.child.location.hash);
    } catch { /* Keep reading available if history is unavailable. */ }
  }

  private forwardLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof this.child.Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    let url: URL;
    try { url = new URL(link.href, this.child.location.href); } catch { return; }
    if (!["http:", "https:"].includes(url.protocol)) return;
    const current = this.child.location;
    // The reader already handles in-article links and updates its own history.
    if (url.origin === current.origin && url.pathname === current.pathname && url.search === current.search) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (url.origin !== location.origin) { location.assign(url.href); return; }
    // If the article has not committed yet, replacing the still-visible index
    // cancels the in-flight navigation without creating a spurious entry.
    const closingBeforeCommit = !this.committed && (link.matches(".rm-close, .rm-dismiss") || url.pathname === location.pathname);
    this.navigate(url.href, closingBeforeCommit);
  }

  private preparePrintFonts(): void {
    if (!this.committed || this.disposed) return;
    try {
      const key = (face: FontFace) => [face.family, face.style, face.weight, face.stretch].join("|");
      const used = new Set([...this.doc.fonts].filter(face => face.status === "loaded").map(key));
      for (const face of document.fonts) {
        if (face.family.startsWith("MJX-") && used.has(key(face))) void face.load().catch(() => {});
      }
    } catch { /* A normal navigation remains possible if font loading fails. */ }
  }

  private beforePrint(): void {
    if (this.disposed || this.printPaper) return;
    const source = this.doc.querySelector<HTMLElement>(".rm-source");
    const article = this.doc.querySelector<HTMLElement>(".rm-article");
    const layout = this.doc.querySelector<HTMLElement>(".rm-layout");
    const port = this.doc.querySelector<HTMLElement>(".rm-article-scrollport");
    const main = this.doc.querySelector<HTMLElement>("body > main");
    if (!source || !article || !layout || !port || !main) return;
    const paper = main.cloneNode(false) as HTMLElement;
    paper.dataset.rmPrint = "";
    const portCopy = port.cloneNode(false) as HTMLElement;
    const articleCopy = article.cloneNode(false) as HTMLElement;
    const layoutCopy = layout.cloneNode(false) as HTMLElement;
    const aside = this.doc.querySelector(".rm-sidebar");
    if (aside) layoutCopy.append(aside.cloneNode(true));
    const content = source.cloneNode(true) as HTMLElement;
    content.classList.remove("rm-content");
    for (const property of ["width", "left", "translate"]) content.style.removeProperty(property);
    layoutCopy.append(content);
    articleCopy.append(layoutCopy);
    portCopy.append(articleCopy);
    paper.append(portCopy);
    document.body.append(paper);
    this.printPaper = paper;
    this.printStyles = [...this.doc.head.querySelectorAll("style")].map((original) => {
      const style = document.createElement("style");
      style.textContent = original.textContent;
      document.head.append(style);
      return style;
    });
  }

  private afterPrint(): void {
    this.printPaper?.remove();
    this.printPaper = undefined;
    this.printStyles.forEach(style => style.remove());
    this.printStyles = [];
  }

  saveBeforeSwap(): void {
    if (this.disposed) return;
    try { this.doc.dispatchEvent(new this.child.Event("rm:preload-save")); }
    catch { /* The frame may already have navigated away. */ }
  }

  cancelPendingSave(): void {
    if (this.disposed) return;
    try { this.doc.dispatchEvent(new this.child.Event("rm:preload-cancel-save")); }
    catch { /* The frame may already have navigated away. */ }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    try { this.child.history.replaceState = this.replaceChildHistory; } catch { /* The frame may have navigated away. */ }
    this.afterPrint();
    this.printStyle.remove();
    document.documentElement.classList.remove("rm-prepared-reader-print");
    // Flush before removal: Firefox can reset the native scroll position as an
    // iframe is detached, before its pagehide handler has run.
    try { this.doc.dispatchEvent(new this.child.Event("rm:preload-dispose")); }
    catch { /* A cross-origin navigation may have detached the prepared document. */ }
    this.frame.remove();
  }
}
