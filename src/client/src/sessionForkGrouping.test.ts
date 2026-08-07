import { describe, expect, it } from "vitest";
import {
  descendantCounts,
  forkGroupedRows,
  sessionAncestorIds,
  toggleExpandedSessionId,
  type DepthRow,
} from "./sessionForkGrouping";

/** Mirrors the shape SessionList produces: pre-order rows carrying a depth. */
function rows(...spec: [string, number][]): DepthRow[] {
  return spec.map(([id, depth]) => ({ id, depth }));
}

/** A root with ten forks, the shape that fills the real korri sidebar. */
const forkedRoot = rows(
  ["root", 0],
  ["fork-1", 1],
  ["fork-2", 1],
  ["fork-3", 1],
  ["other-root", 0],
);

const visibleIds = (grouped: { row: DepthRow }[]) => grouped.map((entry) => entry.row.id);

describe("descendantCounts", () => {
  it("counts every nested row, not just direct children", () => {
    const counts = descendantCounts(rows(["a", 0], ["b", 1], ["c", 2], ["d", 1], ["e", 0]));

    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBe(0);
    expect(counts.get("e")).toBe(0);
  });
});

describe("sessionAncestorIds", () => {
  it("walks up through skipped depths", () => {
    expect([...sessionAncestorIds(rows(["a", 0], ["b", 1], ["c", 2]), "c")]).toEqual(["b", "a"]);
  });

  it("returns nothing for a root or an unknown row", () => {
    expect([...sessionAncestorIds(forkedRoot, "root")]).toEqual([]);
    expect([...sessionAncestorIds(forkedRoot, "missing")]).toEqual([]);
  });
});

describe("forkGroupedRows", () => {
  it("hides forks behind their root by default", () => {
    const grouped = forkGroupedRows(forkedRoot, { expandedIds: new Set() });

    expect(visibleIds(grouped)).toEqual(["root", "other-root"]);
    expect(grouped[0]).toMatchObject({ descendantCount: 3, expandable: true, expanded: false });
    expect(grouped[1]).toMatchObject({ descendantCount: 0, expandable: false, expanded: false });
  });

  it("reveals the forks of an expanded root only", () => {
    const grouped = forkGroupedRows(forkedRoot, { expandedIds: new Set(["root"]) });

    expect(visibleIds(grouped)).toEqual(["root", "fork-1", "fork-2", "fork-3", "other-root"]);
  });

  it("keeps the selected fork on screen by expanding its ancestors", () => {
    const deep = rows(["root", 0], ["fork", 1], ["nested", 2], ["sibling", 0]);
    const grouped = forkGroupedRows(deep, { expandedIds: new Set(), revealId: "nested" });

    expect(visibleIds(grouped)).toEqual(["root", "fork", "nested", "sibling"]);
  });

  it("does not expand unrelated branches when revealing a selection", () => {
    const deep = rows(["root", 0], ["fork", 1], ["other-root", 0], ["other-fork", 1]);
    const grouped = forkGroupedRows(deep, { expandedIds: new Set(), revealId: "fork" });

    expect(visibleIds(grouped)).toEqual(["root", "fork", "other-root"]);
  });

  it("collapses a whole subtree, not just its first level", () => {
    const deep = rows(["root", 0], ["fork", 1], ["nested", 2], ["deeper", 3], ["sibling", 0]);
    const grouped = forkGroupedRows(deep, { expandedIds: new Set() });

    expect(visibleIds(grouped)).toEqual(["root", "sibling"]);
  });

  it("stops hiding once the list returns to a shallower row", () => {
    const deep = rows(["root", 0], ["fork", 1], ["nested", 2], ["sibling", 0], ["sibling-fork", 1]);
    const grouped = forkGroupedRows(deep, { expandedIds: new Set(["sibling"]) });

    expect(visibleIds(grouped)).toEqual(["root", "sibling", "sibling-fork"]);
  });

  it("returns an empty grouping for an empty list", () => {
    expect(forkGroupedRows([], { expandedIds: new Set() })).toEqual([]);
  });
});

describe("toggleExpandedSessionId", () => {
  it("adds and removes without mutating the original set", () => {
    const initial: ReadonlySet<string> = new Set(["a"]);
    const added = toggleExpandedSessionId(initial, "b");
    const removed = toggleExpandedSessionId(added, "a");

    expect([...initial]).toEqual(["a"]);
    expect([...added]).toEqual(["a", "b"]);
    expect([...removed]).toEqual(["b"]);
  });
});
