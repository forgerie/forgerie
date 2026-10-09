import { describe, expect, it } from "vitest";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { KNOWN_THINKING_LEVELS, isKnownThinkingLevel, parseModelReference, thinkingLevelLabel } from "./thinkingLevels";

// Compile-time drift guard: if pi ADDS a thinking level we do not know about,
// `Extra` becomes that level and this assignment fails to type-check. Combined
// with the `satisfies readonly ThinkingLevel[]` clause in thinkingLevels.ts
// (which catches removals/renames), this pins KNOWN_THINKING_LEVELS to pi's
// union exactly. When this breaks, update KNOWN_THINKING_LEVELS and give the new
// level a label/description where thinking levels are presented.
type Extra = Exclude<ThinkingLevel, (typeof KNOWN_THINKING_LEVELS)[number]>;
const _noUnknownLevels: Extra extends never ? true : never = true;
void _noUnknownLevels;

describe("parseModelReference", () => {
  it("splits a known level off the end, including max", () => {
    expect(parseModelReference("anthropic/claude-opus:high")).toEqual({ model: "anthropic/claude-opus", thinkingLevel: "high" });
    expect(parseModelReference("openai/gpt-5:max")).toEqual({ model: "openai/gpt-5", thinkingLevel: "max" });
    expect(parseModelReference("openai/gpt-5:off")).toEqual({ model: "openai/gpt-5", thinkingLevel: "off" });
  });
  it("keeps a colon that is part of the model ID", () => {
    expect(parseModelReference("local/llama3:8b")).toEqual({ model: "local/llama3:8b" });
    expect(parseModelReference("local/llama3:8b:low")).toEqual({ model: "local/llama3:8b", thinkingLevel: "low" });
    expect(parseModelReference("anthropic/claude-opus")).toEqual({ model: "anthropic/claude-opus" });
  });
});

describe("thinkingLevels", () => {
  it("recognizes all known levels and rejects others", () => {
    for (const level of KNOWN_THINKING_LEVELS) expect(isKnownThinkingLevel(level)).toBe(true);
    expect(isKnownThinkingLevel("ultra")).toBe(false);
    expect(isKnownThinkingLevel("")).toBe(false);
  });

  it("labels levels, defaulting empty/undefined to off", () => {
    expect(thinkingLevelLabel(undefined)).toBe("off");
    expect(thinkingLevelLabel("")).toBe("off");
    expect(thinkingLevelLabel("high")).toBe("high");
    expect(thinkingLevelLabel("brand-new-level")).toBe("brand-new-level");
  });
});
