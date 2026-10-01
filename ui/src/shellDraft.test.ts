import { describe, expect, it } from "vitest";
import { shellAvailability, shellDraftOf } from "./shellDraft";

describe("shell drafts", () => {
  it("treats a leading ! as a shell command and !! as one excluded from context", () => {
    expect(shellDraftOf("!ls -la")).toEqual({ type: "shell", text: "!ls -la", excludeFromContext: false });
    expect(shellDraftOf("!! git status")).toEqual({ type: "shell", text: "!! git status", excludeFromContext: true });
  });
  it("ignores leading whitespace and sends the trimmed text the server parses", () => {
    expect(shellDraftOf("  \n!echo hi")).toEqual({ type: "shell", text: "!echo hi", excludeFromContext: false });
  });
  it("keeps !@ as the all-file mention trigger and leaves other text as chat", () => {
    for (const text of ["!@src/app.ts explain", "explain !ls", "/compact", "", "  "]) expect(shellDraftOf(text)).toEqual({ type: "chat" });
    expect(shellDraftOf("!!@x")).toMatchObject({ type: "shell", excludeFromContext: true });
  });
  it("names a missing command instead of sending one the server rejects", () => {
    expect(shellDraftOf("!")).toEqual({ type: "empty", excludeFromContext: false });
    expect(shellDraftOf("!!   ")).toEqual({ type: "empty", excludeFromContext: true });
  });
});

describe("shell availability", () => {
  const ready = { connected: true, sending: false, bashRunning: false, compaction: { type: "idle" } as const };
  it("allows a command while idle or during an agent run, which the server accepts", () => {
    expect(shellAvailability(ready)).toEqual({ type: "ready" });
  });
  it("explains each server-side rejection before the request is made", () => {
    expect(shellAvailability({ ...ready, connected: false })).toEqual({ type: "blocked", reason: "Reconnect to run shell commands." });
    expect(shellAvailability({ ...ready, sending: true })).toEqual({ type: "blocked", reason: "Wait for the current request to finish." });
    expect(shellAvailability({ ...ready, bashRunning: true })).toEqual({ type: "blocked", reason: "Wait for the running shell command to finish." });
    for (const type of ["checking", "running"] as const) {
      expect(shellAvailability({ ...ready, compaction: { type } })).toEqual({ type: "blocked", reason: "Shell commands wait until compaction finishes." });
    }
    expect(shellAvailability({ ...ready, compaction: { type: "queued", text: "/compact" } }).type).toBe("blocked");
    expect(shellAvailability({ ...ready, compaction: { type: "finished", outcome: "complete", message: "Compaction complete." } })).toEqual({ type: "ready" });
  });
});
