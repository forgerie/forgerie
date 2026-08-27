export const KEYBOARD_SHORTCUT_CONTEXTS = ["workbench", "text-entry", "composer", "terminal"] as const;

export type KeyboardShortcutContext = typeof KEYBOARD_SHORTCUT_CONTEXTS[number];

export function isKeyboardShortcutContext(value: unknown): value is KeyboardShortcutContext {
  return typeof value === "string" && KEYBOARD_SHORTCUT_CONTEXTS.some((context) => context === value);
}
