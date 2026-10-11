import { describe, expect, it } from "vitest";
import type { PiMessage } from "./contracts";
import { convertMessage, fromHistory, markPosition, reconcileTranscriptIdentity, threadMessageIdAt } from "./transcript";

const user = (text: string, timestamp: number): PiMessage => ({ role: "user", content: text, timestamp });
const assistant = (text: string, timestamp: number): PiMessage => ({ role: "assistant", content: [{ type: "text", text }], timestamp });
const toolCall = (id: string, timestamp: number): PiMessage => ({ role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: {} }], timestamp, stopReason: "toolUse" });
const toolResult = (id: string, timestamp: number): PiMessage => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text: "ok" }], timestamp });

// Positions 0..5 of the /messages list: a tool result makes no message of its own.
const history = [user("deploy it", 1), toolCall("c1", 2), toolResult("c1", 3), assistant("The deploy ran.", 4), user("again", 5), assistant("Done.", 6)];

describe("transcript positions", () => {
  it("records each message's index in the /messages list", () => {
    const transcript = fromHistory(history);
    expect(transcript.messages.map((message) => message.position)).toEqual([0, 1, 3, 4, 5]);
  });

  it("keeps positions when a reload keeps a live message's identity", () => {
    const first = fromHistory(history.slice(0, 1));
    const refreshed = reconcileTranscriptIdentity({ ...first, messages: first.messages.map((message) => ({ ...message, id: "live-7" })) }, fromHistory(history));
    expect(refreshed.messages[0]).toMatchObject({ id: "live-7", position: 0 });
  });

  it("marks the message at a position, and marks nothing for a position it does not hold", () => {
    const { messages } = fromHistory(history);
    const marked = markPosition(messages, 3);
    expect(marked.filter((message) => message.marked).map((message) => message.position)).toEqual([3]);
    expect(markPosition(messages, 2)).toBe(messages);
    expect(markPosition(messages, undefined)).toBe(messages);
    expect(convertMessage(marked[2]!).metadata?.custom).toEqual({ marked: true });
    expect(convertMessage(messages[2]!).metadata).toBeUndefined();
  });

  it("names the joined reply by its first message, because adjacent replies draw as one", () => {
    const { messages } = fromHistory(history);
    expect(threadMessageIdAt(messages, 3)).toBe(messages[1]!.id);
    expect(threadMessageIdAt(messages, 0)).toBe(messages[0]!.id);
    expect(threadMessageIdAt(messages, 5)).toBe(messages[4]!.id);
    expect(threadMessageIdAt(messages, 2)).toBeUndefined();
  });
});
