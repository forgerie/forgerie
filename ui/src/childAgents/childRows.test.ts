import { describe, expect, it } from "vitest";
import { branchState, childStatus, childTone, middleCut, unreadableWorktrees, type ChildSummary } from "./childAgentsModel";
import { childCost, type Runs } from "./childWorkModel";
import { RUNS } from "./fixtures/childWork";

const worktree = { path: "/w", branch: "c-5676552a1cf591419b83409b66ff9658d92454ce83b80b386e5d551135941a0b", state: "active" as const, ahead: 0, dirty: false };
const child = (name: string, patch: Partial<ChildSummary> = {}): ChildSummary =>
  ({ name, conversationId: name.length, agent: "reviewer", busy: false, createdAt: 0, questions: [], ...patch });

describe("child rows", () => {
  it("collects the open worktrees that could not be read, and no closed ones", () => {
    const children = [
      child("build", { worktree: { ...worktree, statusError: "not a git repository" } }),
      child("design", { worktree: { ...worktree, statusError: "not a git repository" } }),
      child("old", { worktree: { ...worktree, state: "landed", statusError: "gone" } }),
      child("api", { worktree }),
    ];
    expect(unreadableWorktrees(children).map((item) => item.name)).toEqual(["build", "design"]);
  });

  it("stops repeating a worktree error the list already states", () => {
    const broken = child("build", { worktree: { ...worktree, statusError: "not a git repository" } });
    expect(childStatus(broken)).toBe("Cannot read worktree");
    expect(childStatus(broken, { worktreeNotice: true })).toBe("Idle");
  });

  it("gives each state its tally tone", () => {
    expect(childTone(child("a", { questions: [{ questionId: "q", question: "?", askedAt: 0 }], busy: true }))).toBe("waiting");
    expect(childTone(child("a", { busy: true, retry: { attempt: 1, max: 3, error: "x", until: 0 } }))).toBe("retrying");
    expect(childTone(child("a", { busy: true }))).toBe("working");
    expect(childTone(child("a", { worktree: { ...worktree, state: "discarded" } }))).toBe("stopped");
    expect(childTone(child("a"))).toBe("quiet");
  });

  it("says where a branch stands, and says unknown when the list has said it cannot be read", () => {
    expect(branchState(worktree)).toBe("no new commits");
    expect(branchState({ ...worktree, ahead: 1 })).toBe("1 commit ahead");
    expect(branchState({ ...worktree, ahead: 3, dirty: true })).toBe("3 commits ahead, uncommitted files");
    expect(branchState({ ...worktree, state: "landed" })).toBe("landed");
    expect(branchState({ ...worktree, ahead: 3 }, true)).toBe("status unknown");
  });

  it("cuts a long name in the middle and keeps a short one whole", () => {
    expect(middleCut(worktree.branch, 21)).toBe("c-5676552a\u20261135941a0b");
    expect(middleCut(worktree.branch, 21)).toHaveLength(21);
    expect(middleCut("fix/child-actions", 21)).toBe("fix/child-actions");
  });
});

describe("a child's cost", () => {
  const run = RUNS.records[0]!;
  it("sums the child's own runs", () => {
    const runs: Runs = { ...RUNS, records: [run, { ...run, id: "r2" }, { ...run, id: "r3", child: { ...run.child, conversationId: 7 } }] };
    expect(childCost(runs, 44)).toBeCloseTo(1.02);
  });
  it("is unknown without a run on record, or when one run has no usage", () => {
    expect(childCost(undefined, 44)).toBeUndefined();
    expect(childCost(RUNS, 7)).toBeUndefined();
    expect(childCost({ ...RUNS, records: [run, { ...run, id: "r2", usage: null }] }, 44)).toBeUndefined();
  });
});
