import { describe, expect, it } from "vitest";
import { afterFork, afterNavigate, sessionTreeSnapshotSchema } from "./sessionTree";
import { sessionTreeAbandonedPreviewIds, sessionTreeEntryReturnsToEditor, sessionTreeKindLabel, sessionTreeVisualDepth } from "./sessionTreeModel";

describe("session tree wire contract", () => {
  it("keeps timestamps and labels, and shows an unknown kind as other instead of failing the tree", () => {
    const tree = sessionTreeSnapshotSchema.parse({
      nodes: [{ id: "a", parentId: null, kind: "user", summary: "Fix login", timestamp: "2026-10-05T10:00:00.000Z", label: "checkpoint" },
        { id: "b", parentId: "a", kind: "future-kind", summary: "New thing" }],
      activeLeafId: "b", activePathIds: ["a", "b"],
    });
    expect(tree.nodes[0]).toMatchObject({ timestamp: "2026-10-05T10:00:00.000Z", label: "checkpoint" });
    expect(tree.nodes[1]?.kind).toBe("other");
  });
});

describe("session tree outcomes", () => {
  it("continues with the returned editor text, or an empty draft when none returns", () => {
    expect(afterNavigate({ cancelled: false, editorText: "retry this" })).toEqual({ outcome: { type: "continued", editorText: "retry this" } });
    expect(afterNavigate({ cancelled: false })).toEqual({ outcome: { type: "continued", editorText: "" } });
  });
  it("names a cancelled navigation and a cancelled summary as unchanged", () => {
    expect(afterNavigate({ cancelled: true }).notice?.message).toMatch(/^Navigation cancelled/u);
    expect(afterNavigate({ cancelled: true, aborted: true }).notice?.message).toMatch(/^Summarization cancelled/u);
    expect(afterNavigate({ cancelled: true }).outcome).toEqual({ type: "unchanged" });
  });
  it("opens the fork with its draft, and reports a cancelled fork without a session", () => {
    expect(afterFork({ cancelled: false, session: { id: "fork", cwd: "/w" }, promptDraft: "ask again" }).outcome)
      .toEqual({ type: "forked", session: { id: "fork", cwd: "/w" }, promptDraft: "ask again" });
    expect(afterFork({ cancelled: true })).toMatchObject({ outcome: { type: "unchanged" }, notice: { tone: "status" } });
  });
});

describe("session tree presentation", () => {
  const tree = { nodes: [
    { id: "root", parentId: null, kind: "user" as const, summary: "root" },
    { id: "old", parentId: "root", kind: "assistant" as const, summary: "old" },
    { id: "leaf", parentId: "old", kind: "user" as const, summary: "leaf" },
    { id: "side", parentId: "root", kind: "user" as const, summary: "side" },
  ], activeLeafId: "leaf", activePathIds: ["root", "old", "leaf"] };

  it("previews the active-path entries that a new position would leave behind", () => {
    expect([...sessionTreeAbandonedPreviewIds(tree, "side")]).toEqual(["old", "leaf"]);
    expect([...sessionTreeAbandonedPreviewIds(tree, "old")]).toEqual(["leaf"]);
    expect(sessionTreeAbandonedPreviewIds(tree, "leaf").size).toBe(0);
    expect(sessionTreeAbandonedPreviewIds(tree, undefined).size).toBe(0);
    expect(sessionTreeAbandonedPreviewIds(tree, "missing").size).toBe(0);
  });
  it("returns text to the composer only for user and custom messages", () => {
    expect(sessionTreeEntryReturnsToEditor("user")).toBe(true);
    expect(sessionTreeEntryReturnsToEditor("custom-message")).toBe(true);
    expect(sessionTreeEntryReturnsToEditor("assistant")).toBe(false);
  });
  it("names every kind in plain words and caps the drawn branch depth", () => {
    expect(sessionTreeKindLabel("tool-result")).toBe("Tool result");
    expect(sessionTreeKindLabel("thinking-level-change")).toBe("Thinking");
    expect(sessionTreeVisualDepth(-1)).toBe(0);
    expect(sessionTreeVisualDepth(3)).toBe(3);
    expect(sessionTreeVisualDepth(40)).toBe(8);
  });
});
