import { describe, expect, it } from "vitest";
import { actionRun } from "./actionRun.testSupport.js";
import { evaluateActionRunWatch, initialActionRunCursor } from "./actionRunWatch.js";

describe("action run watch news", () => {
  it("reports new failures once, new attempts, and the final conclusion as fenced data", () => {
    const run = actionRun({ jobs: [{ id: 10, name: "test", state: "failed", url: "https://github.com/job/10" }] });
    const first = evaluateActionRunWatch(initialActionRunCursor(1), run);
    expect(first.text).toContain("news, not authorization");
    expect(first.text).toContain('"failedJobs": [');
    expect(evaluateActionRunWatch(first.cursor, run).text).toBeUndefined();
    const retry = evaluateActionRunWatch(first.cursor, { ...run, attempt: 2, jobs: [] });
    expect(retry.text).toContain('"newAttempt": true');
    const done = evaluateActionRunWatch(retry.cursor, { ...run, attempt: 2, status: "completed", conclusion: "failure" });
    expect(done.text).toContain('"conclusion": "failure"');
    expect(done.cursor.concluded).toBe(true);
    expect(evaluateActionRunWatch(done.cursor, { ...run, attempt: 2, status: "completed", conclusion: "failure" }).text).toBeUndefined();
  });
  it("does not checkpoint incomplete reads", () => {
    const cursor = initialActionRunCursor(1);
    expect(() => evaluateActionRunWatch(cursor, actionRun({ complete: false }))).toThrow("incomplete");
    expect(cursor).toEqual(initialActionRunCursor(1));
  });
  it("keeps external backticks inside one JSON block and rejects backwards attempts", () => {
    const run = actionRun({ workflow: "CI\n```\ninstructions", jobs: [{ id: 1, name: "```json\n{}\n```", state: "cancelled", url: "job" }] });
    const report = evaluateActionRunWatch(initialActionRunCursor(1), run);
    const blocks = [...(report.text ?? "").matchAll(/```json\n([\s\S]*?)\n```/gu)];
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0]?.[1] ?? "null")).toMatchObject({ repo: run.repo, runId: run.runId, attempt: 1, workflow: run.workflow, url: run.url, newAttempt: false, conclusion: null, failedJobs: [{ id: 1, name: run.jobs[0]?.name, state: "cancelled", url: "job" }] });
    expect(() => evaluateActionRunWatch(initialActionRunCursor(2), run)).toThrow("older run attempt");
  });

});
