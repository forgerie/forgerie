import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import { orphanGroupId, withOrphanGroups, type OrphanSessionRow } from "./sessionOrphanGroups";

describe("withOrphanGroups", () => {
  it("gathers siblings of one unavailable parent under a single header", () => {
    const entries = withOrphanGroups([
      orphanRow("a", "/sessions/gone.jsonl"),
      orphanRow("b", "/sessions/gone.jsonl"),
      orphanRow("c", "/sessions/gone.jsonl"),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual([orphanGroupId("/sessions/gone.jsonl"), "a", "b", "c"]);
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1, 1, 1]);
    const header = entries[0];
    if (header?.kind !== "orphan-group") throw new Error("expected a group header");
    expect(header.members.map((member) => member.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a lone orphan exactly as it was", () => {
    const entries = withOrphanGroups([orphanRow("only", "/sessions/gone.jsonl")]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "session", id: "only", depth: 0 });
  });

  it("separates orphans that lost different parents", () => {
    const entries = withOrphanGroups([
      orphanRow("a", "/sessions/one.jsonl"),
      orphanRow("b", "/sessions/two.jsonl"),
      orphanRow("c", "/sessions/one.jsonl"),
      orphanRow("d", "/sessions/two.jsonl"),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual([
      orphanGroupId("/sessions/one.jsonl"), "a",
      orphanGroupId("/sessions/two.jsonl"), "b",
      "c",
      "d",
    ]);
  });

  it("leaves ordinary roots and nested forks untouched", () => {
    const entries = withOrphanGroups([
      { session: session("root"), depth: 0, hasMissingParent: false },
      { session: session("fork", { parentSessionPath: "/sessions/root.jsonl" }), depth: 1, hasMissingParent: false },
    ]);

    expect(entries.every((entry) => entry.kind === "session")).toBe(true);
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1]);
  });

  it("ignores a nested row even if its parent link is broken", () => {
    const entries = withOrphanGroups([
      { session: session("deep", { parentSessionPath: "/sessions/gone.jsonl" }), depth: 2, hasMissingParent: true },
      orphanRow("a", "/sessions/gone.jsonl"),
    ]);

    expect(entries.every((entry) => entry.kind === "session")).toBe(true);
  });

  it("treats trailing-slash parent paths as the same parent", () => {
    const entries = withOrphanGroups([
      orphanRow("a", "/sessions/gone.jsonl"),
      orphanRow("b", "/sessions/gone.jsonl/"),
    ]);

    expect(entries[0]?.kind).toBe("orphan-group");
    expect(entries).toHaveLength(3);
  });
});

function orphanRow(id: string, parentSessionPath: string): OrphanSessionRow {
  return { session: session(id, { parentSessionPath }), depth: 0, hasMissingParent: true };
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/srv/dev/pi-web",
    created: "2026-07-28T00:00:00.000Z",
    modified: "2026-07-28T00:00:00.000Z",
    messageCount: 3,
    firstMessage: id,
    ...overrides,
  };
}
