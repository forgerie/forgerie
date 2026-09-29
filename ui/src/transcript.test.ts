import { describe, expect, it } from "vitest";
import { parseEvent, type PiMessage } from "./contracts";
import { convertMessage, fromHistory, reduceEvent, seedTranscript } from "./transcript";

const user = (text: string, timestamp = 1): PiMessage => ({ role: "user", content: text, timestamp });
const assistant = (text: string, timestamp = 2): PiMessage => ({ role: "assistant", content: [{ type: "text", text }], timestamp });

describe("text transcript", () => {
  it("shows text history but excludes thinking, tools, and custom messages", () => {
    const state = fromHistory([user("hello"), { role: "toolResult", content: "secret tool output" },
      { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "answer" }, { type: "toolCall" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "only thinking" }] }]);
    expect(state.messages.map(convertMessage).map((message) => message.content)).toEqual([
      [{ type: "text", text: "hello" }], [{ type: "text", text: "answer" }],
    ]);
  });
  it("keeps repeated prompts as separate history messages", () => {
    expect(fromHistory([user("hello", 1), user("hello", 2)]).messages).toHaveLength(2);
  });
  it("reconciles the timestamp-free echo with the completed user message", () => {
    let state = fromHistory([]);
    state = reduceEvent(state, { type: "message.append", message: { role: "user", content: "hello" } });
    const id = state.messages[0]?.id;
    state = reduceEvent(state, { type: "message.end", message: user("hello") });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id, key: "user:1", provisional: false });
  });
  it("streams chunks into one message, then replaces partial text with the final answer", () => {
    let state = reduceEvent(fromHistory([user("hello")]), { type: "agent.start" });
    state = reduceEvent(state, { type: "assistant.delta", text: "Hel" });
    const id = state.liveId;
    state = reduceEvent(state, { type: "assistant.delta", text: "lo" });
    expect(state.messages.at(-1)).toMatchObject({ text: "Hello", status: { type: "running" } });
    state = reduceEvent(state, { type: "message.end", message: assistant("Hello!") });
    state = reduceEvent(state, { type: "message.end", message: assistant("Hello!") });
    expect(state.messages).toHaveLength(2);
    expect(state.messages.at(-1)).toMatchObject({ id, text: "Hello!", status: { type: "complete" } });
    expect(state.isRunning).toBe(true);
    expect(reduceEvent(state, { type: "agent.end" }).isRunning).toBe(false);
  });
  it("does not use the previous answer as the next run's live message", () => {
    let state = fromHistory([assistant("first answer")]);
    state = reduceEvent(state, { type: "agent.start" });
    state = reduceEvent(state, { type: "assistant.delta", text: "new answer" });
    expect(state.messages.map((message) => message.text)).toEqual(["first answer", "new answer"]);
  });
  it("preserves interrupted text and exposes provider errors", () => {
    let state = reduceEvent(fromHistory([]), { type: "assistant.delta", text: "partial" });
    state = reduceEvent(state, { type: "agent.end" });
    expect(state.messages.at(-1)).toMatchObject({ text: "partial", status: { type: "incomplete" } });
    state = reduceEvent(state, { type: "message.end", message: { ...assistant("", 5), stopReason: "error", errorMessage: "Provider unavailable" } });
    expect(state.error).toBe("Provider unavailable");
  });
  it("joins a running stream once using the snapshot watermark", () => {
    const state = seedTranscript([user("hello")], assistant("Hel"), 3, true, [
      { type: "assistant.delta", text: "Hel", seq: 3 },
      { type: "assistant.delta", text: "lo", seq: 4 },
      { type: "message.end", message: assistant("Hello!"), seq: 5 },
      { type: "agent.end", seq: 6 },
    ]);
    expect(state.messages.map((message) => message.text)).toEqual(["hello", "Hello!"]);
    expect(state.isRunning).toBe(false);
  });
  it("avoids replaying a user echo whose final message already exists in history", () => {
    const state = seedTranscript([user("hello")], null, 5, false, [
      { type: "message.append", message: { role: "user", content: "hello" }, seq: 1 },
      { type: "message.end", message: user("hello"), seq: 2 },
    ]);
    expect(state.messages).toHaveLength(1);
  });
  it("keeps a completed earlier answer before a new join-time partial", () => {
    const state = seedTranscript([user("hello")], assistant("Next"), 5, true, [
      { type: "message.end", message: assistant("First", 2), seq: 2 },
      { type: "assistant.delta", text: "Next", seq: 5 },
      { type: "assistant.delta", text: " answer", seq: 6 },
    ]);
    expect(state.messages.map((message) => message.text)).toEqual(["hello", "First", "Next answer"]);
  });
  it("ignores unrelated events and rejects malformed consumed events", () => {
    expect(parseEvent({ type: "tool.start", toolName: "bash" })).toBeUndefined();
    expect(() => parseEvent({ type: "assistant.delta", text: 5 })).toThrow();
  });
});
