import { describe, expect, it } from "vitest";
import { liveRoute, modelTiming, proseWorkers, ranFor, startedAgo, waitingStop } from "./workflowLive";
import { BUILDING, LAND_WAITING, RETRY_LOOKS, RUN_NOW, UNSENT } from "./fixtures/runs";
import { LOOKS, PROSE_RUN, RUN_AT_STOP, RUN_FINISHED, RUN_WORKING } from "./fixtures/sheet";

describe("a run's live route", () => {
  it("says where each stage stands, one block per worker run, and a hollow block for a worker that has not started", () => {
    const route = liveRoute(RUN_WORKING, LOOKS);
    expect(route.map((stage) => [stage.stage.id, stage.progress, stage.status, stage.stopTone])).toEqual([
      ["shape", "done", "Approved by you", "plain"], ["port", "current", undefined, undefined], ["review", "next", undefined, undefined],
      ["land", "next", "You land the branches", "faint"]]);
    expect(route[1]?.workers.map((worker) => [worker.name, worker.tones, worker.status, worker.busy, worker.conversationId, worker.model])).toEqual([
      ["api", ["live"], "Working", true, 41, "anthropic/claude-sonnet-5"], ["page", ["plain"], "Done", false, 42, undefined]]);
    expect(route[2]?.workers[0]).toMatchObject({ name: "review", tones: ["faint"], status: "Not started", started: false, declared: true });
  });

  it("marks a stop that waits as the reader's turn, and offers its card", () => {
    const route = liveRoute(RUN_AT_STOP);
    expect(route[0]).toMatchObject({ progress: "waiting", status: "Waiting for your approval", stopTone: "needs" });
    expect(waitingStop(RUN_AT_STOP)).toMatchObject({ kind: "stop", stage: "shape", stageName: "Shape", stop: "approve", round: 0 });
    expect(waitingStop(RUN_WORKING)).toBeUndefined();
    expect(liveRoute(LAND_WAITING)[3]).toMatchObject({ progress: "waiting", status: "Waiting for you to land" });
  });

  it("counts every run of a worker, failed ones in the failure tone", () => {
    const review = liveRoute(RUN_FINISHED)[2]?.workers[0];
    expect(review).toMatchObject({ tones: ["bad", "plain"], status: "Done, 2 runs", conversationId: 52 });
    expect(liveRoute(RUN_FINISHED)[3]).toMatchObject({ status: "Landed 2 branches" });
  });

  it("puts a retry on the working worker, with the time to the next try, and keeps unsent reports apart from a failed one", () => {
    const port = liveRoute(UNSENT, RETRY_LOOKS, RUN_NOW)[1]!;
    const worker = (name: string) => port.workers.find((candidate) => candidate.name === name);
    expect(worker("design")).toMatchObject({ status: "Retrying 2 of 3. Next try in 1 min 40 s", tones: ["live"] });
    expect(worker("design")?.retry?.attempt).toBe(2);
    expect(worker("build")).toMatchObject({ note: "Duplicate report, not sent again", problem: undefined, retry: undefined });
    expect(worker("docs")).toMatchObject({ declared: false, agent: undefined, tones: ["faint"], status: "Stopped", note: "Stopped before reporting" });
    expect(worker("tests")?.problem).toBe("Report not delivered: Completion reporter faulted: Disk full");
    // A retry that no longer waits on a working child is not drawn.
    expect(liveRoute(LAND_WAITING, RETRY_LOOKS, RUN_NOW)[1]?.workers[0]?.retry).toBeUndefined();
  });

  it("marks a worker that waits for the reader's answer", () => {
    const asking = liveRoute(BUILDING, [{ name: "design", agent: "design-engineer", asking: true }])[1]?.workers[0];
    expect(asking).toMatchObject({ tones: ["needs"], status: "Waiting for your answer" });
  });

  it("reads a settled worker that took a follow-up message as busy again, from the session's child", () => {
    // page settled in the run's record; a direct message started a new turn on the same conversation.
    const followUp = [{ ...LOOKS[1]!, busy: true, conversationId: 42 }];
    const page = liveRoute(RUN_WORKING, followUp)[1]?.workers.find((worker) => worker.name === "page");
    expect(page).toMatchObject({ busy: true, status: "Working on a follow-up", tones: ["plain", "live"], conversationId: 42 });
    expect(modelTiming(page!)).toBe("From its next turn. The turn in progress finishes on its current model.");
    // A question in the follow-up waits on the reader.
    const asking = liveRoute(RUN_WORKING, [{ ...followUp[0]!, asking: true }])[1]?.workers.find((worker) => worker.name === "page");
    expect(asking).toMatchObject({ status: "Waiting for your answer", tones: ["plain", "needs"] });
    // Another conversation of the same name is not this run's worker.
    const other = liveRoute(RUN_WORKING, [{ ...followUp[0]!, conversationId: 99 }, { ...LOOKS[1]!, conversationId: 42 }])[1]?.workers.find((worker) => worker.name === "page");
    expect(other).toMatchObject({ busy: false, status: "Done", tones: ["plain"] });
    // Without the session's word, the record decides.
    expect(liveRoute(RUN_WORKING)[1]?.workers.map((worker) => [worker.name, worker.busy])).toEqual([["api", true], ["page", false]]);
    expect(proseWorkers(PROSE_RUN, [{ name: "reconnect-hunt", agent: "researcher", asking: false, busy: true, conversationId: 62 }])[1])
      .toMatchObject({ busy: true, status: "Working on a follow-up" });
  });

  it("lists every child of a run without stages", () => {
    expect(proseWorkers(PROSE_RUN).map((worker) => [worker.name, worker.tones, worker.status, worker.declared])).toEqual([
      ["store-hunt", ["live"], "Working", false], ["reconnect-hunt", ["plain"], "Done", false]]);
  });
});

describe("what the run sheet says about time", () => {
  it("says when a model change applies", () => {
    expect(modelTiming({ busy: true, started: true })).toBe("From its next turn. The turn in progress finishes on its current model.");
    expect(modelTiming({ busy: false, started: true })).toBe("From its next turn.");
    expect(modelTiming({ busy: false, started: false })).toBe("It starts on this model.");
  });

  it("says how long ago a run started, and how long a finished one ran", () => {
    expect(startedAgo(0, 30_000)).toBe("Started just now");
    expect(startedAgo(0, 23 * 60_000)).toBe("Started 23 min ago");
    expect(startedAgo(0, 125 * 60_000)).toBe("Started 2 h 5 min ago");
    expect(ranFor(0, 60 * 60_000)).toBe("Ran for 1 h");
  });
});
