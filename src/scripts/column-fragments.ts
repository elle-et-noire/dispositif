interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
  borderTop: number;
  borderLeft: number;
}

type FragmentElement = HTMLElement | SVGElement;

interface Block extends Box {
  element: FragmentElement;
  parent: HTMLElement;
  bottom: number;
}

interface RenderedRange {
  revision: number;
  from: number;
  to: number;
  /** The `from` of the last call, for the direction of travel. */
  at: number;
  blocks: Map<FragmentElement, FragmentElement>;
  parents: Map<HTMLElement, HTMLElement>;
}

/** One measured article; other columns contain only nearby, whole blocks. */
export class ColumnFragments {
  private blocks: Block[] = [];
  private bottomBounds: number[] = [];
  private boxes = new Map<FragmentElement, Box>();
  private details = new WeakMap<HTMLDetailsElement, number>();
  private collapsedStarts = new WeakMap<FragmentElement, number>();
  private revision = 0;
  private rendered = new WeakMap<HTMLElement, RenderedRange>();

  constructor(private source: HTMLElement) {}

  /** Read layout only after a resize/content change, never on a scroll frame. */
  measure(force: boolean) {
    const sourceBox = this.source.getBoundingClientRect();
    const scale = sourceBox.width / (parseFloat(getComputedStyle(this.source).width) || sourceBox.width);
    const boxes = new Map<FragmentElement, Box>();
    const collapsedStarts = new WeakMap<FragmentElement, number>();
    const blocks: Block[] = [];
    const visit = (parent: HTMLElement) => {
      for (const element of parent.children) {
        if (!(element instanceof HTMLElement || element instanceof SVGElement) || element.matches("script, style")) continue;
        const rect = element.getBoundingClientRect();
        const box = {
          top: (rect.top - sourceBox.top) / scale,
          left: (rect.left - sourceBox.left) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
          borderTop: element.clientTop,
          borderLeft: element.clientLeft,
        };
        boxes.set(element, box);
        // The Markdown wrapper must not become an article-sized block. Lists,
        // tables, details and code figures remain intact to preserve their
        // numbering, internal layout and controls.
        // Raw HTML with loose inline text has no safe block boundary. Keep it
        // intact, just as a single long paragraph, rather than dropping text.
        const looseText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        if (element instanceof HTMLElement && element.classList.contains("post") && !looseText) visit(element);
        else {
          blocks.push({ ...box, element, parent, bottom: box.top + box.height });
          // Absolute placement creates a formatting context. Record the first
          // child margins that originally collapsed out of this block, so a
          // list's text does not acquire an extra margin inside its new box.
          let node: FragmentElement = element;
          let depth = 0;
          while (node instanceof HTMLElement) {
            const style = getComputedStyle(node);
            const first = node.firstElementChild;
            if (!["block", "list-item"].includes(style.display)
              || parseFloat(style.paddingTop) || parseFloat(style.borderTopWidth)
              || !(first instanceof HTMLElement)) break;
            let before = first.previousSibling;
            while (before && !before.textContent?.trim()) before = before.previousSibling;
            const childStyle = getComputedStyle(first);
            if (before || !["block", "list-item"].includes(childStyle.display)
              || childStyle.float !== "none" || ["absolute", "fixed"].includes(childStyle.position)
              || Math.abs(first.getBoundingClientRect().top - node.getBoundingClientRect().top) >= 0.01) break;
            depth++;
            node = first;
          }
          collapsedStarts.set(element, depth);
        }
      }
    };
    visit(this.source);
    blocks.sort((a, b) => a.top - b.top);
    const unchanged = !force && boxes.size === this.boxes.size
      && [...boxes].every(([element, box]) => {
        const old = this.boxes.get(element);
        return old && this.collapsedStarts.get(element) === collapsedStarts.get(element)
          && (Object.keys(box) as (keyof Box)[]).every((key) => Math.abs(old[key] - box[key]) < 0.01);
      });
    if (unchanged) return;
    this.boxes = boxes;
    this.collapsedStarts = collapsedStarts;
    this.blocks = blocks;
    let bottom = -Infinity;
    this.bottomBounds = blocks.map((block) => (bottom = Math.max(bottom, block.bottom)));
    this.details = new WeakMap(Array.from(this.source.querySelectorAll<HTMLDetailsElement>("details"),
      (details, i) => [details, i]));
    this.revision++;
  }

  createContent() {
    const content = this.source.cloneNode(false) as HTMLElement;
    content.classList.remove("cl-source");
    content.classList.add("cl-content");
    content.removeAttribute("id");
    content.removeAttribute("style");
    content.dataset.clFragmented = "";
    return content;
  }

  private clone(element: FragmentElement) {
    const copy = element.cloneNode(true) as FragmentElement;
    let first: Element = copy;
    for (let i = 0; i < (this.collapsedStarts.get(element) ?? 0); i++) {
      first = first.firstElementChild!;
      (first as HTMLElement).style.marginTop = "0";
    }
    [copy, ...copy.querySelectorAll("[id]")].forEach((node) => node.removeAttribute("id"));
    const originalDetails = element.matches("details")
      ? [element as HTMLDetailsElement, ...element.querySelectorAll<HTMLDetailsElement>("details")]
      : [...element.querySelectorAll<HTMLDetailsElement>("details")];
    const copiedDetails = copy.matches("details")
      ? [copy as HTMLDetailsElement, ...copy.querySelectorAll<HTMLDetailsElement>("details")]
      : [...copy.querySelectorAll<HTMLDetailsElement>("details")];
    copiedDetails.forEach((details, i) => { details.dataset.clDetails = String(this.details.get(originalDetails[i])); });
    const controls = "a, button, input, select, textarea, summary, [tabindex], [contenteditable], audio, video";
    const interactive = [...copy.querySelectorAll<HTMLElement>(controls)];
    if (copy instanceof HTMLElement && copy.matches(controls)) interactive.push(copy);
    interactive.forEach((node) => {
      node.tabIndex = -1;
      node.removeAttribute("autofocus");
      node.removeAttribute("contenteditable");
    });
    copy.querySelectorAll("script").forEach((script) => script.remove());
    return copy;
  }

  private place(copy: FragmentElement, box: Box, parent?: Box) {
    // Freeze the measured border box instead of allowing omitted siblings to
    // change margin collapse, first/last-child margins, or available line width.
    Object.assign(copy.style, {
      position: "absolute",
      top: `${box.top - (parent?.top ?? 0)}px`,
      left: `${box.left - (parent?.left ?? 0)}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: "0",
      boxSizing: "border-box",
    });
  }

  render(content: HTMLElement, from: number, height: number, length: number) {
    let state = this.rendered.get(content);
    if (!state || state.revision !== this.revision) {
      content.replaceChildren();
      content.style.height = `${length}px`;
      state = { revision: this.revision, from: Infinity, to: -Infinity, at: from, blocks: new Map(), parents: new Map() };
      this.rendered.set(content, state);
    }
    // A small pixel margin covers native scrolling between JS updates; it is
    // independent of article length and never retains departed blocks. Native
    // scrolling runs ahead of a busy main thread, so the range is renewed
    // while half a margin is still prepared ahead, not once it is used up,
    // and most of the margin goes in the direction of travel.
    const margin = Math.min(160, height / 4);
    const step = from - state.at;
    state.at = from;
    // Past the article's ends there is nothing to prepare.
    if ((state.from <= 0 || from - state.from >= margin / 2)
      && (state.to >= length || state.to - from - height >= margin / 2)) return;
    const direction = Math.abs(step) < height ? Math.sign(step) : 0;
    state.from = from - margin * (1 - direction / 2);
    state.to = from + height + margin * (1 + direction / 2);
    let low = 0;
    let high = this.blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.bottomBounds[mid] < state.from) low = mid + 1;
      else high = mid;
    }
    const wanted: Block[] = [];
    for (let i = low; i < this.blocks.length && this.blocks[i].top <= state.to; i++) {
      if (this.blocks[i].bottom >= state.from) wanted.push(this.blocks[i]);
    }
    const retained = new Set(wanted.map((block) => block.element));
    for (const [element, copy] of state.blocks) {
      if (!retained.has(element)) {
        copy.remove();
        state.blocks.delete(element);
      }
    }
    const previous = new Map<HTMLElement, FragmentElement>();
    for (const block of wanted) {
      let parent = content;
      let parentBox: Box | undefined;
      if (block.parent !== this.source) {
        const box = this.boxes.get(block.parent)!;
        parentBox = { ...box, top: box.top + box.borderTop, left: box.left + box.borderLeft };
        let shell = state.parents.get(block.parent);
        if (!shell) {
          shell = block.parent.cloneNode(false) as HTMLElement;
          shell.removeAttribute("id");
          this.place(shell, box);
          content.appendChild(shell);
          state.parents.set(block.parent, shell);
        }
        parent = shell;
      }
      let copy = state.blocks.get(block.element);
      if (!copy) {
        copy = this.clone(block.element);
        this.place(copy, block, parentBox);
        state.blocks.set(block.element, copy);
      }
      const previousCopy = previous.get(parent);
      const before = previousCopy ? previousCopy.nextSibling : parent.firstChild;
      if (copy !== before) parent.insertBefore(copy, before);
      previous.set(parent, copy);
    }
  }
}
