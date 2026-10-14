import { describe, expect, expectTypeOf, it } from "vitest";
import { sessionHistoryPageSchema, sessionOpenSchema, type PiMessage, type SessionHistoryPage, type SessionOpen, type SessionStatus } from "./contracts";
import type { EarlierHistory } from "./historyPaging";

const response = {
  session: { id: "session", cwd: "/workspace" }, readPath: "native", epoch: "daemon", seq: 9, historyId: "history",
  page: { messages: [{ role: "user", content: "Last turn", timestamp: 123 }], start: 40, total: 41 },
  snapshot: { seq: 9, partial: { role: "assistant", content: [{ type: "text", text: "Working" }] },
    tools: [{ toolCallId: "call", toolName: "read", status: "running", output: "Partial output" }], transientEvents: [] },
  status: { isStreaming: true, isCompacting: false, isBashRunning: false,
    pendingAsk: { askId: "ask", askedAt: "2026-10-14T12:00:00Z", questions: [{ id: "question", question: "Proceed?", options: [] }] } },
  receipt: { catalogId: "catalog", throughCompletionOrder: 7 },
};

describe("browser open contract", () => {
  it("retains existing message, ask, tools and status contracts in one envelope", () => {
    const open = sessionOpenSchema.parse(response);
    expect(open.page.messages[0]?.content).toBe("Last turn");
    expect(open.status.pendingAsk?.askId).toBe("ask");
    expect(open.status.queuedMessages).toEqual([]);
    expect(open.snapshot.tools[0]?.output).toBe("Partial output");
    expect(open.receipt?.throughCompletionOrder).toBe(7);
    expectTypeOf<SessionOpen["page"]["messages"]>().toEqualTypeOf<PiMessage[]>();
    expectTypeOf<SessionOpen["status"]>().toEqualTypeOf<SessionStatus>();
  });
  it("refuses a status/partial envelope from a different watermark", () => {
    expect(sessionOpenSchema.safeParse({ ...response, snapshot: { ...response.snapshot, seq: 10 } }).success).toBe(false);
  });
  it("reads older pages with the shared history identity", () => {
    const page: SessionHistoryPage = sessionHistoryPageSchema.parse({ ...response.page, historyId: response.historyId, epoch: response.epoch, seq: response.seq });
    expect(page.start).toBe(40);
    expect(page.historyId).toBe("history");
  });
  it("declares the four presentation states without fetching or rendering", () => {
    const states: EarlierHistory[] = [{ type: "complete" }, { type: "available" }, { type: "loading" }, { type: "failed", message: "Read failed" }];
    expect(states.map(state => state.type)).toEqual(["complete", "available", "loading", "failed"]);
  });
});
