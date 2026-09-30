// Which commands a row offers. Pure: the menu draws this list and nothing else.
// Menus per state follow the approved sheet (prototypes/session-picker-states,
// "row menu" frames) and the server's refusals in piSessionService.ts.
import type { Row } from "./board";

export type RowCommandKind = "pin" | "unpin" | "archive" | "restore" | "delete" | "copyPath";
export interface RowCommand {
  kind: RowCommandKind;
  label: string;
  /** Why the command cannot run now. A disabled command stays in the menu, so it is never a mystery where it went. */
  disabled?: string;
  /** Asks twice before it runs. */
  danger?: boolean;
  /** Key that runs it on the selected row without the menu. */
  key?: string;
}

/**
 * - Archived: restore, or delete for good. The server refuses a pin until restore.
 * - Pinned: unpin only. The server refuses to archive a pinned session.
 * - Otherwise: pin, or archive. Archive is shown disabled while the session
 *   runs, because the server refuses it; the old client's "Archive anyway?"
 *   confirm could only end in that error.
 * Copy workspace path is on every row.
 */
export function rowCommands(row: Row): RowCommand[] {
  const copy: RowCommand = { kind: "copyPath", label: "Copy workspace path" };
  if (row.state === "archived") {
    return [{ kind: "restore", label: "Restore" }, { kind: "delete", label: "Delete permanently", danger: true }, copy];
  }
  if (row.session.pinned === true) return [{ kind: "unpin", label: "Unpin" }, copy];
  return [
    { kind: "pin", label: "Pin to top" },
    { kind: "archive", label: "Archive", key: "E", ...(row.busy ? { disabled: "Stop the run first" } : {}) },
    copy,
  ];
}

/** The command a key runs on the selected row, if the row offers it and it can run. */
export function commandForKey(row: Row, key: string): RowCommand | undefined {
  const command = rowCommands(row).find((candidate) => candidate.key?.toLowerCase() === key.toLowerCase());
  return command && command.disabled === undefined ? command : undefined;
}
