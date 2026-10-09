const modifierOrder = ["ctrl", "alt", "shift"] as const;
type ShortcutModifier = typeof modifierOrder[number];

const unsupportedModifierNames = new Set([
  "cmd",
  "command",
  "gui",
  "meta",
  "mod",
  "opt",
  "option",
  "primary",
  "super",
  "win",
  "windows",
]);

export type ShortcutParseResult =
  | { ok: true; shortcut: string; tokens: string[] }
  | { ok: false; message: string };

export type StoredShortcutValueParseResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/** Read pre-Ctrl-only config written by older Forgerie versions. */
function parseStoredShortcut(shortcut: string): ShortcutParseResult {
  return parseShortcut(shortcut, { allowLegacyMod: true, requireFirstChordActivator: true });
}

export function parseStoredShortcutValue(value: unknown): StoredShortcutValueParseResult {
  if (value === null) return { ok: true, value };
  if (typeof value !== "string" || value === "") return { ok: false, message: "Shortcut values must be non-empty strings or null." };
  const parsed = parseStoredShortcut(value);
  return parsed.ok ? { ok: true, value: parsed.shortcut } : parsed;
}

export function isShortcutSequenceStarter(token: string): boolean {
  const parts = token.split("+");
  return parts.includes("ctrl") || parts.includes("alt");
}

interface ParseShortcutOptions {
  allowLegacyMod: boolean;
  requireFirstChordActivator: boolean;
}

function parseShortcut(shortcut: string, options: ParseShortcutOptions): ShortcutParseResult {
  const cleaned = shortcut.trim().toLowerCase().replace(/\s*\+\s*/gu, "+");
  if (cleaned === "") return { ok: false, message: "Enter a shortcut, choose None, or reset to the default." };

  const tokens: string[] = [];
  const chordInputs = cleaned.split(/\s+/u).filter((token) => token !== "");
  for (const [index, chordInput] of chordInputs.entries()) {
    const parsed = parseShortcutChord(chordInput, options.allowLegacyMod);
    if (!parsed.ok) return parsed;
    if (index === 0 && options.requireFirstChordActivator && !isShortcutSequenceStarter(parsed.token)) {
      return { ok: false, message: "Shortcuts must start with Ctrl or Alt." };
    }
    tokens.push(parsed.token);
  }

  return { ok: true, shortcut: tokens.join(" "), tokens };
}

type ShortcutChordParseResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

function parseShortcutChord(chord: string, allowLegacyMod: boolean): ShortcutChordParseResult {
  const parts = chord.split("+").filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, message: "Shortcut chords must include a key." };

  const modifiers = new Set<ShortcutModifier>();
  let key: string | undefined;
  for (const part of parts) {
    const modifier = modifierAlias(part, allowLegacyMod);
    if (modifier !== undefined) {
      if (modifiers.has(modifier)) return { ok: false, message: `Shortcut has duplicate ${formatShortcutPart(modifier)} modifiers.` };
      modifiers.add(modifier);
      continue;
    }
    if (unsupportedModifierNames.has(part)) return { ok: false, message: "Only Ctrl, Alt, and Shift modifiers are supported." };

    const normalizedKey = normalizeShortcutKeyName(part);
    if (normalizedKey === undefined) return { ok: false, message: `Unsupported shortcut key: ${part}` };
    if (key !== undefined) return { ok: false, message: "Each shortcut chord can include only one non-modifier key." };
    key = normalizedKey;
  }

  if (key === undefined) return { ok: false, message: "Shortcut chords must include a key." };

  const orderedModifiers = modifierOrder.filter((modifier) => modifiers.has(modifier));
  return { ok: true, token: [...orderedModifiers, key].join("+") };
}

function modifierAlias(part: string, allowLegacyMod: boolean): ShortcutModifier | undefined {
  switch (part) {
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
      return "alt";
    case "shift":
      return "shift";
    case "mod":
      return allowLegacyMod ? "ctrl" : undefined;
    default:
      return undefined;
  }
}

function normalizeShortcutKeyName(key: string): string | undefined {
  const alias = keyAlias(key);
  if (alias !== undefined) return alias;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(key)) return key;
  if (key.length === 1) return key;
  return undefined;
}


function keyAlias(key: string): string | undefined {
  switch (key) {
    case " ":
    case "spacebar":
    case "space":
      return "space";
    case "esc":
    case "escape":
      return "escape";
    case "return":
    case "enter":
      return "enter";
    case "del":
    case "delete":
      return "delete";
    case "backspace":
      return "backspace";
    case "tab":
      return "tab";
    case "up":
    case "arrowup":
      return "arrowup";
    case "down":
    case "arrowdown":
      return "arrowdown";
    case "left":
    case "arrowleft":
      return "arrowleft";
    case "right":
    case "arrowright":
      return "arrowright";
    case "pageup":
    case "pagedown":
    case "home":
    case "end":
      return key;
    case "+":
    case "plus":
      return "plus";
    case "period":
    case "dot":
      return ".";
    case "comma":
      return ",";
    case "slash":
      return "/";
    case "backslash":
      return "\\";
    case "minus":
      return "-";
    default:
      return undefined;
  }
}

function formatShortcutPart(part: string): string {
  if (part === "ctrl") return "Ctrl";
  if (part === "shift") return "Shift";
  if (part === "alt") return "Alt";
  if (part === "enter") return "Enter";
  if (part === "escape") return "Esc";
  if (part === "space") return "Space";
  if (part === "tab") return "Tab";
  if (part === "backspace") return "Backspace";
  if (part === "delete") return "Delete";
  if (part === "arrowup") return "↑";
  if (part === "arrowdown") return "↓";
  if (part === "arrowleft") return "←";
  if (part === "arrowright") return "→";
  if (part === "pageup") return "PageUp";
  if (part === "pagedown") return "PageDown";
  if (part === "home") return "Home";
  if (part === "end") return "End";
  if (part === "plus") return "+";
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(part)) return part.toUpperCase();
  return part.length === 1 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}
