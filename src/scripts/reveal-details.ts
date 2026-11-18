// Reveal the destination before the reader measures or focuses it.
export function revealDetails(target: HTMLElement, root: Element | null) {
  for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && parent.querySelector(":scope > summary") !== target) {
      parent.open = true;
    }
  }
}
