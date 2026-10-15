import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import { byContentIndex, sdkMessageChanges } from "./durableMessageChanges.js";

const message = (...content: AssistantMessage["content"]) => fauxAssistantMessage(content);

describe("sdkMessageChanges", () => {
  it("restates a text start that already holds text as an empty start and a delta", () => {
    expect(sdkMessageChanges(message(fauxThinking("plan")), { type: "text_start", contentIndex: 1, block: fauxText("Here is") })).toEqual([
      { type: "text_start", contentIndex: 1, block: fauxText("") },
      { type: "text_delta", contentIndex: 1, delta: "Here is" },
    ]);
  });
  it("restates a thinking start the same way, and keeps an empty start as one change", () => {
    expect(sdkMessageChanges(undefined, { type: "thinking_start", contentIndex: 0, block: fauxThinking("Let me") })).toEqual([
      { type: "thinking_start", contentIndex: 0, block: fauxThinking("") },
      { type: "thinking_delta", contentIndex: 0, delta: "Let me" },
    ]);
    expect(sdkMessageChanges(undefined, { type: "text_start", contentIndex: 0, block: fauxText("") })).toEqual([
      { type: "text_start", contentIndex: 0, block: fauxText("") },
    ]);
  });
  it("restates a whole block that extends the earlier text as the added text only", () => {
    expect(sdkMessageChanges(message(fauxText("The fix")), { type: "block", contentIndex: 0, block: fauxText("The fix landed") })).toEqual([
      { type: "text_delta", contentIndex: 0, delta: " landed" },
    ]);
  });
  it("keeps a whole block that rewrites earlier text, since no delta can express it", () => {
    const change = { type: "block", contentIndex: 0, block: fauxText("Rewritten") } as const;
    expect(sdkMessageChanges(message(fauxText("The fix")), change)).toEqual([change]);
  });
  it("restates a whole message that only extends and adds blocks", () => {
    const tool = fauxToolCall("read", { path: "a" }, { id: "t1" });
    expect(sdkMessageChanges(message(fauxThinking("plan")), { type: "message", message: message(fauxThinking("plan more"), fauxText("Done"), tool) })).toEqual([
      { type: "thinking_delta", contentIndex: 0, delta: " more" },
      { type: "text_start", contentIndex: 1, block: fauxText("") },
      { type: "text_delta", contentIndex: 1, delta: "Done" },
      { type: "toolcall_start", contentIndex: 2, block: tool },
    ]);
  });
  it("keeps a whole message that drops or rewrites a block", () => {
    const shorter = { type: "message", message: message(fauxText("one")) } as const;
    expect(sdkMessageChanges(message(fauxText("one"), fauxText("two")), shorter)).toEqual([shorter]);
    const rewritten = { type: "message", message: message(fauxText("other")) } as const;
    expect(sdkMessageChanges(message(fauxText("one")), rewritten)).toEqual([rewritten]);
  });
  it("passes deltas through unchanged", () => {
    const change = { type: "text_delta", contentIndex: 0, delta: "more" } as const;
    expect(sdkMessageChanges(message(fauxText("some")), change)).toEqual([change]);
  });
});

describe("byContentIndex", () => {
  it("orders one commit's changes by block, keeping the order within a block", () => {
    expect(byContentIndex([
      { type: "thinking_delta", contentIndex: 0, delta: "a" },
      { type: "text_start", contentIndex: 1, block: fauxText("Hi") },
      { type: "thinking_delta", contentIndex: 0, delta: "b" },
      { type: "text_delta", contentIndex: 1, delta: " there" },
    ]).map((change) => change.type === "message" ? "message" : `${String(change.contentIndex)}:${change.type}`)).toEqual([
      "0:thinking_delta", "0:thinking_delta", "1:text_start", "1:text_delta",
    ]);
  });
});
