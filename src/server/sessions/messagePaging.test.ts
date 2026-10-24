import { describe, expect, it } from "vitest";
import { expandStartToSafeBoundary, pageMessagesAtSafeBoundary } from "./messagePaging";

const user = (content: string) => ({ role: "user", content });
const assistantText = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const thinking = (text: string) => ({ role: "assistant", content: [{ type: "thinking", thinking: text }] });
const toolCall = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", name }] });
const toolResult = (text: string) => ({ role: "toolResult", content: text });

function page(start: number, total: number, messages: unknown[]) {
  return { start, total, messages };
}

describe("message paging", () => {
  it("wraps the full history in a page when paging is not requested", () => {
    const messages = [user("hello")];
    expect(pageMessagesAtSafeBoundary(messages)).toEqual(page(0, 1, messages));
  });

  it("uses normal bounded paging when the requested start is already a turn boundary", () => {
    const messages = [user("a"), assistantText("b"), user("c")];
    expect(pageMessagesAtSafeBoundary(messages, { limit: 1 })).toEqual(page(2, 3, messages.slice(2)));
  });

  it("expands a page start backward to avoid splitting a turn", () => {
    const messages = [
      user("prompt"),
      thinking("plan"),
      toolCall("read"),
      toolResult("ok"),
      thinking("next"),
      assistantText("answer"),
    ];

    expect(pageMessagesAtSafeBoundary(messages, { before: 5, limit: 2 })).toEqual(page(0, 6, messages.slice(0, 5)));
  });

  it("does not split a readable assistant answer from its user prompt", () => {
    const messages = [user("prompt"), thinking("plan"), assistantText("answer")];
    expect(expandStartToSafeBoundary(messages, 2)).toBe(0);
  });

  const longTurn = (rounds: number) => [user("go"), ...Array.from({ length: rounds }, (_, index) => [toolCall(`read-${String(index)}`), toolResult(String(index))]).flat()];

  it("keeps a whole turn when it fits in 500 messages", () => {
    const messages = longTurn(249);
    expect(pageMessagesAtSafeBoundary(messages, { limit: 50 })).toEqual(page(0, 499, messages));
  });

  it("cuts a turn longer than 500 messages at a tool call, never at its result", () => {
    const messages = longTurn(300);
    const latest = pageMessagesAtSafeBoundary(messages, { limit: 50 });
    expect(latest.start).toBe(551);
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[0]).toEqual(toolCall("read-275"));
    const odd = pageMessagesAtSafeBoundary(messages, { limit: 51 });
    expect(odd.start).toBe(549);
    expect(odd.messages[0]).toEqual(toolCall("read-274"));
  });

  it("accepts a tool-round cursor inside an oversized turn and rejects a result cursor", () => {
    const messages = longTurn(300);
    const earlier = pageMessagesAtSafeBoundary(messages, { before: 551, limit: 50, completeTurns: true });
    expect(earlier).toEqual(page(501, 601, messages.slice(501, 551)));
    expect(() => pageMessagesAtSafeBoundary(messages, { before: 552, limit: 50, completeTurns: true })).toThrow("complete-turn or tool-round boundary");
  });

  it("returns to turn boundaries once the earlier turn fits", () => {
    const messages = [...longTurn(10), ...longTurn(300)];
    expect(pageMessagesAtSafeBoundary(messages, { before: 21, limit: 5, completeTurns: true })).toEqual(page(0, 622, messages.slice(0, 21)));
  });

  it("finds a search hit inside an oversized turn without returning the whole turn", () => {
    const messages = longTurn(300);
    const hit = pageMessagesAtSafeBoundary(messages, { around: 100, limit: 20 });
    expect(hit.start).toBe(81);
    expect(hit.start + hit.messages.length).toBe(101);
  });
});
