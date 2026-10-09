import { describe, expect, it } from "vitest";
import { compactContextWindow, modelCommandQuery, modelGroups, modelLabel, modelMenu, providerLabel, thinkingLabel, type SessionModel } from "./modelChoice";

const opus: SessionModel = { provider: "cliproxyapi", id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1_000_000, reasoning: true, scoped: true };
const flash: SessionModel = { provider: "cliproxyapi", id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", contextWindow: 1_048_576, reasoning: true, scoped: true };
const haiku: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextWindow: 200_000, reasoning: true };
const alias: SessionModel = { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (latest)", contextWindow: 200_000, reasoning: true };
const codex: SessionModel = { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272_000, reasoning: false };

describe("model groups", () => {
  it("puts favorites (Pi's scoped flag, without app lists) first as one named set, naming their provider", () => {
    const groups = modelGroups([opus, haiku, flash]);
    expect(groups.map((group) => group.label)).toEqual(["Favorites", "Anthropic"]);
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
    expect(modelGroups([opus, haiku], "CLIPROXYAPI/CLAUDE-OPUS").flatMap((group) => group.rows.map((row) => row.key))).toEqual(["cliproxyapi/claude-opus-5-5"]);
    expect(modelGroups([opus, haiku], "openai")).toEqual([]);
    expect(modelGroups([{ name: "Unnamed" }, { provider: "x" }])).toEqual([]);
  });
});

describe("model menu with the app's lists", () => {
  const models = [opus, haiku, flash, alias, codex];
  const prefs = { favorites: ["cliproxyapi/gemini-3.8-flash", "claude-opus-5-5:high"], visible: ["anthropic/claude-haiku-4-5"] };
  const keys = (menu: ReturnType<typeof modelMenu>) => menu.groups.map((group) => [group.label, ...group.rows.map((row) => row.id)]);

  it("puts favorites first in the user's order, and leaves out models not shown", () => {
    const menu = modelMenu(models, "", { prefs });
    expect(keys(menu)).toEqual([["Favorites", "gemini-3.8-flash", "claude-opus-5-5"], ["Anthropic", "claude-haiku-4-5"]]);
    expect(menu.hidden).toBe(2);
  });

  it("ignores Pi's scoped flag once the app's lists are known", () => {
    expect(keys(modelMenu([opus, flash], "", { prefs: { favorites: [], visible: null } }))).toEqual([["Cliproxyapi", "claude-opus-5-5", "gemini-3.8-flash"]]);
  });

  it("offers hidden models on request, marked, and always offers the model in use", () => {
    const shown = modelMenu(models, "", { prefs, showHidden: true });
    expect(shown.groups.flatMap((group) => group.rows.filter((row) => row.hidden).map((row) => row.id))).toEqual(["claude-haiku-4-5-20251001", "gpt-5.6-sol"]);
    expect(keys(modelMenu(models, "", { prefs, activeKey: "openai-codex/gpt-5.6-sol" })).at(-1)).toEqual(["Openai Codex", "gpt-5.6-sol"]);
  });

  it("counts only hidden models that match the search", () => {
    expect(modelMenu(models, "codex", { prefs })).toEqual({ groups: [], hidden: 1 });
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
