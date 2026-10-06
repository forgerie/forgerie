import { describe, expect, it } from "vitest";
import { compactContextWindow, modelCommandQuery, modelGroups, modelLabel, providerLabel, thinkingLabel, type SessionModel } from "./modelChoice";

const opus: SessionModel = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true, scoped: true };
const flash: SessionModel = { provider: "cliproxyapi", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", contextWindow: 1_048_576, reasoning: true, scoped: true };
const haiku: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true };
const alias: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", contextWindow: 200_000, reasoning: true };
const codex: SessionModel = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272_000, reasoning: false };

describe("model groups", () => {
  it("puts Pi's enabled models first as one named set, naming their provider", () => {
    const groups = modelGroups([opus, haiku, flash]);
    expect(groups.map((group) => group.label)).toEqual(["Enabled models", "Anthropic"]);
    expect(groups[0]!.rows.map((row) => row.key)).toEqual(["cliproxyapi/claude-opus-5-5", "cliproxyapi/gemini-3.8-flash"]);
    expect(groups[0]!.rows[0]).toMatchObject({ providerName: "Cliproxyapi", context: "1m" });
    expect(groups[1]!.rows[0]!.providerName).toBeUndefined();
    expect(groups[1]!.rows[0]!.context).toBe("200k");
  });

  it("keeps the server's order, so a later run of a provider is its own group", () => {
    const groups = modelGroups([haiku, codex, alias]);
    expect(groups.map((group) => group.label)).toEqual(["Anthropic", "Openai Codex", "Anthropic"]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });

  it("tells an alias apart from its dated snapshot, and marks models without reasoning", () => {
    const [group] = modelGroups([haiku, alias]);
    expect(group!.rows.map((row) => [row.label, row.variant])).toEqual([["Claude Haiku 4.5", "2025-10-01"], ["Claude Haiku 4.5", "latest"]]);
    expect(modelGroups([codex])[0]!.rows[0]!.plain).toBe(true);
  });

  it("filters by name, ID, or provider, and leaves out models it cannot pick", () => {
    expect(modelGroups([opus, haiku, codex], "codex").flatMap((group) => group.rows.map((row) => row.id))).toEqual(["gpt-5.6-sol"]);
    expect(modelGroups([opus, haiku, codex], "HAIKU").flatMap((group) => group.rows.map((row) => row.id))).toEqual(["claude-haiku-4-5-20251001"]);
    expect(modelGroups([opus, haiku], "openai")).toEqual([]);
    expect(modelGroups([{ name: "Unnamed" }, { provider: "x" }])).toEqual([]);
  });
});

describe("labels", () => {
  it("states context windows in k and m, with a decimal only below ten", () => {
    expect(compactContextWindow(8_192)).toBe("8.2k");
    expect(compactContextWindow(286_384)).toBe("286k");
    expect(compactContextWindow(1_048_576)).toBe("1m");
    expect(compactContextWindow(0)).toBeUndefined();
  });

  it("names a session without a model, and reads provider and level IDs as words", () => {
    expect(modelLabel(undefined)).toBe("No model");
    expect(modelLabel({ provider: "a", id: "raw-id" })).toBe("raw-id");
    expect(providerLabel("openai-codex")).toBe("Openai Codex");
    expect(thinkingLabel("xhigh")).toBe("Extra high");
    expect(thinkingLabel("custom")).toBe("custom");
  });
});

describe("/model", () => {
  it("opens the picker with any text after the command as its search", () => {
    expect(modelCommandQuery("/model")).toBe("");
    expect(modelCommandQuery("  /model  opus ")).toBe("opus");
    expect(modelCommandQuery("/models")).toBeUndefined();
    expect(modelCommandQuery("use /model")).toBeUndefined();
  });
});
