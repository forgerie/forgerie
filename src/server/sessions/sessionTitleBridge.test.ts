import { describe, expect, it } from "vitest";
import { createSessionTitleBridgeObserver, createSessionTitleBridgeSlot, type SessionTitleBridgeEvent } from "./sessionTitleBridge.js";

describe("session title bridge", () => {
  it("reports receiver failures without breaking the extension lifecycle", () => {
    const slot = createSessionTitleBridgeSlot();
    const errors: unknown[] = [];
    slot.setReceiver(() => { throw new Error("receiver failed"); }, (error) => { errors.push(error); });

    expect(() => { slot.publish({ type: "lifecycle.reset" }); }).not.toThrow();
    expect(errors).toEqual([new Error("receiver failed")]);
  });

  it("publishes raw user intent only after Pi accepts an agent turn", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("/skill:se-architecture-improvement");
    expect(events).toEqual([]);
    observer.observeAcceptedPrompt("<skill name=\"se-architecture-improvement\">expanded instructions</skill>");

    expect(events).toEqual([{ type: "intent.accepted", text: "/skill:se-architecture-improvement" }]);
  });

  it("correlates interleaved raw inputs with the prompt Pi accepts", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("First task");
    observer.observeInput("Second task");
    observer.observeAcceptedPrompt("First task");

    expect(events).toEqual([{ type: "intent.accepted", text: "First task" }]);
  });

  it("skips stale handled input when a later prompt is accepted", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("Handled without an agent turn");
    observer.observeInput("Accepted task");
    observer.observeAcceptedPrompt("Accepted task");

    expect(events).toEqual([{ type: "intent.accepted", text: "Accepted task" }]);
  });

  it("uses expanded template intent instead of stale unmatched input", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("Rejected task");
    observer.observeInput("/review-template");
    observer.observeAcceptedPrompt("Review the session lifecycle implementation");

    expect(events).toEqual([{ type: "intent.accepted", text: "Review the session lifecycle implementation" }]);
  });

  it("correlates expanded skill prompts by complete skill name", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("/skill:se-workflow");
    observer.observeInput("/skill:se-work");
    observer.observeInput("/skill:se-architecture-improvement");
    observer.observeAcceptedPrompt("<skill name=\"se-architecture-improvement\" location=\"/skills/architecture\">instructions</skill>");

    expect(events).toEqual([{ type: "intent.accepted", text: "/skill:se-architecture-improvement" }]);
  });

  it("requires a boundary after a correlated skill name", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("/skill:se-workflow");
    observer.observeInput("/skill:se-work");
    observer.observeAcceptedPrompt("<skill name=\"se-work\" location=\"/skills/work\">instructions</skill>");

    expect(events).toEqual([{ type: "intent.accepted", text: "/skill:se-work" }]);
  });

  it("falls back to the accepted prompt when no raw input event was observed", () => {
    const { events, observer } = bridgeHarness();

    observer.observeAcceptedPrompt("Extension-authored task");

    expect(events).toEqual([{ type: "intent.accepted", text: "Extension-authored task" }]);
  });

  it("discards pending raw input when the session lifecycle resets", () => {
    const { events, observer } = bridgeHarness();

    observer.observeInput("Stale task");
    observer.reset();
    observer.observeAcceptedPrompt("Current task");

    expect(events).toEqual([
      { type: "lifecycle.reset" },
      { type: "intent.accepted", text: "Current task" },
    ]);
  });
});

function bridgeHarness() {
  const slot = createSessionTitleBridgeSlot();
  const events: SessionTitleBridgeEvent[] = [];
  slot.setReceiver((event) => { events.push(event); });
  return { events, observer: createSessionTitleBridgeObserver(slot) };
}
