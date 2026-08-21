import { describe, expect, it } from "vitest";
import { formatElapsed, latestToolStep, livenessPhase, livenessStep, replyIsStreaming } from "./chatLiveness";
import { elapsedSince } from "./sessionWorkingRuntime";
import type { SessionActivity } from "./api";
import type { ChatLine, ChatPart } from "./components/shared";

const line = (role: ChatLine["role"], parts: ChatPart[]): ChatLine => ({ role, parts });
const toolCall = (toolName: string, summary: string): ChatPart => ({ type: "toolCall", toolName, summary });

const activity = (fields: Partial<SessionActivity>): SessionActivity => ({
  sessionId: "s1",
  phase: "active",
  label: "running",
  at: "2026-08-10T00:00:00.000Z",
  ...fields,
});

describe("formatElapsed", () => {
  it("counts seconds within the first minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(12_400)).toBe("12s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("drops to whole minutes once past a minute", () => {
    expect(formatElapsed(60_000)).toBe("1m");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59m");
  });

  it("reports hours and minutes for long runs", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1h 0m");
    expect(formatElapsed(154 * 60_000)).toBe("2h 34m");
  });

  it("treats a clock that moved backwards as no time elapsed", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});

describe("latestToolStep", () => {
  it("names the newest tool call, scanning backwards", () => {
    const messages = [
      line("assistant", [toolCall("read", "src/a.ts")]),
      line("assistant", [toolCall("grep", "writeCatalog"), toolCall("read", "archive.ts")]),
    ];
    expect(latestToolStep(messages)).toBe("read archive.ts");
  });

  it("falls back to the tool name when it carries no summary", () => {
    expect(latestToolStep([line("assistant", [toolCall("bash", "  ")])])).toBe("bash");
  });

  it("clamps a long summary, because the line is a glance not a record", () => {
    const command = "cd /home/simonwjackson/code/sandbox/forgerie && ./scripts/run-everything.sh --verbose";
    const step = latestToolStep([line("assistant", [toolCall("bash", command)])]);
    expect(step?.length).toBeLessThanOrEqual(44);
    expect(step?.endsWith("…")).toBe(true);
    expect(step?.startsWith("bash cd /home/simonwjackson")).toBe(true);
  });

  it("collapses whitespace so a multi-line command stays on one line", () => {
    expect(latestToolStep([line("assistant", [toolCall("bash", "echo one\n  echo two")])])).toBe("bash echo one echo two");
  });

  it("reports nothing when the transcript holds no tool calls", () => {
    expect(latestToolStep([line("user", [{ type: "text", text: "hello" }])])).toBeUndefined();
    expect(latestToolStep([])).toBeUndefined();
  });
});

describe("livenessStep", () => {
  it("prefers the newest tool call over the activity feed's transport wording", () => {
    const messages = [line("assistant", [toolCall("read", "archive.ts")])];
    expect(livenessStep(messages, activity({ label: "tool execution update" }), "busy")).toBe("read archive.ts");
  });

  it("uses the activity detail when no tool call is in the transcript", () => {
    expect(livenessStep([], activity({ label: "running", detail: "read archive.ts" }), "busy")).toBe("read archive.ts");
  });

  it("falls back to the label when there is no detail", () => {
    expect(livenessStep([], activity({ label: "compacting" }), "busy")).toBe("compacting");
  });

  it("ignores blank detail and label", () => {
    expect(livenessStep([], activity({ label: "  ", detail: "  " }), "busy")).toBe("busy");
  });

  it("falls back to the status text when no activity is published", () => {
    expect(livenessStep([], undefined, "  Sending your message…  ")).toBe("Sending your message…");
  });
});

describe("replyIsStreaming", () => {
  const input = (overrides: Partial<Parameters<typeof replyIsStreaming>[0]> = {}) => ({
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    awaitingUserInput: false,
    activity: undefined,
    ...overrides,
  });

  it("keeps active assistant message delivery interim", () => {
    expect(replyIsStreaming(input({ activity: activity({ label: "message started" }) }))).toBe(true);
    expect(replyIsStreaming(input({ activity: activity({ label: "receiving response" }) }))).toBe(true);
  });

  it("settles the reply when later work or user input starts", () => {
    expect(replyIsStreaming(input({ activity: activity({ label: "running tool" }) }))).toBe(false);
    expect(replyIsStreaming(input({ isCompacting: true }))).toBe(false);
    expect(replyIsStreaming(input({ isBashRunning: true }))).toBe(false);
    expect(replyIsStreaming(input({ awaitingUserInput: true }))).toBe(false);
  });

  it("uses streaming status when no activity event is available", () => {
    expect(replyIsStreaming(input())).toBe(true);
    expect(replyIsStreaming(input({ isStreaming: false }))).toBe(false);
  });

  it("settles the reply after the assistant message completes", () => {
    expect(replyIsStreaming(input({ activity: activity({ phase: "idle", label: "message complete" }) }))).toBe(false);
  });
});

describe("livenessPhase", () => {
  it("names compaction as its own stretch of work", () => {
    expect(livenessPhase({ isCompacting: true, indicatorActive: true })).toBe("compacting");
  });

  it("names a running turn as work", () => {
    expect(livenessPhase({ isCompacting: false, indicatorActive: true })).toBe("working");
  });

  it("reports compaction even when the activity feed has gone quiet", () => {
    expect(livenessPhase({ isCompacting: true, indicatorActive: false })).toBe("compacting");
  });

  it("reports no phase when the session is idle", () => {
    expect(livenessPhase({ isCompacting: false, indicatorActive: false })).toBeUndefined();
  });
});

describe("elapsedSince", () => {
  it("measures from the reported start", () => {
    expect(elapsedSince("2026-08-10T00:00:00.000Z", Date.parse("2026-08-10T00:00:12.000Z"))).toBe(12_000);
  });

  it("clamps a start in the future to zero", () => {
    expect(elapsedSince("2026-08-10T00:00:30.000Z", Date.parse("2026-08-10T00:00:00.000Z"))).toBe(0);
  });

  it("reports nothing when the start is missing or unparseable", () => {
    expect(elapsedSince(undefined, 0)).toBeUndefined();
    expect(elapsedSince("", 0)).toBeUndefined();
    expect(elapsedSince("not a date", 0)).toBeUndefined();
  });
});
