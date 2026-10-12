export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function splitFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return { frontMatter: null, body: text };
  const remaining = text.slice(opening[0].length);
  const closing = /^---(?:\r?\n|$)/m.exec(remaining);
  if (!closing) return { frontMatter: null, body: text };
  const end = opening[0].length + closing.index + closing[0].length;
  return { frontMatter: text.slice(0, end), body: text.slice(end) };
}

export function joinFrontMatter(parts: { frontMatter: string | null; body: string }): string {
  const { frontMatter, body } = parts;
  if (frontMatter === null) return body;
  // A closing delimiter at EOF needs a separator only when a body is added.
  // Keeping the original frame intact lets undo restore its exact bytes.
  const separator = body !== "" && !/[\r\n]$/.test(frontMatter)
    ? (frontMatter.includes("\r\n") ? "\r\n" : "\n")
    : "";
  return frontMatter + separator + body;
}

/**
 * Like framePromptBody, restore the body's frame after serialization, but keep
 * its exact ending instead of imposing one newline. Internal whitespace stays
 * untouched. For whitespace-only bodies, the leading and trailing runs must
 * not overlap, or framing would duplicate bytes.
 */
export function frameMarkdownBody(original: string, markdown: string): string {
  const leading = /^(?:\r\n|\n|\r)*/.exec(original)?.[0] ?? "";
  const trailing = /\s*$/.exec(original.slice(leading.length))?.[0] ?? "";
  return leading + markdown.replace(/^(?:\r\n|\n|\r)+/, "").replace(/\s+$/, "") + trailing;
}
