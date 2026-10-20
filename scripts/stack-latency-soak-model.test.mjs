import { describe, expect, it } from "vitest";
import { plateau, soakOptions, soakPhase } from "./stack-latency-soak-model.mjs";

const base = ["--fixture=/tmp/fg-native-soak/fixture.json", "--output=/tmp/fg-soak-out"];

describe("soak arguments", () => {
  it("defaults to a bounded eight-hour controlled run", () => {
    expect(soakOptions(base)).toMatchObject({ durationMin: 480, warmupMin: 30, blockMin: 20, sampleSec: 60 });
  });
  it("refuses unbounded, live or ambiguous inputs", () => {
    expect(() => soakOptions(["--output=/tmp/x"])).toThrow("--fixture");
    expect(() => soakOptions(["--fixture=/home/live/fixture.json", "--output=/tmp/x"])).toThrow("--fixture");
    expect(() => soakOptions([base[0], "--output=/home/x"])).toThrow("--output");
    expect(() => soakOptions([...base, "--duration-min=481"])).toThrow("durationMin");
    expect(() => soakOptions([...base, "--duration-min=10", "--warmup-min=10"])).toThrow("Warm-up");
    expect(() => soakOptions([...base, "--sample-sec=1"])).toThrow("sampleSec");
  });
});

describe("soak phases", () => {
  it("warms up, then repeats quiet, load and reconnect", () => {
    const options = { warmupMin: 30, blockMin: 20 };
    expect([0, 29.9, 30, 37.9, 38, 47.9, 48, 49.9, 50].map(minute => soakPhase(minute, options)))
      .toEqual(["warmup", "warmup", "quiet", "quiet", "load", "load", "reconnect", "reconnect", "quiet"]);
  });
});

describe("plateau verdicts", () => {
  const series = shape => Array.from({ length: 200 }, (_, minute) => ({ elapsedMin: minute, heap: shape(minute) }));
  it("reports a flat post-warm-up series as a plateau and ignores warm-up growth", () => {
    expect(plateau(series(minute => minute < 30 ? minute * 10 : 300 + (minute % 3)), "heap", { warmupMin: 30 }).verdict).toBe("plateau");
  });
  it("reports sustained growth as rising, not as a proven leak", () => {
    expect(plateau(series(minute => 100 + minute), "heap", { warmupMin: 30 })).toMatchObject({ verdict: "rising" });
  });
  it("refuses a verdict for short series", () => {
    expect(plateau(series(() => 1).slice(0, 60), "heap", { warmupMin: 30 }).verdict).toBe("insufficient");
  });
});
