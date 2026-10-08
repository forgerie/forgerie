import { describe, expect, it } from "vitest";
import { BOARD_GROUPS, sessionBoardState } from "./sessionBoard.js";
import type { SessionResponse } from "../../shared/sessionResponse.js";

const response: SessionResponse = { kind: "needs-response", reason: "reply" };
const session = { id: "s", modified: "2026-10-07T00:00:00Z", response };
const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
describe("Needs your response", () => {
  it("uses one category for plain replies and forms, with the new label", () => {
    expect(BOARD_GROUPS.find((group) => group.kind === "blocked")?.label).toBe("Needs your response");
    expect(sessionBoardState(session, { isUnread: true }).kind).toBe("blocked");
    expect(sessionBoardState(session, { isUnread: false }).kind).toBe("blocked");
  });
  it("lets live working state take priority over the conservative undeclared request", () => {
    expect(sessionBoardState(session, { status: { ...idle, isStreaming: true, response: { kind: "needs-response", reason: "undeclared" } } }).kind).toBe("working");
  });
  it("uses live declarations rather than stale catalog snapshots", () => {
    expect(sessionBoardState(session, { status: { ...idle, response: { kind: "none" } }, isUnread: true }).kind).toBe("unread");
  });
  it("does not restore a closed form from a stale catalog snapshot", () => {
    expect(sessionBoardState({ ...session, pendingAsk: { questions: [{ question: "Choose" }] } }, { status: { ...idle, response: { kind: "none" } } }).kind).toBe("open");
  });
});
