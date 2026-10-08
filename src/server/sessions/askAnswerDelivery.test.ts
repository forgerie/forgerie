import { describe, expect, it } from "vitest";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { SessionAsks } from "./sessionAsks.js";
import { responseFromBranch, SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";
import { undeliveredAskAnswers } from "./askAnswerDelivery.js";

it("recovers accepted answers after a crash, but never redelivers recorded messages", () => {
  const entries: unknown[] = [];
  const asks = new SessionAsks({ readResponse: () => responseFromBranch(entries), appendEvent: (_id, data) => { entries.push({ type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data }); }, createAskId: () => "ask-1" });
  asks.open({ sessionId: "session", questions: [{ id: "q", question: "Which?", options: [] }] });
  const result = asks.submit("session", "ask-1", { answers: [{ id: "q", values: [], otherText: "This one" }] });
  if (result.status !== "closed") throw new Error("Answer not accepted");
  expect(undeliveredAskAnswers(entries)).toEqual([result.outcome]);
  entries.push({ type: "custom_message", customType: ASK_USER_ANSWERS_CUSTOM_TYPE, details: result.outcome });
  expect(undeliveredAskAnswers(entries)).toEqual([]);
});
describe("delivery failures", () => {
  it("keeps the form open when the durable answer write fails", () => {
    const entries: unknown[] = [];
    const asks = new SessionAsks({ readResponse: () => responseFromBranch(entries), appendEvent: (_id, data) => {
      if (data.kind === "answered") throw new Error("disk full");
      entries.push({ type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data });
    }, createAskId: () => "ask-1" });
    asks.open({ sessionId: "session", questions: [{ id: "q", question: "Which?", options: [] }] });
    expect(() => asks.submit("session", "ask-1", { answers: [] })).toThrow("disk full");
    expect(asks.pendingAsk("session")?.askId).toBe("ask-1");
  });
  it("keeps a chat response outstanding until the actual user message is recorded", () => {
    const entries: unknown[] = [];
    const asks = new SessionAsks({ readResponse: () => responseFromBranch(entries), appendEvent: (_id, data) => { entries.push({ type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data }); } });
    asks.open({ sessionId: "session", questions: [{ id: "q", question: "Which?", options: [] }] });
    asks.voidForChatReply("session");
    expect(responseFromBranch(entries).pendingAsk).toBeUndefined();
    expect(responseFromBranch(entries).response.kind).toBe("needs-response");
    entries.push({ type: "message", message: { role: "user", content: "Here" } });
    expect(responseFromBranch(entries).response.kind).toBe("none");
  });
});
