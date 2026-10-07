import { z } from "zod";
import { isCommand } from "../commands";
import { shellDraftOf } from "../shellDraft";
import { isCodeRow, type CodeRow, type DiffRow } from "./unifiedDiff";

/**
 * A note on selected diff lines that goes to the agent with the next message.
 * The server's prompt contract (`diffAnnotations` on `POST .../prompt`) sets
 * these bounds, and the server checks them again. Checking here first keeps a
 * note the server would refuse from ever reaching the tray.
 */
export const NOTE_LIMITS = {
  notes: 16,
  linesPerNote: 200,
  pathChars: 1024,
  commentChars: 4096,
  lineChars: 4096,
  totalChars: 64 * 1024,
} as const;

const lineNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const lineText = z.string().max(NOTE_LIMITS.lineChars).regex(/^[^\n\r\0]*$/u);
const noteLineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("context"), oldLineNumber: lineNumber, newLineNumber: lineNumber, text: lineText }).strict(),
  z.object({ kind: z.literal("add"), newLineNumber: lineNumber, text: lineText }).strict(),
  z.object({ kind: z.literal("remove"), oldLineNumber: lineNumber, text: lineText }).strict(),
]);
// Relative, slash-separated, no "." or ".." segment, no control character, backslash, or drive prefix.
// eslint-disable-next-line no-control-regex -- The server refuses control characters in paths, so the browser must find them.
const PATH = /^(?![A-Za-z]:)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^/\\\u0000-\u001f\u007f]+(?:\/[^/\\\u0000-\u001f\u007f]+)*$/u;
export const diffNoteSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).max(NOTE_LIMITS.pathChars).regex(PATH),
  staged: z.boolean(),
  comment: z.string().min(1).max(NOTE_LIMITS.commentChars).regex(/\S/u),
  lines: z.array(noteLineSchema).min(1).max(NOTE_LIMITS.linesPerNote),
});
export type NoteLine = z.infer<typeof noteLineSchema>;
export type DiffNote = z.infer<typeof diffNoteSchema>;
/** The wire shape: a note without the browser's own id. */
export type PromptDiffAnnotation = Omit<DiffNote, "id">;

/** Two rows in one file: where the reader first tapped, and where the range ends now. */
export interface RowSelection { anchor: number; focus: number }

/** Tap a row: start a selection, stretch it to this row, or clear a one-row selection on its own row. */
export function tapRow(selection: RowSelection | undefined, index: number): RowSelection | undefined {
  if (!selection) return { anchor: index, focus: index };
  if (selection.anchor === index && selection.focus === index) return undefined;
  return { anchor: selection.anchor, focus: index };
}
export const selectionBounds = (selection: RowSelection): [number, number] =>
  [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)];

/** The code rows a selection covers, in diff order. Headers inside the range are skipped. */
export function linesOf(rows: readonly DiffRow[], selection: RowSelection): NoteLine[] {
  const [from, to] = selectionBounds(selection);
  return rows.slice(from, to + 1).filter(isCodeRow).map(lineOf);
}
function lineOf(row: CodeRow): NoteLine {
  // Copy only the contract's fields, so a richer row never reaches the server.
  if (row.kind === "context") return { kind: "context", oldLineNumber: row.oldLineNumber, newLineNumber: row.newLineNumber, text: row.text };
  if (row.kind === "add") return { kind: "add", newLineNumber: row.newLineNumber, text: row.text };
  return { kind: "remove", oldLineNumber: row.oldLineNumber, text: row.text };
}

/** Why these lines cannot carry a note, or nothing when they can. */
export function selectionProblem(path: string, lines: readonly NoteLine[]): string | undefined {
  if (!PATH.test(path) || path.length > NOTE_LIMITS.pathChars) return "This file's path cannot go in a note.";
  if (lines.length === 0) return "Select a code line, not a header.";
  if (lines.length > NOTE_LIMITS.linesPerNote) return `Select at most ${NOTE_LIMITS.linesPerNote} lines. This selection has ${lines.length}.`;
  if (lines.some((line) => !lineText.safeParse(line.text).success)) return `A selected line is longer than ${NOTE_LIMITS.lineChars} characters.`;
  return undefined;
}
export function commentProblem(comment: string): string | undefined {
  if (comment.trim() === "") return "Write what the agent should do with these lines.";
  if (comment.length > NOTE_LIMITS.commentChars) return `Keep the note under ${NOTE_LIMITS.commentChars} characters.`;
  return undefined;
}
const sizeOf = (note: Pick<DiffNote, "path" | "comment" | "lines">) =>
  note.path.length + note.comment.length + note.lines.reduce((total, line) => total + line.text.length, 0);
/** Why the tray cannot take `note`, or nothing when it can. `replacing` is the note an edit replaces. */
export function trayProblem(notes: readonly DiffNote[], note: Pick<DiffNote, "path" | "comment" | "lines">, replacing?: string): string | undefined {
  const others = notes.filter((item) => item.id !== replacing);
  if (others.length >= NOTE_LIMITS.notes) return `One message carries at most ${NOTE_LIMITS.notes} notes. Send these first.`;
  const total = others.reduce((sum, item) => sum + sizeOf(item), 0) + sizeOf(note);
  if (total > NOTE_LIMITS.totalChars) return "These notes are too long for one message. Send the others first, or select fewer lines.";
  return undefined;
}

/** The request field. Undefined when there is nothing to send, so an ordinary prompt stays unchanged. */
export function annotationsOf(notes: readonly DiffNote[]): PromptDiffAnnotation[] | undefined {
  if (notes.length === 0) return undefined;
  return notes.map(({ path, staged, comment, lines }) => ({ path, staged, comment, lines: lines.map((line) => ({ ...line })) }));
}

/**
 * Notes travel with chat messages only. A slash command or a `!` command goes
 * through other endpoints, so the notes wait for the next message.
 */
export function carriesNotes(text: string): boolean {
  return shellDraftOf(text).type === "chat" && !isCommand(text);
}

/** "12", "12–18", or "old 4–6" for removed lines only. */
export function noteRange(lines: readonly NoteLine[]): string {
  const newSide = lines.flatMap((line) => "newLineNumber" in line ? [line.newLineNumber] : []);
  const side = newSide.length > 0 ? newSide : lines.flatMap((line) => "oldLineNumber" in line ? [line.oldLineNumber] : []);
  const first = side[0];
  const last = side.at(-1);
  if (first === undefined || last === undefined) return "";
  const span = first === last ? `${first}` : `${first}–${last}`;
  return newSide.length > 0 ? span : `old ${span}`;
}
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A browser-local id. `crypto.randomUUID` needs a secure context, which a Tailscale address over HTTP is not. */
export function newNoteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Where a file's notes sit in its current diff. */
export interface NotePlacement {
  /** Notes drawn under the row at this index: the note's last line. */
  ends: Map<number, DiffNote[]>;
  /** Rows some note covers, headers between its lines included. */
  covered: Set<number>;
  /** Notes whose lines this diff no longer shows. The code changed after the note was written. */
  moved: DiffNote[];
}
export function placeNotes(rows: readonly DiffRow[], notes: readonly DiffNote[]): NotePlacement {
  const ends = new Map<number, DiffNote[]>();
  const covered = new Set<number>();
  const moved: DiffNote[] = [];
  const lines = rows.map(rowLine);
  for (const note of notes) {
    const first = note.lines[0];
    const last = note.lines.at(-1);
    const start = first ? lines.findIndex((line) => line !== undefined && sameLine(line, first)) : -1;
    const end = last && start >= 0 ? lines.findIndex((line, index) => index >= start && line !== undefined && sameLine(line, last)) : -1;
    if (start < 0 || end < 0) { moved.push(note); continue; }
    for (let index = start; index <= end; index++) covered.add(index);
    ends.set(end, [...ends.get(end) ?? [], note]);
  }
  return { ends, covered, moved };
}

function sameLine(a: NoteLine, b: NoteLine): boolean {
  return a.kind === b.kind && a.text === b.text
    && ("oldLineNumber" in a ? a.oldLineNumber : undefined) === ("oldLineNumber" in b ? b.oldLineNumber : undefined)
    && ("newLineNumber" in a ? a.newLineNumber : undefined) === ("newLineNumber" in b ? b.newLineNumber : undefined);
}
const rowLine = (row: DiffRow): NoteLine | undefined => isCodeRow(row) ? lineOf(row) : undefined;
