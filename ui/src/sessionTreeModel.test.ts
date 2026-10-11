import { describe, expect, it } from "vitest";
import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, type SessionTreeNode, type SessionTreeSnapshot } from "./sessionTree";
import { buildSessionTreeModel, initialSessionTreeFilter, initialSessionTreeSelection, nearestVisibleSessionTreeId, SESSION_TREE_DEFAULT_FILTER, sessionTreeView, toggleSessionTreeFold, transitionSessionTreeKey, validateSessionTreeSummaryChoice, visibleSessionTreeRows } from "./sessionTreeModel";

describe("session tree hierarchy model", () => {
  it("builds a complete forest while normalizing orphans, cycles, self-links, and duplicate IDs", () => {
    const model = buildSessionTreeModel({
      nodes: [
        node("root", null),
        node("child", "root"),
        node("orphan", "missing"),
        node("cycle-a", "cycle-b"),
        node("cycle-b", "cycle-a"),
        node("cycle-child", "cycle-a"),
        node("self", "self"),
        { ...node("root", null), summary: "duplicate is ignored" },
      ],
      activeLeafId: "cycle-child",
      activePathIds: ["cycle-b", "cycle-a", "cycle-child", "missing"],
    });

    expect(model.orderedIds).toEqual(["root", "child", "orphan", "cycle-a", "cycle-b", "cycle-child", "self"]);
    expect(model.rootIds).toEqual(["root", "orphan", "cycle-b", "self"]);
    expect(model.parentById.get("cycle-b")).toBeNull();
    expect(model.parentById.get("cycle-a")).toBe("cycle-b");
    expect(model.childrenById.get("cycle-a")).toEqual(["cycle-child"]);

    const rows = visibleSessionTreeRows(model, new Set());
    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["orphan", 0],
      ["cycle-b", 0],
      ["cycle-a", 1],
      ["cycle-child", 2],
      ["self", 0],
    ]);
    expect(rows.filter((row) => row.activePath).map((row) => row.node.id)).toEqual(["cycle-b", "cycle-a", "cycle-child"]);
    expect(rows.filter((row) => row.activeLeaf).map((row) => row.node.id)).toEqual(["cycle-child"]);
    expect(initialSessionTreeSelection(model)).toBe("cycle-child");
  });

  it("starts from the final retained entry when the active leaf is absent and hides only folded descendants", () => {
    const model = buildSessionTreeModel(snapshot());

    expect(initialSessionTreeSelection(model)).toBe("branch-2");
    expect(visibleSessionTreeRows(model, new Set(["branch-1"])).map((row) => row.node.id)).toEqual(["root", "branch-1", "branch-2"]);
    expect(visibleSessionTreeRows(model, new Set(["root"])).map((row) => row.node.id)).toEqual(["root"]);
  });

  it("keeps linear history in one visual lane and indents only after forks", () => {
    const model = buildSessionTreeModel({
      nodes: [
        node("root", null),
        node("before-fork", "root"),
        node("fork", "before-fork"),
        node("main", "fork"),
        node("main-next", "main"),
        node("side", "fork"),
        node("nested-fork", "side"),
        node("nested-a", "nested-fork"),
        node("nested-b", "nested-fork"),
      ],
      activeLeafId: "main-next",
      activePathIds: [],
    });

    expect(visibleSessionTreeRows(model, new Set()).map((row) => [row.node.id, row.branchDepth])).toEqual([
      ["root", 0],
      ["before-fork", 0],
      ["fork", 0],
      ["main", 1],
      ["main-next", 1],
      ["side", 1],
      ["nested-fork", 1],
      ["nested-a", 2],
      ["nested-b", 2],
    ]);
  });

  it("derives one coherent active path from the normalized leaf instead of trusting malformed badges", () => {
    const model = buildSessionTreeModel({
      nodes: [node("root", null), node("active", "root"), node("unrelated", "root")],
      activeLeafId: "active",
      activePathIds: ["unrelated", "missing"],
    });

    const rows = visibleSessionTreeRows(model, new Set());
    expect(rows.filter((row) => row.activePath).map((row) => row.node.id)).toEqual(["root", "active"]);
    expect(rows.filter((row) => row.activeLeaf).map((row) => row.node.id)).toEqual(["active"]);
  });

  it("normalizes and renders a large deep tree without recursive or quadratic parent walks", () => {
    const count = 20_000;
    const nodes = Array.from({ length: count }, (_, index) => node(
      `node-${String(index)}`,
      index === 0 ? null : `node-${String(index - 1)}`,
    ));
    const model = buildSessionTreeModel({
      nodes,
      activeLeafId: `node-${String(count - 1)}`,
      activePathIds: [],
    });

    expect(model.orderedIds).toHaveLength(count);
    expect(model.depthById.get(`node-${String(count - 1)}`)).toBe(count - 1);
    expect(model.branchDepthById.get(`node-${String(count - 1)}`)).toBe(0);
    expect(model.activePathIds.size).toBe(count);
    expect(visibleSessionTreeRows(model, new Set())).toHaveLength(count);
  });

  it("keeps an empty snapshot inert", () => {
    const model = buildSessionTreeModel({ nodes: [], activeLeafId: null, activePathIds: [] });

    expect(initialSessionTreeSelection(model)).toBeUndefined();
    expect(visibleSessionTreeRows(model, new Set())).toEqual([]);
    const transition = transitionSessionTreeKey(model, { selectedId: undefined, foldedIds: new Set() }, "Enter");
    expect(transition).toMatchObject({ selectedId: undefined, handled: true });
    expect(transition.action).toBeUndefined();
  });
});

describe("session tree keyboard state", () => {
  const model = buildSessionTreeModel(snapshot());
  const expanded = { selectedId: "branch-1", foldedIds: new Set<string>() };

  it("moves over visible rows with arrows, Home, and End", () => {
    expect(transitionSessionTreeKey(model, expanded, "ArrowUp").selectedId).toBe("root");
    expect(transitionSessionTreeKey(model, expanded, "ArrowDown").selectedId).toBe("leaf-1");
    expect(transitionSessionTreeKey(model, expanded, "Home").selectedId).toBe("root");
    expect(transitionSessionTreeKey(model, expanded, "End").selectedId).toBe("branch-2");
    expect(transitionSessionTreeKey(model, { ...expanded, selectedId: "root" }, "ArrowUp").selectedId).toBe("root");
    expect(transitionSessionTreeKey(model, { ...expanded, selectedId: "branch-2" }, "ArrowDown").selectedId).toBe("branch-2");
  });

  it("folds or moves to a parent with Left and unfolds or moves to the first child with Right", () => {
    const folded = transitionSessionTreeKey(model, expanded, "ArrowLeft");
    expect([...folded.foldedIds]).toEqual(["branch-1"]);
    expect(folded.selectedId).toBe("branch-1");

    const parent = transitionSessionTreeKey(model, folded, "ArrowLeft");
    expect(parent.selectedId).toBe("root");

    const unfolded = transitionSessionTreeKey(model, folded, "ArrowRight");
    expect([...unfolded.foldedIds]).toEqual([]);
    expect(unfolded.selectedId).toBe("branch-1");

    expect(transitionSessionTreeKey(model, expanded, "ArrowRight").selectedId).toBe("leaf-1");
  });

  it("reports confirmation and cancellation actions and leaves unrelated keys alone", () => {
    expect(transitionSessionTreeKey(model, expanded, "Enter")).toMatchObject({ handled: true, action: "confirm", selectedId: "branch-1" });
    expect(transitionSessionTreeKey(model, expanded, "Escape")).toMatchObject({ handled: true, action: "cancel" });
    expect(transitionSessionTreeKey(model, expanded, "Tab")).toMatchObject({ handled: false, selectedId: "branch-1" });
  });

  it("selects a pointer-toggled branch and keeps folding immutable", () => {
    const originalFolded = new Set<string>();
    const folded = toggleSessionTreeFold(model, { selectedId: "leaf-1", foldedIds: originalFolded }, "root");

    expect(folded.selectedId).toBe("root");
    expect([...folded.foldedIds]).toEqual(["root"]);
    expect([...originalFolded]).toEqual([]);
    expect([...toggleSessionTreeFold(model, folded, "root").foldedIds]).toEqual([]);
  });
});

describe("session tree reading lenses", () => {
  const lensSnapshot: SessionTreeSnapshot = {
    nodes: [
      { id: "ask", parentId: null, kind: "user", summary: "first question" },
      { id: "calls", parentId: "ask", kind: "assistant", summary: "Tool call: read, bash" },
      { id: "result", parentId: "calls", kind: "tool-result", summary: "Tool result (read): ok" },
      { id: "reply", parentId: "result", kind: "assistant", summary: "here is the answer", label: "checkpoint" },
      { id: "mode", parentId: "reply", kind: "custom", summary: "Custom entry: flow-mode" },
      { id: "ask-2", parentId: "mode", kind: "user", summary: "second question" },
    ],
    activeLeafId: "ask-2",
    activePathIds: ["ask", "calls", "result", "reply", "mode", "ask-2"],
  };
  const model = buildSessionTreeModel(lensSnapshot);
  const idsFor = (filter: Parameters<typeof visibleSessionTreeRows>[2]): string[] =>
    visibleSessionTreeRows(model, new Set(), filter).map((row) => row.node.id);

  it("opens on user messages, the only entries whose text returns to the composer", () => {
    expect(SESSION_TREE_DEFAULT_FILTER).toBe("user-only");
    expect(idsFor(SESSION_TREE_DEFAULT_FILTER)).toEqual(["ask", "ask-2"]);
  });

  it("drops bookkeeping from the conversation lens and tool results from the no-tools lens", () => {
    expect(idsFor("conversation")).toEqual(["ask", "result", "reply", "ask-2"]);
    expect(idsFor("no-tools")).toEqual(["ask", "reply", "ask-2"]);
    expect(idsFor("labeled-only")).toEqual(["reply"]);
  });

  it("hides tool-call-only assistant turns in every lens, including all", () => {
    expect(idsFor("all")).toEqual(["ask", "result", "reply", "mode", "ask-2"]);
  });

  it("keeps the active leaf reachable even when its lens would hide it", () => {
    const leafIsScaffolding = buildSessionTreeModel({
      nodes: [
        { id: "ask", parentId: null, kind: "user", summary: "question" },
        { id: "calls", parentId: "ask", kind: "assistant", summary: "Tool call: read" },
      ],
      activeLeafId: "calls",
      activePathIds: ["ask", "calls"],
    });

    expect(visibleSessionTreeRows(leafIsScaffolding, new Set(), "all").map((row) => row.node.id)).toEqual(["ask", "calls"]);
  });

  it("re-parents survivors onto their nearest retained ancestor instead of orphaning them", () => {
    const view = sessionTreeView(model, { foldedIds: new Set(), filter: "user-only" });

    expect(view.visibleParentById.get("ask-2")).toBe("ask");
    expect(view.visibleChildrenById.get("ask")).toEqual(["ask-2"]);
    expect(view.rows.map((row) => [row.node.id, row.depth, row.branchDepth])).toEqual([["ask", 0, 0], ["ask-2", 1, 0]]);
  });

  it("repairs a selection a lens hides by walking up to the retained ancestor", () => {
    const visibleIds = idsFor("user-only");

    expect(nearestVisibleSessionTreeId(model, visibleIds, "reply")).toBe("ask");
    expect(nearestVisibleSessionTreeId(model, visibleIds, "ask-2")).toBe("ask-2");
    expect(nearestVisibleSessionTreeId(model, [], "ask")).toBeUndefined();
  });

  it("walks and folds the filtered forest, not the underlying one", () => {
    const state = { selectedId: "ask", foldedIds: new Set<string>(), filter: "user-only" as const };

    expect(transitionSessionTreeKey(model, state, "ArrowDown").selectedId).toBe("ask-2");
    expect(transitionSessionTreeKey(model, { ...state, selectedId: "ask-2" }, "ArrowLeft").selectedId).toBe("ask");

    const folded = toggleSessionTreeFold(model, state, "ask");
    expect([...folded.foldedIds]).toEqual(["ask"]);
    expect(visibleSessionTreeRows(model, folded.foldedIds, "user-only").map((row) => row.node.id)).toEqual(["ask"]);
  });
});

describe("session tree search and branch order", () => {
  const model = buildSessionTreeModel({
    nodes: [
      { id: "ask", parentId: null, kind: "user", summary: "Rewrite the capture script" },
      { id: "abandoned", parentId: "ask", kind: "assistant", summary: "Abandoned attempt" },
      { id: "live", parentId: "ask", kind: "assistant", summary: "Live answer about CAPTURE timing", label: "keep" },
      { id: "tail", parentId: "live", kind: "user", summary: "thanks" },
    ],
    activeLeafId: "tail",
    activePathIds: ["ask", "live", "tail"],
  });

  it("reads the live branch before abandoned siblings at a fork", () => {
    expect(visibleSessionTreeRows(model, new Set(), "all").map((row) => row.node.id)).toEqual(["ask", "live", "tail", "abandoned"]);
  });

  it("matches every term, case-insensitively, across label, kind and summary", () => {
    const idsFor = (search: string): string[] => visibleSessionTreeRows(model, new Set(), "all", search).map((row) => row.node.id);

    expect(idsFor("capture")).toEqual(["ask", "live"]);
    expect(idsFor("capture timing")).toEqual(["live"]);
    expect(idsFor("keep")).toEqual(["live"]);
    expect(idsFor("user")).toEqual(["ask", "tail"]);
    expect(idsFor("   ")).toHaveLength(4);
    expect(idsFor("nothing here")).toEqual([]);
  });

  it("re-parents matches so a hidden ancestor never orphans its match", () => {
    const view = sessionTreeView(model, { foldedIds: new Set(), filter: "all", search: "thanks" });

    expect(view.rows.map((row) => [row.node.id, row.depth])).toEqual([["tail", 0]]);
    expect(view.visibleParentById.get("tail")).toBeNull();
  });
});

describe("session tree summary validation", () => {
  it("maps the three summary modes and trims custom focus", () => {
    expect(validateSessionTreeSummaryChoice("none", "ignored")).toEqual({ ok: true, choice: { mode: "none" } });
    expect(validateSessionTreeSummaryChoice("default", "ignored")).toEqual({ ok: true, choice: { mode: "default" } });
    expect(validateSessionTreeSummaryChoice("custom", "  focus on test failures\n  ")).toEqual({
      ok: true,
      choice: { mode: "custom", instructions: "focus on test failures" },
    });
  });

  it("rejects blank and oversized custom focus", () => {
    expect(validateSessionTreeSummaryChoice("custom", "   ")).toEqual({ ok: false, error: "Enter custom summary focus instructions." });
    expect(validateSessionTreeSummaryChoice("custom", "x".repeat(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: `Custom summary focus must be ${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} characters or fewer.`,
    });
  });
});

function snapshot(): SessionTreeSnapshot {
  return {
    nodes: [
      node("root", null),
      node("branch-1", "root"),
      node("leaf-1", "branch-1"),
      node("branch-2", "root"),
    ],
    activeLeafId: null,
    activePathIds: [],
  };
}

describe("a tree opened on one entry", () => {
  // u1 -> a1 (current), and u1 -> a2 -> u3 on another branch, with a tool result.
  const model = buildSessionTreeModel({
    nodes: [
      { id: "u1", parentId: null, kind: "user", summary: "Plan it" },
      { id: "a1", parentId: "u1", kind: "assistant", summary: "Plan A" },
      { id: "a2", parentId: "u1", kind: "assistant", summary: "Plan B" },
      { id: "u3", parentId: "a2", kind: "user", summary: "Go with B" },
      { id: "t3", parentId: "u3", kind: "tool-result", summary: "ok" },
    ],
    activeLeafId: "a1", activePathIds: ["u1", "a1"],
  });

  it("selects the asked-for entry when the tree holds it, else the current entry", () => {
    expect(initialSessionTreeSelection(model, "a2")).toBe("a2");
    expect(initialSessionTreeSelection(model, "gone")).toBe("a1");
    expect(initialSessionTreeSelection(model)).toBe("a1");
  });

  it("opens on the default lens for a user entry, and widens only as far as the entry needs", () => {
    expect(initialSessionTreeFilter(model, "u3")).toBe(SESSION_TREE_DEFAULT_FILTER);
    expect(initialSessionTreeFilter(model, "a2")).toBe("no-tools");
    expect(initialSessionTreeFilter(model, "t3")).toBe("conversation");
    expect(initialSessionTreeFilter(model, "gone")).toBe(SESSION_TREE_DEFAULT_FILTER);
    expect(initialSessionTreeFilter(model)).toBe(SESSION_TREE_DEFAULT_FILTER);
  });
});

function node(id: string, parentId: string | null): SessionTreeNode {
  return { id, parentId, kind: "assistant", summary: id };
}
