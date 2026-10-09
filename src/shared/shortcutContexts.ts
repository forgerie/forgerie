export const KEYBOARD_SHORTCUT_CONTEXTS = ["workbench", "text-entry", "composer", "terminal"] as const;

export type KeyboardShortcutContext = typeof KEYBOARD_SHORTCUT_CONTEXTS[number];

