/**
 * Forks inherit their parent's name, so a busy workspace shows the same title
 * a dozen times in a row. Collapse each subtree under its root by default and
 * let the row carry the fork count instead of the list carrying the repetition.
 */
export interface DepthRow {
  readonly id: string;
  readonly depth: number;
}

export interface ForkGroupedRow<Row extends DepthRow> {
  readonly row: Row;
  /** Rows nested anywhere beneath this one, collapsed or not. */
  readonly descendantCount: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export interface ForkGroupingOptions {
  readonly expandedIds: ReadonlySet<string>;
  /** Row that must stay on screen — its ancestors expand no matter what. */
  readonly revealId?: string | undefined;
}

/** Ancestors of `id`, derived from pre-order rows: the nearest shallower row before it. */
export function sessionAncestorIds(rows: readonly DepthRow[], id: string): ReadonlySet<string> {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return new Set();
  const ancestors = new Set<string>();
  let depth = rows[index]?.depth ?? 0;
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (candidate === undefined || candidate.depth >= depth) continue;
    ancestors.add(candidate.id);
    depth = candidate.depth;
  }
  return ancestors;
}

export function descendantCounts(rows: readonly DepthRow[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    let count = 0;
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      const candidate = rows[cursor];
      if (candidate === undefined || candidate.depth <= row.depth) break;
      count += 1;
    }
    counts.set(row.id, count);
  }
  return counts;
}

export function forkGroupedRows<Row extends DepthRow>(
  rows: readonly Row[],
  options: ForkGroupingOptions,
): ForkGroupedRow<Row>[] {
  const counts = descendantCounts(rows);
  const revealed = options.revealId === undefined ? new Set<string>() : sessionAncestorIds(rows, options.revealId);
  const grouped: ForkGroupedRow<Row>[] = [];
  /** Depth of the shallowest collapsed ancestor; rows deeper than it are hidden. */
  let collapsedAtDepth: number | undefined;

  for (const row of rows) {
    if (collapsedAtDepth !== undefined && row.depth > collapsedAtDepth) continue;
    collapsedAtDepth = undefined;

    const descendantCount = counts.get(row.id) ?? 0;
    const expandable = descendantCount > 0;
    const expanded = expandable && (options.expandedIds.has(row.id) || revealed.has(row.id));
    if (expandable && !expanded) collapsedAtDepth = row.depth;
    grouped.push({ row, descendantCount, expandable, expanded });
  }

  return grouped;
}

export function toggleExpandedSessionId(expandedIds: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(expandedIds);
  if (!next.delete(id)) next.add(id);
  return next;
}
