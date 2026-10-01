import type { Unstable_DirectiveFormatter, Unstable_TriggerMatcher } from "@assistant-ui/react";

export type MentionTrigger = "@" | "@ " | "!@" | "#";

/** Preserve Forgerie's quoted paths and all-file prefixes, not assistant-ui's :file[] syntax. */
export const mentionMatcher: Unstable_TriggerMatcher = (text, char, cursor) => {
  const before = text.slice(0, cursor);
  for (let offset = before.length - char.length; offset >= 0; offset--) {
    if (!before.startsWith(char, offset) || offset > 0 && !/\s/.test(before[offset - 1]!)) continue;
    let query = before.slice(offset + char.length);
    if (char === "#") return /\s/.test(query) ? null : { query, offset, endOffset: cursor };
    const all = char !== "@" || query.startsWith(" ");
    const spacePrefix = char === "@" && query.startsWith(" ");
    if (spacePrefix) query = query.slice(1);
    const quoted = query.startsWith('"');
    if (quoted) query = query.slice(1);
    if (query.includes('"') || query.includes("\n") || !all && !quoted && /\s/.test(query)) continue;
    // One @ trigger owns both scopes; a leading query space carries the
    // all-file scope to the adapter without registering colliding triggers.
    return { query: spacePrefix ? ` ${query}` : query, offset, endOffset: cursor };
  }
  return null;
};

export function fileReference(path: string, prefix: string = "@") {
  return `${prefix}${/\s/.test(path) ? `"${path}"` : path}`;
}

export function mentionFormatter(trigger: MentionTrigger): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => trigger === "#" ? `#${item.id}`
      : fileReference(item.id, item.id.endsWith("/") ? trigger : "@"),
    // The textarea and transcript keep the existing editable reference syntax.
    parse: (text) => [{ kind: "text", text }],
  };
}

/** Pure window-level placement. The list scrolls; no posture changes its structure. */
export function mentionPlacement(anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { left: number; top: number; width: number; height: number }) {
  const gap = 8;
  const width = Math.min(anchor.width, Math.max(0, viewport.width - 2 * gap));
  const left = Math.max(viewport.left + gap, Math.min(anchor.left, viewport.left + viewport.width - width - gap));
  const above = Math.max(0, anchor.top - viewport.top - 2 * gap);
  const below = Math.max(0, viewport.top + viewport.height - anchor.bottom - 2 * gap);
  const up = above >= below;
  const maxHeight = Math.min(288, up ? above : below);
  return { left, width, maxHeight, top: up ? anchor.top - gap : anchor.bottom + gap, up };
}
