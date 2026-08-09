/**
 * Whether a keyboard event originates from somewhere the user is typing.
 *
 * Single-key shortcuts (archive, board navigation, grouping) must never fire
 * while a composer, filename field, or code editor has the key. The check walks
 * the composed path so it still holds across shadow roots, where `event.target`
 * is retargeted to the host element.
 */
export function isKeyEventInEditableContext(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => {
    if (target instanceof HTMLInputElement) return true;
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return true;
      // CodeMirror editors have role="textbox" or a cm-editor class.
      if (target.getAttribute("role") === "textbox") return true;
    }
    return false;
  });
}
