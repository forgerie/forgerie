import { describe, expect, it } from "vitest";
import { pinKey, waitingItems, waitingLabel, waitingName } from "./waitingOnYou";
import { BUILDING, CONTRACT_STOP, CONTRACT_WAITING } from "./workflows/fixtures/runs";

const question = (id: string, extra: { answer?: string; cancelled?: boolean } = {}) =>
  ({ id, childEntry: { kind: "question" as const, questionId: `q:${id}`, child: 21, childName: "ui", question: "Which colour?", ...extra } });

describe("what waits on the reader", () => {
  it("keeps open questions and the stop the run waits at, oldest first", () => {
    const messages = [question("1"), { id: "2", workflowEntry: CONTRACT_STOP }, question("3", { answer: "Teal" }), question("4", { cancelled: true }), { id: "5" }];
    expect(waitingItems(messages, [CONTRACT_WAITING]).map((item) => [item.kind, item.id])).toEqual([["question", "1"], ["stop", "2"]]);
  });

  it("drops a stop once the reader decided it, or when its run is unknown", () => {
    expect(waitingItems([{ id: "2", workflowEntry: CONTRACT_STOP }], [BUILDING])).toEqual([]);
    expect(waitingItems([{ id: "2", workflowEntry: CONTRACT_STOP }], [])).toEqual([]);
  });

  it("counts in the heading", () => {
    expect(waitingLabel(1)).toBe("1 waiting for you");
    expect(waitingLabel(3)).toBe("3 waiting for you");
  });

  it("names each item in a few words for the folded dock", () => {
    const items = waitingItems([question("1"), { id: "2", workflowEntry: CONTRACT_STOP }], [CONTRACT_WAITING]);
    expect(items.map(waitingName)).toEqual(["ui's question", CONTRACT_STOP.stageName]);
  });
});

describe("a workflow proposal that waits on the reader", () => {
  it("pins only once the records say it is open", async () => {
    const { PROPOSAL, PROPOSAL_ENTRY, STARTED_PROPOSAL } = await import("./workflows/fixtures/proposals");
    const messages = [{ id: "7", workflowEntry: PROPOSAL_ENTRY }];
    expect(waitingItems(messages, [], [PROPOSAL])).toEqual([{ kind: "proposal", id: "7", entry: PROPOSAL_ENTRY }]);
    expect(waitingItems(messages, [], [STARTED_PROPOSAL])).toEqual([]);
    expect(waitingItems(messages, [])).toEqual([]);
  });
});

describe("a gated action that waits on the reader", () => {
  it("pins only while its record says it waits, in the thread's order, under its own key", async () => {
    const { PUSH, PUSH_ENTRY, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING } = await import("./gatedActions/fixtures/gatedActions");
    const messages = [question("1"), { id: "8", gatedAction: PUSH_ENTRY }];
    const items = waitingItems(messages, [], [], { records: [PUSH] });
    expect(items).toEqual([expect.objectContaining({ kind: "question", id: "1" }), { kind: "gated", id: "8", entry: PUSH_ENTRY }]);
    expect(items.map(pinKey)).toEqual(["q:q:1", `g:${PUSH.id}`]);
    // Before the records are read, and once it is decided, it does not pin.
    expect(waitingItems(messages, [])).toHaveLength(1);
    for (const record of [PUSH_RUNNING, PUSH_RAN, PUSH_REFUSED]) expect(waitingItems(messages, [], [], { records: [record] })).toHaveLength(1);
    // A read that answered without this action does not pin it.
    expect(waitingItems(messages, [], [], { records: [{ ...PUSH, id: "g:9:9" }] })).toHaveLength(1);
  });

  it("pins from the transcript while the records cannot be read, unless a record read earlier says it was decided", async () => {
    const { PUSH, PUSH_ENTRY, PUSH_RAN, PUSH_RUNNING } = await import("./gatedActions/fixtures/gatedActions");
    const messages = [{ id: "8", gatedAction: PUSH_ENTRY }];
    // Never read: the first read failed.
    expect(waitingItems(messages, [], [], { readFailed: true })).toEqual([{ kind: "gated", id: "8", entry: PUSH_ENTRY }]);
    // Read before, without this action, and the latest read failed.
    expect(waitingItems(messages, [], [], { records: [], readFailed: true })).toHaveLength(1);
    expect(waitingItems(messages, [], [], { records: [PUSH], readFailed: true })).toHaveLength(1);
    for (const record of [PUSH_RUNNING, PUSH_RAN]) expect(waitingItems(messages, [], [], { records: [record], readFailed: true })).toEqual([]);
  });
});
