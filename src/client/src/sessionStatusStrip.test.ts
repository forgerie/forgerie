import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "./api";
import { sessionActivityIndicator } from "./sessionStatusStrip";

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function activity(overrides: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId: "session-1",
    phase: "idle",
    label: "idle",
    at: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("sessionActivityIndicator", () => {
  it("reports an idle session as inactive so the strip stays quiet", () => {
    expect(sessionActivityIndicator({ status: status() })).toEqual({ text: "idle", active: false });
  });

  it("prioritises the optimistic sending state over server status", () => {
    expect(sessionActivityIndicator({ status: status({ isStreaming: true }), isSendingPrompt: true })).toEqual({
      text: "Sending your message…",
      active: true,
    });
  });

  it("derives the active work state from status in precedence order", () => {
    expect(sessionActivityIndicator({ status: status({ isCompacting: true, isBashRunning: true, isStreaming: true }) })?.text).toBe("compacting");
    expect(sessionActivityIndicator({ status: status({ isBashRunning: true, isStreaming: true }) })?.text).toBe("bash");
    expect(sessionActivityIndicator({ status: status({ isStreaming: true }) })?.text).toBe("running");
    expect(sessionActivityIndicator({ status: status({ pendingMessageCount: 2 }) })?.text).toBe("queued");
    expect(sessionActivityIndicator({ status: status({ isStreaming: true }) })?.active).toBe(true);
  });

  it("prefers the richer activity label and detail while work is active", () => {
    const indicator = sessionActivityIndicator({
      status: status(),
      activity: activity({ phase: "active", label: "Reading files", detail: "src/index.ts" }),
    });

    expect(indicator).toEqual({ text: "Reading files: src/index.ts", active: true });
  });

  it("keeps the status-derived word when the activity feed has gone idle behind it", () => {
    const indicator = sessionActivityIndicator({
      status: status({ isStreaming: true }),
      activity: activity({ phase: "idle", label: "stale" }),
    });

    expect(indicator).toEqual({ text: "running", active: true });
  });

  it("falls back to the activity label before any status arrives", () => {
    expect(sessionActivityIndicator({ activity: activity({ label: "starting" }) })).toEqual({ text: "starting", active: true });
    expect(sessionActivityIndicator({ activity: activity({ label: "idle" }) })).toEqual({ text: "idle", active: false });
    expect(sessionActivityIndicator({})).toBeUndefined();
  });
});
