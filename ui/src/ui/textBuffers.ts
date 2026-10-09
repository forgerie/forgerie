/** Why a file opens without an editor: saving it back would change bytes the reader never touched. */
export type LockReason = "binary" | "large" | "encoding";
/** A file as read: its text and the version a save must match, or the reason it cannot be edited. */
export type OpenedFile =
  | { type: "text"; path: string; text: string; version: string }
  | { type: "locked"; path: string; reason: LockReason; size: number };
/** What the disk must still hold for a write to go ahead: the version that was read, or no file at all. */
export type Expected = { type: "version"; version: string } | { type: "absent" };
export type SaveResult = { type: "saved"; version: string } | { type: "conflict"; version: string | undefined };

/**
 * Where the last save of a buffer stands. `saved` lasts until the next
 * keystroke. A conflict names what the disk holds now, absent when the file
 * is gone.
 */
export type SaveState =
  | { type: "idle" }
  | { type: "saved" }
  | { type: "saving"; text: string }
  | { type: "conflict"; version: string | undefined }
  | { type: "failed"; message: string };

/**
 * One file as the editor holds it. `base` is the text on disk when it was
 * read or last saved; `text` is what the reader sees. Both use "\n" between
 * lines, as the editor does; `separator` is what the disk uses. `opened`
 * counts reads, so a reload gives the editor a new document.
 */
export type FileBuffer =
  | { type: "loading" }
  | { type: "failed"; message: string }
  | { type: "locked"; reason: LockReason; size: number }
  | { type: "open"; base: string; text: string; version: string; separator: "\n" | "\r\n"; opened: number; save: SaveState };

export const isDirty = (buffer: FileBuffer | undefined): boolean => buffer?.type === "open" && buffer.text !== buffer.base;

/** The paths whose buffers hold edits the disk does not have yet. */
export const dirtyPaths = (buffers: Readonly<Record<string, FileBuffer>>): string[] =>
  Object.keys(buffers).filter((path) => isDirty(buffers[path])).sort((a, b) => a.localeCompare(b));

/** A read arrived. It replaces what the buffer held, edits included: a reader asks for a read only to start over. */
export function opened(previous: FileBuffer | undefined, file: OpenedFile): FileBuffer {
  if (file.type === "locked") return { type: "locked", reason: file.reason, size: file.size };
  // A file with any CRLF is saved with CRLF throughout, as an editor set to the file's own line ending does.
  const separator = file.text.includes("\r\n") ? "\r\n" : "\n";
  const text = file.text.replace(/\r\n?/gu, "\n");
  return { type: "open", base: text, text, version: file.version, separator, opened: (previous?.type === "open" ? previous.opened : 0) + 1, save: { type: "idle" } };
}

/** The reader typed. A failed save stays on screen until the next save, so the reader still knows the disk lacks the edit. */
export function edited(buffer: FileBuffer, text: string): FileBuffer {
  if (buffer.type !== "open" || text === buffer.text) return buffer;
  return { ...buffer, text, save: buffer.save.type === "saved" ? { type: "idle" } : buffer.save };
}

/** The text a save sends, with the file's own line ending, and what the disk must still hold. Nothing when no save may start. */
export function savePlan(buffer: FileBuffer | undefined, force = false): { text: string; disk: string; expected: Expected } | undefined {
  if (buffer?.type !== "open" || buffer.save.type === "saving") return undefined;
  const conflict = buffer.save.type === "conflict" ? buffer.save : undefined;
  // A conflict waits for the reader to choose; overwriting is that choice.
  if (conflict && !force) return undefined;
  if (!conflict && buffer.text === buffer.base) return undefined;
  const expected: Expected = conflict
    ? conflict.version === undefined ? { type: "absent" } : { type: "version", version: conflict.version }
    : { type: "version", version: buffer.version };
  return { text: buffer.text, disk: buffer.separator === "\n" ? buffer.text : buffer.text.replaceAll("\n", buffer.separator), expected };
}

export function saving(buffer: FileBuffer, text: string): FileBuffer {
  return buffer.type === "open" ? { ...buffer, save: { type: "saving", text } } : buffer;
}

/** A save finished. Text typed while it was on the way stays as an edit the disk lacks. */
export function settled(buffer: FileBuffer, outcome: SaveResult | { type: "failed"; message: string }): FileBuffer {
  if (buffer.type !== "open" || buffer.save.type !== "saving") return buffer;
  if (outcome.type === "saved") {
    const caughtUp = buffer.text === buffer.save.text;
    return { ...buffer, base: buffer.save.text, version: outcome.version, save: caughtUp ? { type: "saved" } : { type: "idle" } };
  }
  if (outcome.type === "conflict") return { ...buffer, save: { type: "conflict", version: outcome.version } };
  return { ...buffer, save: { type: "failed", message: outcome.message } };
}
