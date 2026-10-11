/** The nearest ancestor that scrolls vertically and has more than it shows, such as a thread. */
export function scrollParent(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return undefined;
}
