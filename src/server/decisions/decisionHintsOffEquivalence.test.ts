import type { DecisionRequest } from "./decisionClient.js";
import { describe, expect, it } from "vitest";
import { assertDecisionHintOffEquivalence } from "./decisionHintsOffEquivalence.testSupport.js";

const request: DecisionRequest = { model: "fast", state: "reply", questions: { attention: { type: "noul", instructions: "Needs attention?" } } };

describe("decision hints off-equivalence harness", () => {
  it("checks the immediate and settled behavior across all five modes", async () => {
    const modes: string[] = []; let disposals = 0;
    await assertDecisionHintOffEquivalence(({ mode, client }) => {
      modes.push(mode);
      const events = ["turn.finished", "gate.pending", "bash.started"];
      void client?.ask(request).then((opinion) => { if (opinion !== undefined) events.push("hint.received"); });
      return { observe: () => ({ events, gate: "pending", sessionVisible: true }), dispose: () => { disposals += 1; } };
    });
    expect(modes).toEqual(["baseline", "off", "unconfigured", "unreachable", "hanging"]); expect(disposals).toBe(5);
  });
  it("detects waiting for the gateway instead of launching a background ask", async () => {
    await expect(assertDecisionHintOffEquivalence(async ({ client }) => {
      await client?.ask(request);
      return { observe: () => "turn.finished" };
    }, { timeoutMs: 30 })).rejects.toThrow("waited for the decision gateway timeout");
  });
  it("detects delayed mutation after a failed background ask", async () => {
    await expect(assertDecisionHintOffEquivalence(({ client, mode }) => {
      const events = ["turn.finished"];
      if (mode === "hanging") void client?.ask(request).then(() => { events.push("session.hidden"); });
      return { observe: () => events };
    }, { timeoutMs: 30 })).rejects.toThrow("settled observations");
  });
});
