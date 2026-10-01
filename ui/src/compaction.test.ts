import { describe, expect, it } from "vitest";
import { idleCompaction, isCompactCommand, compactionFromStatus, compactionFromOutput } from "./compaction";
import { parseEvent, statusSchema } from "./contracts";

const idle = statusSchema.parse({ isStreaming: false, isCompacting: false, isBashRunning: false });
const queued = { ...idle, isStreaming: true, queuedMessages: [{ kind: "followUp" as const, text: "/compact keep decisions" }] };

describe("server-owned compaction", () => {
  it("recognizes only a leading compact command, including custom instructions", () => {
    expect(isCompactCommand("/compact keep decisions")).toBe(true);
    expect(isCompactCommand("/compact\nkeep decisions")).toBe(true);
    for (const text of ["/compactly", " /compact", "explain /compact"]) expect(isCompactCommand(text)).toBe(false);
  });
  it("derives queued and running states from status, never from activity wording", () => {
    expect(compactionFromStatus(idleCompaction, queued)).toEqual({ type: "queued", text: "/compact keep decisions" });
    expect(compactionFromStatus(idleCompaction, { ...queued, isCompacting: true })).toEqual({ type: "running" });
    expect(compactionFromStatus(idleCompaction, { ...idle, queuedMessages: [{ kind: "steer", text: "/compact" }] })).toEqual(idleCompaction);
  });
  it("does not call a missed completion successful and keeps the receipt across idle updates", () => {
    const state = compactionFromStatus({ type: "running" }, idle);
    expect(state).toMatchObject({ type: "finished", outcome: "unknown" });
    expect(compactionFromStatus(state, idle)).toEqual(state);
  });
  it.each([
    ["success", "Compaction complete.\nTokens before: 123\n\nSummary", "complete"],
    ["info", "Compaction cancelled.", "cancelled"],
    ["error", "Compaction failed: Model unavailable", "failed"],
    ["error", "Queued compaction failed to start: Session changed", "failed"],
  ] as const)("records %s completion feedback without stripping its details", (level, message, outcome) => {
    const state = compactionFromOutput({ type: "command.output", level, message });
    expect(state).toEqual({ type: "finished", outcome, message });
    expect(compactionFromStatus(state!, idle)).toEqual(state);
    expect(compactionFromStatus(state!, queued)).toEqual({ type: "queued", text: "/compact keep decisions" });
  });
  it("does not confuse other commands or a quoted compaction phrase with completion", () => {
    expect(compactionFromOutput({ type: "command.output", level: "info", message: "Session created" })).toBeUndefined();
    expect(compactionFromOutput({ type: "command.output", level: "info", message: "Help: Compaction complete." })).toBeUndefined();
  });
  it("validates live status and output while still ignoring unknown event kinds", () => {
    expect(parseEvent({ type: "status.update", status: queued, seq: 4 })).toMatchObject({ type: "status.update", status: queued, seq: 4 });
    expect(parseEvent({ type: "command.output", level: "success", message: "Compaction complete.", seq: 5 })).toMatchObject({ type: "command.output" });
    expect(() => parseEvent({ type: "command.output", level: "bad", message: "bad" })).toThrow();
    expect(parseEvent({ type: "extension.custom", seq: 6 })).toBeUndefined();
  });
});
