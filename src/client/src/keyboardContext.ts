import { isKeyboardShortcutContext, type KeyboardShortcutContext } from "../../shared/shortcutContexts";

const KEYBOARD_SHORTCUT_CONTEXT_ATTRIBUTE = "data-keyboard-shortcut-context";

/**
 * Which part of Forgerie owns a keyboard event.
 *
 * Components can declare an owner on a shadow host. The composed path keeps
 * that declaration visible to the capture-phase application listener.
 */
export function keyboardShortcutContextForEvent(event: KeyboardEvent): KeyboardShortcutContext {
  const path = event.composedPath();
  const declared = path.flatMap((target) => {
    if (!(target instanceof HTMLElement)) return [];
    const value = target.getAttribute(KEYBOARD_SHORTCUT_CONTEXT_ATTRIBUTE);
    return isKeyboardShortcutContext(value) ? [value] : [];
  });
  if (declared.includes("terminal")) return "terminal";
  if (declared.includes("composer")) return "composer";
  if (declared.includes("text-entry")) return "text-entry";
  return path.some(isEditableTarget) ? "text-entry" : "workbench";
}

/**
 * Whether a keyboard event originates from somewhere the user is typing.
 *
 * Single-key shortcuts must never fire while a composer, filename field, or
 * code editor has the key. The check walks the composed path across shadows.
 */
export function isKeyEventInEditableContext(event: KeyboardEvent): boolean {
  return event.composedPath().some(isEditableTarget);
}

function isEditableTarget(target: EventTarget): boolean {
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.getAttribute("role") === "textbox";
}
