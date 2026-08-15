import { describe, expect, it } from "vitest";
import { hideChildrenOfDelegatingSessions } from "./inFlightSpawnedSessions.js";

interface Row {
  readonly id: string;
  readonly parentSessionPath?: string;
  readonly agentSpawned?: boolean;
}

const PARENT = "/sessions/repo/parent.jsonl";

describe("hideChildrenOfDelegatingSessions", () => {
  it("hides a fork of a session that is delegating right now", () => {
    const rows: Row[] = [{ id: "fork", parentSessionPath: PARENT }];

    expect(hideChildrenOfDelegatingSessions(rows, new Set([PARENT])))
      .toEqual([{ id: "fork", parentSessionPath: PARENT, agentSpawned: true }]);
  });

  it("leaves a fork visible once its parent stops delegating, so the durable mark decides", () => {
    const rows: Row[] = [{ id: "fork", parentSessionPath: PARENT }];

    expect(hideChildrenOfDelegatingSessions(rows, new Set())).toEqual(rows);
  });

  it("leaves the delegating parent itself visible", () => {
    const rows: Row[] = [{ id: "parent" }, { id: "fork", parentSessionPath: PARENT }];

    const [parent] = hideChildrenOfDelegatingSessions(rows, new Set([PARENT]));

    expect(parent).toEqual({ id: "parent" });
  });

  it("leaves a child of some other session alone", () => {
    const rows: Row[] = [{ id: "elsewhere", parentSessionPath: "/sessions/repo/other.jsonl" }];

    expect(hideChildrenOfDelegatingSessions(rows, new Set([PARENT]))).toEqual(rows);
  });

  it("leaves a session with no parent link alone", () => {
    const rows: Row[] = [{ id: "root" }];

    expect(hideChildrenOfDelegatingSessions(rows, new Set([PARENT]))).toEqual(rows);
  });

  it("leaves every row untouched when nothing is delegating", () => {
    const rows: Row[] = [{ id: "fork", parentSessionPath: PARENT }, { id: "root" }];

    const result = hideChildrenOfDelegatingSessions(rows, new Set());

    expect(result).toEqual(rows);
    for (const [index, row] of result.entries()) expect(row).toBe(rows[index]);
  });

  it("keeps an already-marked child marked", () => {
    const rows: Row[] = [{ id: "fork", parentSessionPath: PARENT, agentSpawned: true }];

    expect(hideChildrenOfDelegatingSessions(rows, new Set([PARENT]))).toEqual(rows);
  });
});
