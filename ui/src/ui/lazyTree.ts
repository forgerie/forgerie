import type { StepRow } from "./treeKeys";

/** One entry of a folder. A link may point at a file or a folder; it opens as a file. */
export interface FolderEntry { name: string; path: string; type: "folder" | "file" | "link" }
/** A folder's entries, and whether the lister stopped before the end. */
export interface Folder { entries: FolderEntry[]; truncated: boolean }

/** One folder's listing as the tree holds it. The root folder is "". */
export type FolderLoad = { type: "loading" } | { type: "ready"; folder: Folder } | { type: "failed"; message: string };

/**
 * A row of a tree whose folders are listed as they open. A note row stands
 * in an open folder for what the folder cannot show yet: its listing on the
 * way, a failed read, no entries, or entries past the lister's limit.
 */
export type FolderRow =
  | { type: "folder"; key: string; path: string; name: string; level: number; parent: string | undefined }
  | { type: "file"; key: string; path: string; name: string; link: boolean; level: number; parent: string | undefined }
  | { type: "note"; key: string; folder: string; note: "loading" | "failed" | "empty" | "truncated"; message?: string; level: number; parent: string | undefined };

export const folderKey = (path: string) => `folder:${path}`;
export const fileKey = (path: string) => `file:${path}`;

/** The rows the tree draws: the root's entries, and the entries of each open folder under it. */
export function folderRows(folders: ReadonlyMap<string, FolderLoad>, open: ReadonlySet<string>, path = "", level = 1): FolderRow[] {
  const parent = path === "" ? undefined : folderKey(path);
  const load = folders.get(path) ?? { type: "loading" };
  const note = (kind: "loading" | "failed" | "empty" | "truncated", message?: string): FolderRow =>
    ({ type: "note", key: `note:${kind}:${path}`, folder: path, note: kind, ...message === undefined ? {} : { message }, level, parent });
  if (load.type === "loading") return [note("loading")];
  if (load.type === "failed") return [note("failed", load.message)];
  if (load.folder.entries.length === 0) return [note("empty")];
  const rows = load.folder.entries.flatMap((entry): FolderRow[] => entry.type === "folder"
    ? [{ type: "folder", key: folderKey(entry.path), path: entry.path, name: entry.name, level, parent },
      ...open.has(entry.path) ? folderRows(folders, open, entry.path, level + 1) : []]
    : [{ type: "file", key: fileKey(entry.path), path: entry.path, name: entry.name, link: entry.type === "link", level, parent }]);
  return load.folder.truncated ? [...rows, note("truncated")] : rows;
}

/** The folders above a path, outermost first. Showing the file opens them. */
export function foldersOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** What the keyboard needs from each row. A failed listing opens again to read it again. */
export function folderStepRows(rows: readonly FolderRow[], open: ReadonlySet<string>): StepRow[] {
  return rows.map((row) => ({
    key: row.key, parent: row.parent, folder: row.type === "folder", open: row.type === "folder" && open.has(row.path),
    openable: row.type === "file" || row.type === "note" && row.note === "failed",
  }));
}
