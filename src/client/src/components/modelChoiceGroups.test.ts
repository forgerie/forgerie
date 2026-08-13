import { describe, expect, it } from "vitest";
import { modelChoiceGroups } from "./modelChoiceGroups";

const fable = { provider: "anthropic", id: "claude-fable-5", name: "Claude Fable 5", contextWindow: 1000000 };
const sol = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272000 };
const opus5 = { provider: "anthropic", id: "claude-opus-5", name: "Claude Opus 5", contextWindow: 1000000 };
const haikuLatest = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", contextWindow: 200000 };
const haikuPinned = { provider: "anthropic", id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200000 };
const gpt55 = { provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5", contextWindow: 272000 };

describe("modelChoiceGroups", () => {
  it("separates the cycling scope from the rest of the catalogue", () => {
    const groups = modelChoiceGroups([
      { ...fable, scoped: true },
      { ...sol, scoped: true },
      { ...opus5, scoped: true },
      haikuLatest,
      gpt55,
    ]);

    expect(groups.map((group) => ({ label: group.label, level: group.level, count: group.count }))).toEqual([
      { label: "Ctrl+P cycle", level: "section", count: 3 },
      { label: "Other models", level: "section", count: 2 },
      { label: "Anthropic", level: "provider", count: undefined },
      { label: "Openai Codex", level: "provider", count: undefined },
    ]);
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "anthropic/claude-fable-5",
      "openai-codex/gpt-5.6-sol",
      "anthropic/claude-opus-5",
    ]);
    // The "Other models" heading owns no rows; its providers carry them.
    expect(groups[1]?.items).toEqual([]);
    expect(groups[2]?.items.map((item) => item.value)).toEqual(["anthropic/claude-haiku-4-5"]);
  });

  it("names the provider on a scoped row, because the scope mixes providers", () => {
    const groups = modelChoiceGroups([{ ...fable, scoped: true }, { ...sol, scoped: true }]);

    expect(groups[0]?.items.map((item) => item.meta)).toEqual(["Anthropic · 1m", "Openai Codex · 272k"]);
  });

  it("states context windows in compact k and m units", () => {
    const groups = modelChoiceGroups([
      haikuLatest,
      { ...opus5, id: "claude-opus-4-7", contextWindow: 286384 },
      { ...gpt55, contextWindow: 1500000 },
      { provider: "aka-llama", id: "qwen", name: "Qwen", contextWindow: 8192 },
      { provider: "aka-llama", id: "nameless" },
    ]);
    const metas = groups.flatMap((group) => group.items.map((item) => item.meta));

    // A decimal only where it carries capacity: 8.2k, but 286k not 286.4k.
    expect(metas).toEqual(["200k", "286k", "1.5m", "8.2k", undefined]);
  });

  it("tells an alias apart from the pinned snapshot behind it", () => {
    const groups = modelChoiceGroups([haikuLatest, haikuPinned]);

    expect(groups[0]?.items.map((item) => ({ label: item.label, variant: item.variant }))).toEqual([
      { label: "Claude Haiku 4.5", variant: "latest" },
      { label: "Claude Haiku 4.5", variant: "2025-10-01" },
    ]);
  });

  it("groups by provider alone when Pi configures no scope", () => {
    const groups = modelChoiceGroups([haikuLatest, gpt55]);

    expect(groups.map((group) => ({ label: group.label, level: group.level }))).toEqual([
      { label: "Anthropic", level: "provider" },
      { label: "Openai Codex", level: "provider" },
    ]);
  });

  it("heads a provider the same way a row names it", () => {
    const groups = modelChoiceGroups([{ ...gpt55, scoped: true }, gpt55]);

    expect(groups[0]?.items[0]?.meta).toContain("Openai Codex");
    expect(groups.at(-1)?.label).toBe("Openai Codex");
  });

  it("keeps a provider run unmerged so scoped ordering is never resorted", () => {
    const groups = modelChoiceGroups([haikuLatest, gpt55, { ...opus5 }]);

    expect(groups.map((group) => group.label)).toEqual(["Anthropic", "Openai Codex", "Anthropic"]);
  });

  it("draws the divider above the catalogue only when a scope precedes it", () => {
    expect(modelChoiceGroups([{ ...fable, scoped: true }, gpt55]).map((group) => group.divider))
      .toEqual([undefined, true, undefined]);
    expect(modelChoiceGroups([gpt55]).map((group) => group.divider)).toEqual([undefined]);
  });
});
