// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { ContextUsageMeter } from "./ContextUsageMeter";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ContextUsageMeter", () => {
  it("shows the session context fill and exact token usage", async () => {
    const meter = new ContextUsageMeter();
    meter.contextUsage = { tokens: 124_800, contextWindow: 200_000, percent: 62.4 };
    document.body.append(meter);

    await meter.updateComplete;

    const progress = meter.shadowRoot?.querySelector<HTMLElement>("[role=progressbar]");
    expect(progress?.getAttribute("aria-valuenow")).toBe("62.4");
    expect(progress?.getAttribute("aria-label")).toBe("Context usage: 62.4% · 124,800 of 200,000 tokens");
    expect(progress?.getAttribute("style")).toContain("--context-usage:62.40%");
  });

  it("reports an unavailable measurement without presenting zero as current usage", async () => {
    const meter = new ContextUsageMeter();
    meter.contextUsage = { tokens: null, contextWindow: 200_000, percent: null };
    document.body.append(meter);

    await meter.updateComplete;

    const progress = meter.shadowRoot?.querySelector<HTMLElement>("[role=progressbar]");
    expect(progress?.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress?.getAttribute("aria-label")).toBe("Context usage unavailable · 200k-token context window");
    expect(progress?.classList.contains("unknown")).toBe(true);
  });
});
