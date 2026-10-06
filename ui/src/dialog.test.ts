import { describe, expect, it } from "vitest";
import { dialogCountdown, dialogInputProblem, noDialogPhase, phaseFor } from "./dialog";

describe("dialog countdown", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("states the time left in seconds, minutes, or hours", () => {
    expect(dialogCountdown("2026-10-05T12:00:42Z", now)).toBe("Closes in 42s");
    expect(dialogCountdown("2026-10-05T12:04:05Z", now)).toBe("Closes in 4m 5s");
    expect(dialogCountdown("2026-10-05T13:59:59Z", now)).toBe("Closes in 1h 59m");
  });
  it("says closing at or after the deadline, and nothing without one", () => {
    expect(dialogCountdown("2026-10-05T12:00:00Z", now)).toBe("Closing…");
    expect(dialogCountdown(undefined, now)).toBeUndefined();
    expect(dialogCountdown("not a date", now)).toBeUndefined();
  });
});

describe("dialog phase", () => {
  it("belongs to one dialog, so a newer dialog starts clean", () => {
    const phase = { dialogId: "a", type: "failed" as const, message: "Answer does not fit" };
    expect(phaseFor(phase, "a")).toEqual({ type: "failed", message: "Answer does not fit" });
    expect(phaseFor(phase, "b")).toEqual({ type: "answering" });
    expect(phaseFor(noDialogPhase, "a")).toEqual({ type: "answering" });
  });
});

describe("input answers", () => {
  it("refuses only text longer than the daemon accepts", () => {
    expect(dialogInputProblem("")).toBeUndefined();
    expect(dialogInputProblem("x".repeat(4000))).toBeUndefined();
    expect(dialogInputProblem("x".repeat(4001))).toBe("The answer exceeds 4000 characters. Shorten it before sending.");
  });
});
