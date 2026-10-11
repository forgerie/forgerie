import { describe, expect, it } from "vitest";
import { waitingItems, waitingLabel } from "./waitingOnYou";
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
});
