import { describe, expect, it } from "vitest";
import { groupedInboxEntries, isPlaceholderId, placeholderIdForParent, type GroupedInboxEntry } from "./sessionBoardGrouping";
import type { SessionBoardRow, SessionBoardSessionInput } from "./sessionBoard";

interface TestSession extends SessionBoardSessionInput {
  readonly id: string;
  readonly modified: string;
}

const NO_EXPANSION = { expandedIds: new Set<string>() };

describe("groupedInboxEntries", () => {
  it("leaves unrelated sessions alone", () => {
    const entries = groupedInboxEntries([row("a"), row("b")], NO_EXPANSION);

    expect(entries.map(describeEntry)).toEqual(["a d0 x0", "b d0 x0"]);
  });

  it("collapses delegated children under the parent that spawned them", () => {
    const entries = groupedInboxEntries(
      [row("parent"), row("c1", "/s/parent.jsonl"), row("c2", "/s/parent.jsonl"), row("c3", "/s/parent.jsonl")],
      NO_EXPANSION,
    );

    expect(entries.map(describeEntry)).toEqual(["parent d0 x3"]);
  });

  it("reveals the children when the parent is expanded", () => {
    const entries = groupedInboxEntries(
      [row("parent"), row("c1", "/s/parent.jsonl"), row("c2", "/s/parent.jsonl")],
      { expandedIds: new Set(["parent"]) },
    );

    expect(entries.map(describeEntry)).toEqual(["parent d0 x2", "c1 d1 x0", "c2 d1 x0"]);
  });

  it("counts grandchildren in the top row's total", () => {
    const entries = groupedInboxEntries(
      [row("parent"), row("child", "/s/parent.jsonl"), row("grandchild", "/s/child.jsonl")],
      NO_EXPANSION,
    );

    expect(entries.map(describeEntry)).toEqual(["parent d0 x2"]);
  });

  it("keeps a childless session unexpandable", () => {
    const [entry] = groupedInboxEntries([row("lonely")], NO_EXPANSION);

    expect(entry).toMatchObject({ kind: "session", expandable: false, descendantCount: 0 });
  });

  describe("when the parent file has been deleted", () => {
    it("collapses the orphans under one placeholder instead of leaving them as roots", () => {
      const orphans = Array.from({ length: 99 }, (_, index) => row(`orphan-${String(index)}`, "/s/gone.jsonl"));

      const entries = groupedInboxEntries(orphans, NO_EXPANSION);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: "deleted-parent",
        parentPath: "/s/gone.jsonl",
        descendantCount: 99,
      });
    });

    it("keeps distinct missing parents apart rather than merging them", () => {
      const entries = groupedInboxEntries(
        [row("a", "/s/gone-1.jsonl"), row("b", "/s/gone-2.jsonl")],
        NO_EXPANSION,
      );

      expect(entries.map((entry) => entry.kind === "deleted-parent" ? entry.parentPath : "?"))
        .toEqual(["/s/gone-1.jsonl", "/s/gone-2.jsonl"]);
    });

    it("groups a single orphan too, so it never masquerades as a root", () => {
      const entries = groupedInboxEntries([row("only", "/s/gone.jsonl")], NO_EXPANSION);

      expect(entries[0]?.kind).toBe("deleted-parent");
    });

    it("reveals the orphans when the placeholder is expanded", () => {
      const entries = groupedInboxEntries(
        [row("a", "/s/gone.jsonl"), row("b", "/s/gone.jsonl")],
        { expandedIds: new Set([placeholderIdForParent("/s/gone.jsonl")]) },
      );

      expect(entries.map(describeEntry)).toEqual(["deleted-parent(/s/gone.jsonl) x2", "a d1 x0", "b d1 x0"]);
    });
  });

  describe("malformed links", () => {
    it("treats an empty parent path as no parent", () => {
      const entries = groupedInboxEntries([row("a", "")], NO_EXPANSION);

      expect(entries.map(describeEntry)).toEqual(["a d0 x0"]);
    });

    it("does not lose a session that points at itself", () => {
      const entries = groupedInboxEntries([row("self", "/s/self.jsonl")], NO_EXPANSION);

      expect(entries.map(describeEntry)).toEqual(["self d0 x0"]);
    });

    it("does not hang or drop rows when parent links form a cycle", () => {
      const entries = groupedInboxEntries(
        [row("a", "/s/b.jsonl"), row("b", "/s/a.jsonl")],
        NO_EXPANSION,
      );

      expect(entries.map(describeEntry)).toEqual(["a d0 x0", "b d0 x0"]);
    });
  });

  it("namespaces placeholder ids so they cannot collide with a session id", () => {
    expect(isPlaceholderId(placeholderIdForParent("/s/gone.jsonl"))).toBe(true);
    expect(isPlaceholderId("gone.jsonl")).toBe(false);
  });
});

function row(id: string, parentSessionPath?: string): SessionBoardRow<TestSession> {
  return {
    session: {
      id,
      modified: "2026-08-10T00:00:00.000Z",
      path: `/s/${id}.jsonl`,
      ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    },
    state: { kind: "open" },
    location: { projectId: "p", projectName: "forgerie", projectPath: "/w" },
  };
}

function describeEntry(entry: GroupedInboxEntry<TestSession>): string {
  if (entry.kind === "deleted-parent") return `deleted-parent(${entry.parentPath}) x${String(entry.descendantCount)}`;
  return `${entry.row.session.id} d${String(entry.depth)} x${String(entry.descendantCount)}`;
}
