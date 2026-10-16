import { describe, expect, it } from "vitest";
import { jobSeconds, listTone, permissionProblem, runInput, runMark, runSentence, runWord, sortedJobs, watchable, watchNote } from "./actionRunModel";
import { failedRun, longRun, passedRun, permissionError, queuedRun, run, runningRun } from "./fixtures/actionRuns";

describe("a run's state", () => {
  it("marks and words the status while it runs and the conclusion once it ends", () => {
    expect([queuedRun, runningRun, failedRun, passedRun, longRun].map((item) => [runMark(item), runWord(item)])).toEqual([
      ["queued", "Queued"], ["running", "In progress"], ["failed", "Failure"], ["passed", "Success"], ["failed", "Timed out"]]);
    expect(runMark(run(1, { status: "waiting", conclusion: null }))).toBe("waiting");
    expect(runMark(run(1, { conclusion: "action_required" }))).toBe("waiting");
    expect(runMark(run(1, { conclusion: "cancelled" }))).toBe("cancelled");
    expect(runWord(run(1, { conclusion: "action_required" }))).toBe("Action required");
  });

  it("says where the run stands in one sentence, and says when a read was incomplete", () => {
    expect(runSentence(failedRun)).toBe("2 of 7 jobs failed in 12m.");
    expect(runSentence(runningRun)).toBe("In progress: 1 of 4 jobs done.");
    expect(runSentence(passedRun)).toBe("Succeeded in 12m.");
    expect(runSentence(queuedRun)).toBe("Queued.");
    expect(runSentence({ ...passedRun, complete: false })).toBe("Succeeded in 12m. Forgerie could not read every job.");
    expect(runSentence({ ...runningRun, jobs: [...runningRun.jobs, { ...runningRun.jobs[0]!, id: "x", state: "failed" }] }))
      .toBe("1 job failed. In progress: 2 of 5 jobs done.");
  });

  it("puts failed jobs first and times a job from GitHub's figure or its start and end", () => {
    expect(sortedJobs(failedRun.jobs).map((job) => job.state)).toEqual(["failed", "failed", "cancelled", "passed", "passed", "passed", "skipped"]);
    expect(jobSeconds({ id: "1", name: "a", state: "passed", url: "", startedAt: "2026-10-15T12:00:00Z", completedAt: "2026-10-15T12:01:30Z" })).toBe(90);
    expect(jobSeconds({ id: "1", name: "a", state: "queued", url: "" })).toBeUndefined();
  });

  it("tones a list by its worst run and ignores unread ones", () => {
    expect(listTone([passedRun, failedRun, null])).toBe("failed");
    expect(listTone([passedRun, runningRun])).toBe("waiting");
    expect(listTone([passedRun])).toBe("ready");
    expect(listTone([null])).toBeUndefined();
  });

  it("offers a watch only while the run has not finished, or when it was never read", () => {
    expect(watchable(runningRun)).toBe(true);
    expect(watchable(passedRun)).toBe(false);
    expect(watchable(null)).toBe(true);
  });
});

describe("the watch in words", () => {
  it("counts wakes, names a failed read, and gives the reason it stopped", () => {
    expect(watchNote({ kind: "off" })).toBeUndefined();
    expect(watchNote({ kind: "watching", since: "2026-10-15T11:00:00Z", wakes: 0 })).toBe("Watching. Nothing has woken the agent yet.");
    expect(watchNote({ kind: "watching", since: "2026-10-15T11:00:00Z", wakes: 1 })).toBe("Watching. The agent woke once.");
    expect(watchNote({ kind: "watching", since: "2026-10-15T11:00:00Z", wakes: 3, error: "GitHub answered 502." }))
      .toBe("Watching. The agent woke 3 times. The last read failed: GitHub answered 502.");
    expect(watchNote({ kind: "stopped", reason: "run completed (success)", at: "2026-10-15T11:00:00Z" })).toBe("Stopped: run completed (success).");
  });
});

describe("the missing Actions permission", () => {
  it("finds the permission and the link the server's refusal carries", () => {
    expect(permissionProblem(permissionError)).toEqual({ url: "https://github.com/settings/apps/forgerie-dev/permissions" });
    expect(permissionProblem('it needs "Actions: read".')).toEqual({ url: undefined });
    expect(permissionProblem("GitHub answered 404: Not Found.")).toBeUndefined();
    expect(permissionProblem(undefined)).toBeUndefined();
  });
});

describe("the link field", () => {
  it("takes a run ID or a run URL and refuses anything else", () => {
    expect(runInput(" 18234561230 ")).toBe(18234561230);
    expect(runInput("https://github.com/forgerie/forgerie/actions/runs/18234561230/job/51003")).toBe("https://github.com/forgerie/forgerie/actions/runs/18234561230/job/51003");
    expect(runInput("0")).toBeUndefined();
    expect(runInput("https://github.com/forgerie/forgerie/pull/142")).toBeUndefined();
    expect(runInput("ci")).toBeUndefined();
  });
});
