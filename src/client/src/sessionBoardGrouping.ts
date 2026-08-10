/**
 * Collapse delegated children under the session that spawned them.
 *
 * `pi-subagents` creates a real top-level session per delegated agent, so a
 * single fan-out can put dozens of identically-titled rows in the inbox. A
 * delegated child cannot be recognised from its own file — its header is
 * indistinguishable from a manual fork — so the only usable signal is the
 * `parentSession` link, which manual forks no longer carry once they are
 * detached at creation.
 *
 * Two shapes therefore need collapsing:
 *
 *   - children whose parent is present in the same group, and
 *   - children whose parent file has been deleted, which `sessionTreeModel`
 *     would otherwise promote to roots. Those group under a placeholder keyed
 *     by the parent path they still record.
 */
import { forkGroupedRows, type DepthRow } from "./sessionForkGrouping";
import type { SessionBoardRow, SessionBoardSessionInput } from "./sessionBoard";

/** Prefix for synthetic rows so a placeholder id can never collide with a session id. */
const PLACEHOLDER_PREFIX = "deleted-parent:";

export type GroupedInboxEntry<S extends SessionBoardSessionInput> =
  | {
    readonly kind: "session";
    readonly row: SessionBoardRow<S>;
    readonly depth: number;
    readonly descendantCount: number;
    readonly expandable: boolean;
    readonly expanded: boolean;
  }
  | {
    readonly kind: "deleted-parent";
    readonly id: string;
    /** Parent session file the children still record, for debugging and titles. */
    readonly parentPath: string;
    readonly descendantCount: number;
    readonly expanded: boolean;
  };

export interface InboxGroupingOptions {
  readonly expandedIds: ReadonlySet<string>;
  /** Row that must stay visible — its ancestors expand regardless of collapse state. */
  readonly revealId?: string | undefined;
}

export function placeholderIdForParent(parentPath: string): string {
  return `${PLACEHOLDER_PREFIX}${parentPath}`;
}

export function isPlaceholderId(id: string): boolean {
  return id.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Order rows as a pre-order tree and collapse each subtree under its root.
 *
 * Rows are grouped within the list they arrive in — callers pass one board
 * group at a time — because a delegated child runs headless and cannot reach a
 * different state group than its parent by asking the user something.
 */
export function groupedInboxEntries<S extends SessionBoardSessionInput>(
  rows: readonly SessionBoardRow<S>[],
  options: InboxGroupingOptions,
): GroupedInboxEntry<S>[] {
  const byPath = new Map<string, SessionBoardRow<S>>();
  for (const row of rows) {
    const path = row.session.path;
    if (path !== undefined && path !== "") byPath.set(path, row);
  }

  const childrenByParentId = new Map<string, SessionBoardRow<S>[]>();
  const orphansByParentPath = new Map<string, SessionBoardRow<S>[]>();
  const roots: SessionBoardRow<S>[] = [];

  for (const row of rows) {
    const parentPath = row.session.parentSessionPath;
    if (parentPath === undefined || parentPath === "") {
      roots.push(row);
      continue;
    }
    const parent = byPath.get(parentPath);
    if (parent === undefined) {
      pushInto(orphansByParentPath, parentPath, row);
      continue;
    }
    // A row that is its own parent, or part of a cycle, would otherwise vanish
    // from the list entirely. Treat it as a root instead of losing it.
    if (parent.session.id === row.session.id || formsCycle(row, byPath)) {
      roots.push(row);
      continue;
    }
    pushInto(childrenByParentId, parent.session.id, row);
  }

  const ordered: { row: SessionBoardRow<S> | undefined; id: string; depth: number; parentPath?: string }[] = [];

  for (const root of roots) {
    appendSubtree(root, 0, childrenByParentId, ordered);
  }
  for (const [parentPath, orphans] of orphansByParentPath) {
    ordered.push({ row: undefined, id: placeholderIdForParent(parentPath), depth: 0, parentPath });
    for (const orphan of orphans) {
      appendSubtree(orphan, 1, childrenByParentId, ordered);
    }
  }

  const depthRows: DepthRow[] = ordered.map((entry) => ({ id: entry.id, depth: entry.depth }));
  const grouped = forkGroupedRows(depthRows, options);
  const byId = new Map(ordered.map((entry) => [entry.id, entry]));

  const entries: GroupedInboxEntry<S>[] = [];
  for (const item of grouped) {
    const source = byId.get(item.row.id);
    if (source === undefined) continue;
    if (source.row === undefined) {
      entries.push({
        kind: "deleted-parent",
        id: source.id,
        parentPath: source.parentPath ?? "",
        descendantCount: item.descendantCount,
        expanded: item.expanded,
      });
      continue;
    }
    entries.push({
      kind: "session",
      row: source.row,
      depth: source.depth,
      descendantCount: item.descendantCount,
      expandable: item.expandable,
      expanded: item.expanded,
    });
  }
  return entries;
}

function appendSubtree<S extends SessionBoardSessionInput>(
  row: SessionBoardRow<S>,
  depth: number,
  childrenByParentId: ReadonlyMap<string, SessionBoardRow<S>[]>,
  out: { row: SessionBoardRow<S> | undefined; id: string; depth: number; parentPath?: string }[],
): void {
  out.push({ row, id: row.session.id, depth });
  for (const child of childrenByParentId.get(row.session.id) ?? []) {
    appendSubtree(child, depth + 1, childrenByParentId, out);
  }
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/** Walk parent links upward; a repeat means the chain loops back on itself. */
function formsCycle<S extends SessionBoardSessionInput>(
  start: SessionBoardRow<S>,
  byPath: ReadonlyMap<string, SessionBoardRow<S>>,
): boolean {
  const seen = new Set<string>([start.session.id]);
  let cursor = start;
  for (;;) {
    const parentPath = cursor.session.parentSessionPath;
    if (parentPath === undefined || parentPath === "") return false;
    const parent = byPath.get(parentPath);
    if (parent === undefined) return false;
    if (seen.has(parent.session.id)) return true;
    seen.add(parent.session.id);
    cursor = parent;
  }
}
