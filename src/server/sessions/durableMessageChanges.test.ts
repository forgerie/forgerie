import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MessageChange } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import { applySdkCommit, byContentIndex, sdkMessageChanges } from "./durableMessageChanges.js";

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
  it("keeps a whole block that adds no text, so its other fields still reach readers", () => {
    const change = { type: "block", contentIndex: 0, block: { ...fauxThinking("plan"), thinkingSignature: "signed" } } as const;
    expect(sdkMessageChanges(message(fauxThinking("plan")), change)).toEqual([change]);
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

describe("applySdkCommit", () => {
  interface Reported { change: MessageChange; partial: AssistantMessage | undefined }
  const commit = (partial: AssistantMessage | undefined, changes: MessageChange[]) => {
    const reported: Reported[] = [];
    const result = applySdkCommit(partial, changes, (change, after) => { reported.push({ change, partial: structuredClone(after) }); });
    return { result, reported };
  };

  it("keeps a signature that a replacement adds without new text", () => {
    const { result, reported } = commit(message({ ...fauxThinking("plan"), thinkingSignature: "" }),
      [{ type: "block", contentIndex: 0, block: { ...fauxThinking("plan"), thinkingSignature: "signed" } }]);
    expect(result?.content[0]).toEqual({ ...fauxThinking("plan"), thinkingSignature: "signed" });
    expect(reported.map(({ change }) => change.type)).toEqual(["block"]);
  });
  it("keeps the replacement's metadata when its added text is restated as a delta", () => {
    const { result, reported } = commit(message({ ...fauxText("Hello"), textSignature: "a" }),
      [{ type: "block", contentIndex: 0, block: { ...fauxText("Hello world"), textSignature: "b" } }]);
    expect(reported.map(({ change }) => change)).toEqual([{ type: "text_delta", contentIndex: 0, delta: " world" }]);
    expect(reported[0]?.partial?.content[0]).toEqual({ ...fauxText("Hello world"), textSignature: "b" });
    expect(result?.content[0]).toEqual({ ...fauxText("Hello world"), textSignature: "b" });
  });
  it("keeps a whole message's metadata when its text is restated", () => {
    const before = { ...message(fauxText("Hello")), responseId: "before" };
    const after = { ...message(fauxText("Hello world")), responseId: "after" };
    const { result, reported } = commit(before, [{ type: "message", message: after }]);
    expect(reported.map(({ change }) => change.type)).toEqual(["text_delta"]);
    expect(result).toEqual(after);
  });
  it("reports each state in order, so a delta-only reader rebuilds the commit's text", () => {
    const { result, reported } = commit(message(fauxThinking("Let")), [
      { type: "thinking_delta", contentIndex: 0, delta: " me" },
      { type: "text_start", contentIndex: 1, block: fauxText("**Landed.** ") },
      { type: "thinking_delta", contentIndex: 0, delta: " think" },
      { type: "text_delta", contentIndex: 1, delta: "The fix" },
    ]);
    expect(reported.map(({ change }) => change.type === "text_delta" || change.type === "thinking_delta" ? change.delta : change.type))
      .toEqual([" me", " think", "text_start", "**Landed.** ", "The fix"]);
    expect(result?.content).toEqual([fauxThinking("Let me think"), fauxText("**Landed.** The fix")]);
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
