import type { SessionInfo } from "./api";
import { normalizeSessionPath } from "./sessionPaths";

/**
 * Sessions can record a parent that is not in this listing — the parent was
 * deleted, or lives in another workspace. They render as roots, so a batch of
 * forks from one unavailable parent repeats the same inherited title.
 *
 * Gather those siblings under a synthetic header instead of nesting them under
 * each other, which would claim a lineage they do not have.
 */
export interface OrphanSessionRow {
  readonly session: SessionInfo;
  readonly depth: number;
  readonly hasMissingParent: boolean;
}

export type SessionListEntry<Row extends OrphanSessionRow> =
  | ({ readonly kind: "session"; readonly id: string } & Row)
  | {
    readonly kind: "orphan-group";
    readonly id: string;
    readonly depth: number;
    readonly parentPath: string;
    readonly members: readonly SessionInfo[];
  };

export const ORPHAN_GROUP_ID_PREFIX = "orphan-group:";

export function orphanGroupId(parentPath: string): string {
  return `${ORPHAN_GROUP_ID_PREFIX}${normalizeSessionPath(parentPath)}`;
}

/**
 * Inserts a group header before each set of two or more orphans that share one
 * missing parent, and nests those orphans one level beneath it. A lone orphan
 * is left exactly as it was: a header would say nothing the row does not.
 */
export function withOrphanGroups<Row extends OrphanSessionRow>(rows: readonly Row[]): SessionListEntry<Row>[] {
  const memberCounts = new Map<string, number>();
  for (const row of rows) {
    const parentPath = groupableParentPath(row);
    if (parentPath === undefined) continue;
    memberCounts.set(parentPath, (memberCounts.get(parentPath) ?? 0) + 1);
  }

  const groupedParents = new Set([...memberCounts].filter(([, count]) => count > 1).map(([path]) => path));
  const membersByParent = new Map<string, SessionInfo[]>();
  for (const row of rows) {
    const parentPath = groupableParentPath(row);
    if (parentPath === undefined || !groupedParents.has(parentPath)) continue;
    const members = membersByParent.get(parentPath) ?? [];
    members.push(row.session);
    membersByParent.set(parentPath, members);
  }

  const emittedGroups = new Set<string>();
  const entries: SessionListEntry<Row>[] = [];
  for (const row of rows) {
    const parentPath = groupableParentPath(row);
    if (parentPath === undefined || !groupedParents.has(parentPath)) {
      entries.push({ kind: "session", id: row.session.id, ...row });
      continue;
    }
    if (!emittedGroups.has(parentPath)) {
      emittedGroups.add(parentPath);
      entries.push({
        kind: "orphan-group",
        id: orphanGroupId(parentPath),
        depth: row.depth,
        parentPath,
        members: membersByParent.get(parentPath) ?? [],
      });
    }
    entries.push({ kind: "session", id: row.session.id, ...row, depth: row.depth + 1 });
  }
  return entries;
}

/** Only a row that is genuinely parentless-in-this-list can join a group. */
function groupableParentPath(row: OrphanSessionRow): string | undefined {
  if (!row.hasMissingParent || row.depth !== 0) return undefined;
  const parentPath = row.session.parentSessionPath;
  return parentPath === undefined ? undefined : normalizeSessionPath(parentPath);
}
