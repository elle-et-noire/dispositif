// @ts-nocheck
// Experimental adapter; not imported by production code.
import { ReadingFragments as BaseReadingFragments } from "../../src/scripts/reading-fragments";

interface Box { top: number; left: number; width: number; height: number; borderTop: number; borderLeft: number }
type FragmentElement = HTMLElement | SVGElement;
interface Block extends Box { element: FragmentElement; parent: HTMLElement; bottom: number }
// Serializable geometry contains paths instead of DOM references so it can be
// transferred from a separately measured document. The caller must validate
// the layout environment and content before adopting a snapshot.
export interface FragmentSnapshot {
  boxes: { path: number[]; tag: string; box: Box; depth?: number }[];
  blocks: number[];
}

export class ReadingFragments extends BaseReadingFragments {
  snapshot(): FragmentSnapshot {
    const entries = [...this.boxes];
    const indices = new Map(entries.map(([element], index) => [element, index]));
    const pathOf = (element: Element) => {
      const path: number[] = [];
      while (element !== this.source) {
        const parent = element.parentElement;
        if (!parent) throw new Error("Fragment no longer belongs to source");
        path.unshift(Array.prototype.indexOf.call(parent.children, element));
        element = parent;
      }
      return path;
    };
    return {
      boxes: entries.map(([element, box]) => ({
        path: pathOf(element), tag: element.tagName, box: { ...box },
        depth: this.collapsedStarts.get(element),
      })),
      blocks: this.blocks.map(({ element }) => indices.get(element)!),
    };
  }

  /** Restore geometry only after the caller has checked its layout inputs. */
  restore(snapshot: FragmentSnapshot): boolean {
    const boxes = new Map<FragmentElement, Box>();
    const collapsedStarts = new WeakMap<FragmentElement, number>();
    const elements: FragmentElement[] = [];
    for (const item of snapshot.boxes) {
      let element: Element = this.source;
      for (const index of item.path) {
        const child = element.children[index];
        if (!child) return false;
        element = child;
      }
      if (!(element instanceof HTMLElement || element instanceof SVGElement)
        || element.tagName !== item.tag || boxes.has(element)) return false;
      elements.push(element);
      boxes.set(element, { ...item.box });
      if (item.depth !== undefined) collapsedStarts.set(element, item.depth);
    }
    const blocks: Block[] = [];
    for (const index of snapshot.blocks) {
      const element = elements[index];
      const box = boxes.get(element);
      const parent = element?.parentElement;
      if (!element || !box || !parent) return false;
      blocks.push({ ...box, element, parent, bottom: box.top + box.height });
    }
    this.boxes = boxes;
    this.collapsedStarts = collapsedStarts;
    this.blocks = blocks;
    let bottom = -Infinity;
    this.bottomBounds = blocks.map((block) => (bottom = Math.max(bottom, block.bottom)));
    this.details = new WeakMap(Array.from(this.source.querySelectorAll<HTMLDetailsElement>("details"),
      (details, i) => [details, i]));
    this.revision++;
    return true;
  }

}
