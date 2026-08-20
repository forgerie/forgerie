/**
 * The leading slash-command token of a piece of text.
 *
 * Mirrors the send seam exactly: a draft whose trimmed text starts with "/"
 * is delivered as a command, and the command token runs to the first
 * whitespace. The mark renders whatever the product would actually run — no
 * allowlist here, or the mark would drift from the behavior it annotates.
 */
export interface LeadingSlashCommand {
  /** The command name without its sigil, e.g. "tree". */
  readonly name: string;
  /** Everything after the token, leading whitespace dropped (often ""). */
  readonly rest: string;
}

export function leadingSlashCommand(text: string): LeadingSlashCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const boundary = trimmed.search(/\s/u);
  const name = (boundary === -1 ? trimmed : trimmed.slice(0, boundary)).slice(1);
  // A bare sigil is a trigger still waiting for its command, not a command.
  if (name === "") return undefined;
  return { name, rest: boundary === -1 ? "" : trimmed.slice(boundary).trimStart() };
}
