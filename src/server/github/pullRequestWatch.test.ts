import { describe, expect, it } from "vitest";
import { evaluateWatch, initialCursor } from "./pullRequestWatch.js";
import { PR_TIME, pullSnapshot } from "./pullRequest.testSupport.js";
import { defined } from "./fakeGitHub.testSupport.js";

describe("pull request watch comparison", () => {
  it("reports failures once, and reports a failed rerun even if running was not observed", () => {
    const snapshot = pullSnapshot();
    defined(snapshot.pull.checks[0], "check").state = "failed";
    const first = evaluateWatch(initialCursor(PR_TIME), snapshot);
    expect(first.text).toContain("failedChecks");
    expect(evaluateWatch(first.cursor, snapshot).text).toBeUndefined();
    defined(snapshot.pull.checks[0], "check").updatedAt = "2026-10-07T12:01:00Z";
    expect(evaluateWatch(first.cursor, snapshot).text).toContain("tests");
    snapshot.pull.headSha = "b".repeat(40);
    expect(evaluateWatch(first.cursor, snapshot).text).toContain("tests");
  });
  it("reports required checks passing without waiting for an advisory job, but not zero checks", () => {
    const snapshot = pullSnapshot();
    snapshot.pull.checks.push({ id: "run:2", name: "advisory", state: "running", url: "", required: false });
    const first = evaluateWatch(initialCursor(PR_TIME), snapshot);
    expect(first.text).toContain('"checksPassed": true');
    expect(evaluateWatch(first.cursor, snapshot).text).toBeUndefined();
    expect(evaluateWatch(initialCursor(PR_TIME), pullSnapshot({ checks: [] })).text).toBeUndefined();
  });
  it("does not wake again when an already-passing check only updates its timestamp", () => {
    const snapshot = pullSnapshot();
    const first = evaluateWatch(initialCursor(PR_TIME), snapshot);
    defined(snapshot.pull.checks[0], "check").updatedAt = "2026-10-07T12:02:00Z";
    expect(evaluateWatch(first.cursor, snapshot).text).toBeUndefined();
  });
  it("deduplicates edits and same-second comments, and excludes the app's own messages", () => {
    const snapshot = pullSnapshot({ checks: [] });
    snapshot.remarks = [{ id: "c1", kind: "comment", author: "owner", body: "Please fix it", updatedAt: PR_TIME, url: "" },
      { id: "c2", kind: "comment", author: "FORGERIE[bot]", body: "my reply", updatedAt: PR_TIME, url: "" }];
    const first = evaluateWatch(initialCursor(PR_TIME), snapshot);
    expect(first.text).toContain("Please fix it");
    expect(first.text).not.toContain("my reply");
    expect(evaluateWatch(first.cursor, snapshot).text).toBeUndefined();
    defined(snapshot.remarks[0], "remark").updatedAt = "2026-10-07T12:01:00Z";
    expect(evaluateWatch(first.cursor, snapshot).text).toContain("Please fix it");
  });
  it("stops after ten comment-only wakes and resets the limit on check or head progress", () => {
    const snapshot = pullSnapshot({ checks: [] });
    let cursor = evaluateWatch(initialCursor(PR_TIME), snapshot).cursor;
    for (let i = 1; i <= 10; i++) {
      snapshot.remarks = [{ id: `c${String(i)}`, kind: "comment", author: "owner", body: "review", updatedAt: PR_TIME, url: "" }];
      const report = evaluateWatch(cursor, snapshot);
      expect(report.exhausted).toBe(i === 10);
      cursor = report.cursor;
    }
    snapshot.pull.headSha = "b".repeat(40);
    expect(evaluateWatch(cursor, snapshot).cursor.commentWakes).toBe(0);
  });
  it("keeps a known conflict through unknown mergeability and refuses incomplete reads", () => {
    const first = evaluateWatch(initialCursor(PR_TIME), pullSnapshot({ mergeability: "conflicting" }));
    expect(first.text).toContain('"conflict": true');
    expect(evaluateWatch(first.cursor, pullSnapshot({ mergeability: "unknown" })).text).toBeUndefined();
    expect(() => evaluateWatch(first.cursor, pullSnapshot({ complete: false }))).toThrow("incomplete");
  });
});
