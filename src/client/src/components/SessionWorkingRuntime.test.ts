// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWorkingRuntime, workingRuntimeLabel } from "../sessionWorkingRuntime";
import { SessionWorkingRuntime } from "./SessionWorkingRuntime";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
});

function shadowRoot(runtime: SessionWorkingRuntime): ShadowRoot {
  const root = runtime.shadowRoot;
  if (root === null) throw new Error("No shadow root");
  return root;
}

describe("formatWorkingRuntime", () => {
  it("never shows seconds", () => {
    expect(formatWorkingRuntime(0)).toBe("<1m");
    expect(formatWorkingRuntime(59_999)).toBe("<1m");
    expect(formatWorkingRuntime(60_000)).toBe("1m");
  });

  it("keeps hours precise to the minute", () => {
    expect(formatWorkingRuntime(60 * 60_000)).toBe("1h");
    expect(formatWorkingRuntime(61 * 60_000)).toBe("1h 1m");
    expect(formatWorkingRuntime(154 * 60_000)).toBe("2h 34m");
  });

  it("names the runtime without abbreviations for assistive technology", () => {
    expect(workingRuntimeLabel(0)).toBe("Working for less than 1 minute");
    expect(workingRuntimeLabel(60_000)).toBe("Working for 1 minute");
    expect(workingRuntimeLabel(154 * 60_000)).toBe("Working for 2 hours 34 minutes");
  });
});

describe("SessionWorkingRuntime", () => {
  it("updates at the next minute without ticking through seconds", async () => {
    vi.useFakeTimers();
    const startedAt = "2026-08-11T10:00:00.000Z";
    vi.setSystemTime("2026-08-11T10:00:59.500Z");

    const runtime = new SessionWorkingRuntime();
    runtime.startedAt = startedAt;
    document.body.append(runtime);
    await runtime.updateComplete;

    expect(shadowRoot(runtime).textContent.trim()).toBe("<1m");
    // No clock glyph: the pulsing row marker already carries "working".
    expect(shadowRoot(runtime).querySelector("[data-runtime-clock]")).toBeNull();
    expect(shadowRoot(runtime).querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("Working for less than 1 minute");

    await vi.advanceTimersByTimeAsync(500);
    await runtime.updateComplete;

    expect(shadowRoot(runtime).textContent.trim()).toBe("1m");
    expect(shadowRoot(runtime).querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("Working for 1 minute");
  });
});
