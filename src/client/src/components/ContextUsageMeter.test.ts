// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_USAGE_VISIBLE_PERCENT, ContextUsageMeter, contextUsageWorthShowing } from "./ContextUsageMeter";

afterEach(() => {
  document.body.replaceChildren();
});

describe("contextUsageWorthShowing", () => {
  it("holds the meter back until context use reaches the visible threshold", () => {
    expect(contextUsageWorthShowing(usage(CONTEXT_USAGE_VISIBLE_PERCENT - 0.1))).toBe(false);
    expect(contextUsageWorthShowing(usage(CONTEXT_USAGE_VISIBLE_PERCENT))).toBe(true);
    expect(contextUsageWorthShowing(usage(97.5))).toBe(true);
  });

  it("treats a missing or unusable measurement as nothing to show", () => {
    expect(contextUsageWorthShowing(undefined)).toBe(false);
    expect(contextUsageWorthShowing({ tokens: null, contextWindow: 1_000_000, percent: null })).toBe(false);
    expect(contextUsageWorthShowing(usage(Number.NaN))).toBe(false);
  });
});

describe("ContextUsageMeter", () => {
  it("draws the used fraction and reports exact token usage once past the threshold", async () => {
    const meter = new ContextUsageMeter();
    meter.contextUsage = { tokens: 720_000, contextWindow: 1_000_000, percent: 72 };
    document.body.append(meter);

    await meter.updateComplete;

    const progress = meter.shadowRoot?.querySelector<HTMLElement>("[role=progressbar]");
    expect(progress?.getAttribute("aria-valuenow")).toBe("72");
    expect(progress?.getAttribute("aria-label")).toBe("Context usage: 72.0% · 720,000 of 1,000,000 tokens");
    expect(progress?.getAttribute("style")).toContain("--context-usage:72.00%");
  });

  it("renders nothing at all while context use is unremarkable", async () => {
    const meter = new ContextUsageMeter();
    meter.contextUsage = { tokens: 392_778, contextWindow: 1_000_000, percent: 39.2778 };
    document.body.append(meter);

    await meter.updateComplete;

    expect(meter.shadowRoot?.querySelector("[role=progressbar]")).toBeNull();
  });
});

function usage(percent: number) {
  return { tokens: 500_000, contextWindow: 1_000_000, percent };
}
