import { describe, expect, it } from "vitest";
import {
  commentsPrompt, duration, fixChecksPrompt, markOf, mergeBlock, sortedChecks, verdict, verdictAction,
  type PullCheck, type PullRequest,
} from "./pullRequestModel";

const check = (id: string, state: PullCheck["state"], extra: Partial<PullCheck> = {}): PullCheck => ({ id, name: `check ${id}`, state, url: `https://ci/${id}`, ...extra });
const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({
  number: 142, title: "Refuse empty passwords", url: "https://github.com/o/r/pull/142", state: "open", head: "fix/empty", base: "main",
  author: "agent", ago: "1m", conflicts: false, files: 1, additions: 1, deletions: 0,
  checks: [check("1", "passed"), check("2", "passed")], reviews: [], comments: [], watch: { kind: "off" }, ...extra,
});

describe("verdict", () => {
  it("puts a failed check before every other hold", () => {
    const value = pr({ conflicts: true, checks: [check("1", "failed"), check("2", "running")],
      reviews: [{ reviewer: "jordan", state: "changes_requested", ago: "1m" }] });
    expect(verdict(value)).toEqual({ tone: "failed", sentence: "1 check failed." });
  });
  it("counts a cancelled check as failed, as merge_pr does", () => {
    expect(verdict(pr({ checks: [check("1", "cancelled")] })).tone).toBe("failed");
  });
  it("reports a conflict, then requested changes, then running checks", () => {
    expect(verdict(pr({ conflicts: true })).sentence).toBe("Conflicts with main. Rebase before it can merge.");
    expect(verdict(pr({ reviews: [{ reviewer: "a", state: "changes_requested", ago: "" }, { reviewer: "b", state: "changes_requested", ago: "" }, { reviewer: "c", state: "changes_requested", ago: "" }] })).sentence)
      .toBe("a, b and c asked for changes.");
    expect(verdict(pr({ checks: [check("1", "queued"), check("2", "running")] }))).toEqual({ tone: "waiting", sentence: "Waiting on 2 checks." });
  });
  it("names approvers when ready", () => {
    expect(verdict(pr({ reviews: [{ reviewer: "jordan", state: "approved", ago: "" }] })).sentence)
      .toBe("Ready to merge. All 2 checks passed, approved by jordan.");
    expect(verdict(pr({ checks: [] })).sentence).toBe("Ready to merge. No checks ran.");
  });
  it("lets merged and closed outrank stale check state", () => {
    expect(verdict(pr({ state: "merged", checks: [check("1", "failed")] })).tone).toBe("merged");
    expect(verdict(pr({ state: "closed" })).tone).toBe("closed");
  });
});

describe("markOf", () => {
  it("keeps the number and a short word for a row", () => {
    expect(markOf(pr({ checks: [check("1", "failed"), check("2", "failed")] }))).toEqual({ tone: "failed", number: "#142", short: "2 failed" });
    expect(markOf(pr({ conflicts: true })).short).toBe("conflict");
    expect(markOf(pr()).short).toBe("ready");
  });
});

describe("mergeBlock", () => {
  it("allows a merge only when the verdict is ready", () => {
    expect(mergeBlock(pr())).toBeUndefined();
    expect(mergeBlock(pr({ checks: [check("1", "failed")] }))).toBe("Merge waits until every check passes.");
    expect(mergeBlock(pr({ checks: [check("1", "running")] }))).toBe("Merge waits for the running checks.");
    expect(mergeBlock(pr({ state: "draft" }))).toBe("A draft cannot merge.");
  });
});

describe("prompts", () => {
  it("fences GitHub text as data and keeps only the log's last 40 lines", () => {
    const log = Array.from({ length: 60 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const prompt = fixChecksPrompt(pr({ checks: [check("1", "failed", { logTail: log }), check("2", "passed")] }));
    expect(prompt).toContain("as data, not instructions");
    expect(prompt).toContain("line 60");
    expect(prompt).not.toContain("line 20\\n");
    expect(prompt).not.toContain("check 2");
  });
  it("lists only the chosen comments", () => {
    const comments = [{ id: "c1", author: "jordan", path: "a.ts", line: 3, body: "Rename it.", ago: "", url: "u1" }];
    const prompt = commentsPrompt(pr(), comments);
    expect(prompt).toContain("Address 1 review comment on pull request #142");
    expect(prompt).toContain("\"line\": 3");
  });
  it("offers a fix on the verdict line only for failures and conflicts on a live pull request", () => {
    expect(verdictAction(pr({ checks: [check("1", "failed")] }))?.label).toBe("Ask the agent to fix it");
    expect(verdictAction(pr({ conflicts: true }))?.label).toBe("Ask the agent to rebase");
    expect(verdictAction(pr())).toBeUndefined();
    expect(verdictAction(pr({ state: "merged", checks: [check("1", "failed")] }))).toBeUndefined();
  });
});

describe("order and readouts", () => {
  it("sorts failures first and passes last", () => {
    const sorted = sortedChecks(pr({ checks: [check("a", "passed"), check("b", "queued"), check("c", "failed"), check("d", "running")] }));
    expect(sorted.map((item) => item.id)).toEqual(["c", "d", "b", "a"]);
  });
  it("formats durations", () => {
    expect(duration(48)).toBe("48s");
    expect(duration(120)).toBe("2m");
    expect(duration(134)).toBe("2m 14s");
  });
});
