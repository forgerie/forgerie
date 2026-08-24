// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptLivenessView } from "./TranscriptLivenessView";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function mount(options: {
  startedAt: string;
  lastActivityAt?: string;
  step?: string;
  stuckAfterMs?: number;
  onStop?: () => void;
}): Promise<TranscriptLivenessView> {
  const view = new TranscriptLivenessView();
  view.startedAt = options.startedAt;
  view.lastActivityAt = options.lastActivityAt ?? options.startedAt;
  view.step = options.step ?? "bash npm run verify";
  view.stuckAfterMs = options.stuckAfterMs ?? 60_000;
  if (options.onStop !== undefined) view.onStop = options.onStop;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function text(view: TranscriptLivenessView): string {
  return (view.shadowRoot?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("TranscriptLivenessView step clock", () => {
  it("times the current step from its own start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:00:31.000Z");
    const view = await mount({ startedAt: "2026-08-24T11:00:00.000Z" });

    expect(text(view)).toContain("31s · bash npm run verify");
    expect(view.shadowRoot?.querySelector(".stuck")).toBeNull();
  });

  it("stays quiet when the step is old but activity is recent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:02:00.000Z");
    const view = await mount({
      startedAt: "2026-08-24T11:00:00.000Z",
      lastActivityAt: "2026-08-24T11:01:45.000Z",
    });

    expect(text(view)).toContain("2m · bash npm run verify");
    expect(view.shadowRoot?.querySelector(".stuck")).toBeNull();
  });

  it("shows measured silence and Stop after both clocks exceed the beat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:04:00.000Z");
    const onStop = vi.fn();
    const view = await mount({
      startedAt: "2026-08-24T11:00:00.000Z",
      lastActivityAt: "2026-08-24T11:00:00.000Z",
      onStop,
    });

    expect(text(view)).toContain("No activity for 4m");
    const stop = view.shadowRoot?.querySelector("button.stop");
    if (!(stop instanceof HTMLButtonElement)) throw new Error("The stuck row rendered no Stop action");
    stop.click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("does not offer Stop when the caller has no stop capability", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:04:00.000Z");
    const view = await mount({
      startedAt: "2026-08-24T11:00:00.000Z",
      lastActivityAt: "2026-08-24T11:00:00.000Z",
    });

    expect(text(view)).toContain("No activity for 4m");
    expect(view.shadowRoot?.querySelector("button.stop")).toBeNull();
  });
});
