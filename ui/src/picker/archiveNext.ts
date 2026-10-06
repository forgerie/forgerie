// "Archive and next": which session comes next, and whether the open one can be archived.
// Pure. The queue matches the Lit client's triageQueue (sessionBoard.ts on main):
// only sessions that want the reader. A working session does not, yet.
import type { Row, RowState } from "./board";
import { rowCommands } from "./commands";

const WAITING: readonly RowState[] = ["blocked", "errored", "unread"];

/** The first session that wants the reader, other than `archivedId`. Undefined when nothing waits. */
export function nextWaiting(all: readonly Row[], archivedId: string): Row | undefined {
  return all
    .filter((row) => row.session.id !== archivedId && WAITING.includes(row.state))
    .sort((a, b) => WAITING.indexOf(a.state) - WAITING.indexOf(b.state)
      || Number(b.session.pinned === true) - Number(a.session.pinned === true)
      || Date.parse(b.session.modified) - Date.parse(a.session.modified))[0];
}

export type ArchiveAvailability = { type: "ready" } | { type: "blocked"; reason: string };

/** Reads the row menu, so the button and the menu can never disagree about an archive. */
export function archiveAvailability(row: Row | undefined): ArchiveAvailability {
  if (!row) return { type: "blocked", reason: "Loading sessions" };
  if (row.state === "archived") return { type: "blocked", reason: "Already archived" };
  const archive = rowCommands(row).find((command) => command.kind === "archive");
  if (!archive) return { type: "blocked", reason: "Unpin to archive" };
  return archive.disabled ? { type: "blocked", reason: archive.disabled } : { type: "ready" };
}
