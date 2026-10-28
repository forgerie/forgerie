import { describe, expect, it } from "vitest";
import { childModelCooldown, childModelResetTime, classifyChildModelError, planChildModelFailure, unavailableChildModel } from "./childModelFailures.js";

describe("child model failures", () => {
  it.each([
    "insufficient_quota 503", "quota exceeded 429", "billing exhausted", "out of credits", "enforced_spend_limit_reached", "usage limit reached",
    "You have hit your ChatGPT usage limit (plus plan).", "usage_limit_reached", "You have hit your ChatGPT usage limit. Try again in ~17 min.", "Server requested 120s retry delay (max: 60s)",
    "Model old/gone is not available", "model not found", "model_not_found", "The model does not exist", "unknown model: old", "Invalid API key", "Invalid credentials", "Incorrect API key provided",
  ])("switches now for %s", (text) => { expect(classifyChildModelError(text)).toBe("switch-now"); });
  it.each(["rate_limit_error", "HTTP 429", "overloaded", "529", "HTTP 503 unavailable", "auth_unavailable", "WebSocket closed", "stream disconnected", "connection reset", "socket hang up", "fetch failed", "network error", "timeout", "EAI_AGAIN", "ECONNRESET", "upstream connect error"])("waits then switches for %s", (text) => { expect(classifyChildModelError(text)).toBe("wait-then-switch"); });
  it.each(["Context window limit overloaded", "too many tokens 429", "unexpected response", "Server requested 60s retry delay (max: 60s)"])("reports fatal %s", (text) => { expect(classifyChildModelError(text)).toBe("fatal"); });
  it.each([
    ["Try again in ~17 min", 1_020_000], ["Server requested 120s retry delay (max: 60s)", 120_000],
    ["HTTP 429 Retry-After: 90", 90_000], ["retry-after: 1.5 seconds", 1500],
  ])("reads the reset in %s", (text, delay) => { expect(childModelResetTime(text, 1000)).toBe(1000 + delay); });
  it("reads an HTTP date and rejects missing reset text", () => {
    expect(childModelResetTime("Retry-After: Wed, 21 Oct 2015 07:28:00 GMT", 1000)).toBe(Date.parse("2015-10-21T07:28:00Z"));
    expect(childModelResetTime("Retry-After: nonsense", 1000)).toBeUndefined();
    expect(childModelCooldown("429", 1000)).toBe(301000);
    expect(childModelCooldown("billing", 1000)).toBe(3601000);
    expect(childModelCooldown("too many tokens", 1000)).toBeUndefined();
  });
  it("reads the missing model from Durable's terminal task error", () => {
    expect(unavailableChildModel("Model faux/gone is not available")).toBe("faux/gone");
    expect(unavailableChildModel("No model is configured")).toBeUndefined();
    expect(unavailableChildModel("Model invalid is not available")).toBeUndefined();
  });
  it("waits once for 60 seconds then switches", () => {
    const input = { models: ["a/one", "b/two"], current: "a/one", error: "429", now: 1000, cooldowns: {} };
    const first = planChildModelFailure(input); expect(first).toMatchObject({ kind: "retry", delay: 60000 });
    if (first.kind !== "retry") throw new Error("Expected retry");
    expect(planChildModelFailure({ ...input, progress: first.progress })).toMatchObject({ kind: "switch", to: "b/two" });
  });
  it("keeps the single-model transient schedule", () => {
    let progress;
    for (const delay of [30000, 120000, 300000, undefined]) {
      const plan = planChildModelFailure({ models: ["a/one"], current: "a/one", error: "429", now: 0, cooldowns: {}, ...(progress === undefined ? {} : { progress }) });
      if (plan.kind === "retry") { expect(plan.delay).toBe(delay); progress = plan.progress; } else expect(delay).toBeUndefined();
    }
    expect(planChildModelFailure({ models: ["a/one"], current: "a/one", error: "quota", now: 0, cooldowns: {} })).toEqual({ kind: "report" });
  });
});
