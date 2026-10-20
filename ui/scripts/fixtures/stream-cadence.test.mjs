import { describe, expect, it } from "vitest";
import { nextTick, parseStreamArgs, STREAM_PREFIX, streamPlan } from "./stream-cadence.mjs";

describe("controlled stream cadence", () => {
  it("keeps the existing unbounded 1 Hz default", () => {
    const plan = parseStreamArgs([]);
    expect(plan).toMatchObject({ cadence: "1hz", intervalMs: 1000, tokensPerTick: 1, tokens: null, finalText: null });
    expect(nextTick(plan, 10_000)).toEqual(["."]);
  });

  it("plans exact bounded 30 Hz and burst sequences with the committed final content", () => {
    const fast = parseStreamArgs(["--stream-cadence=30hz", "--stream-tokens=3"]);
    expect(fast.intervalMs).toBe(33);
    expect([nextTick(fast, 0), nextTick(fast, 2), nextTick(fast, 3)]).toEqual([["."], ["."], []]);
    expect(fast.finalText).toBe(`${STREAM_PREFIX}...`);
    const burst = streamPlan("burst", 60);
    const ticks = [];
    for (let sent = 0, tick = nextTick(burst, 0); tick.length > 0; sent += tick.length, tick = nextTick(burst, sent)) ticks.push(tick.length);
    expect(ticks).toEqual([25, 25, 10]);
    expect(burst.finalText).toBe(STREAM_PREFIX + ".".repeat(60));
  });

  it("rejects unknown cadences and unbounded or invalid token counts", () => {
    expect(() => streamPlan("60hz", 1)).toThrow("Unknown stream cadence");
    for (const tokens of [0, 2001, 1.5, Number.NaN]) expect(() => streamPlan("30hz", tokens)).toThrow("Stream tokens");
  });
});
