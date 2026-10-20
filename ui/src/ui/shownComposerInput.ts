/**
 * The message box the reader sees. Retained sessions keep their hidden composers
 * in the document, so the first `[data-composer-input]` can belong to one of them.
 */
export function shownComposerInput(root: ParentNode = document): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>("[data-composer-input]")].find(input => input.checkVisibility());
}
