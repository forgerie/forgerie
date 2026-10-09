import { describe, expect, it } from "vitest";
import { applyChange, cycleTarget, parseFavorite, resolveFavorites } from "./modelPrefs";

const opus = { provider: "proxy", id: "claude-opus-5-5" };
const flash = { provider: "proxy", id: "gemini-3.8-flash" };
const llama = { provider: "local", id: "llama3:8b" };
const old = { provider: "proxy", id: "claude-3-5-haiku-20241022" };
const models = [opus, flash, llama, old];

describe("favorite entries", () => {
  it("reads Pi's forms: provider and ID, a thinking level, an ID alone, and a glob", () => {
    expect(parseFavorite("proxy/claude-opus-5-5")).toMatchObject({ provider: "proxy", id: "claude-opus-5-5", pattern: false });
    expect(parseFavorite("proxy/claude-opus-5-5:high")).toMatchObject({ id: "claude-opus-5-5", level: "high" });
    // A colon that is not a thinking level belongs to the ID.
    expect(parseFavorite("local/llama3:8b")).toMatchObject({ id: "llama3:8b", level: undefined });
    expect(parseFavorite("gemini-3.8-flash")).toMatchObject({ id: "gemini-3.8-flash" });
    expect(parseFavorite("gemini-3.8-flash").provider).toBeUndefined();
    expect(parseFavorite("proxy/claude-*").pattern).toBe(true);
  });

  it("resolves favorites in Pi's order, once each, and skips names no provider offers", () => {
    const resolved = resolveFavorites(["proxy/gemini-3.8-flash", "missing/model", "claude-opus-5-5:low", "proxy/gemini-3.8-flash:high", "proxy/*"], models);
    expect(resolved.map((favorite) => [favorite.key, favorite.level])).toEqual([["proxy/gemini-3.8-flash", undefined], ["proxy/claude-opus-5-5", "low"]]);
  });
});

describe("cycling", () => {
  const favorites = resolveFavorites(["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash", "local/llama3:8b"], models);
  it("moves to the next favorite and wraps, both ways", () => {
    expect(cycleTarget(favorites, "proxy/claude-opus-5-5", 1)?.key).toBe("proxy/gemini-3.8-flash");
    expect(cycleTarget(favorites, "local/llama3:8b", 1)?.key).toBe("proxy/claude-opus-5-5");
    expect(cycleTarget(favorites, "proxy/claude-opus-5-5", -1)?.key).toBe("local/llama3:8b");
  });
  it("starts at the first favorite from any other model, and has nowhere to go with one favorite in use", () => {
    expect(cycleTarget(favorites, "proxy/claude-3-5-haiku-20241022", 1)?.key).toBe("proxy/claude-opus-5-5");
    expect(cycleTarget(favorites.slice(0, 1), "proxy/claude-opus-5-5", 1)).toBeUndefined();
    expect(cycleTarget([], undefined, 1)).toBeUndefined();
  });
});

describe("changes", () => {
  it("turns the first hide into an allow-list of everything else", () => {
    const next = applyChange({ favorites: [], visible: null }, { type: "show", keys: ["proxy/claude-3-5-haiku-20241022"], on: false }, models);
    expect(next.visible).toEqual(["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash", "local/llama3:8b"]);
  });

  it("shows a model it stars, keeps it shown when unstarred, and unstars a model it hides", () => {
    const starred = applyChange({ favorites: [], visible: [] }, { type: "favorite", key: "proxy/claude-opus-5-5", on: true }, models);
    expect(starred).toEqual({ favorites: ["proxy/claude-opus-5-5"], visible: ["proxy/claude-opus-5-5"] });
    expect(applyChange({ favorites: ["proxy/claude-opus-5-5"], visible: [] }, { type: "favorite", key: "proxy/claude-opus-5-5", on: false }, models))
      .toEqual({ favorites: [], visible: ["proxy/claude-opus-5-5"] });
    expect(applyChange(starred, { type: "show", keys: ["proxy/claude-opus-5-5"], on: false }, models)).toEqual({ favorites: [], visible: [] });
  });

  it("keeps a favorite's stored entry and every entry it does not edit", () => {
    const lists = { favorites: ["proxy/*", "claude-opus-5-5:high"], visible: null };
    expect(applyChange(lists, { type: "favorite", key: "proxy/gemini-3.8-flash", on: true }, models).favorites)
      .toEqual(["proxy/*", "claude-opus-5-5:high", "proxy/gemini-3.8-flash"]);
    expect(applyChange(lists, { type: "favorite", key: "proxy/claude-opus-5-5", on: true }, models).favorites).toEqual(lists.favorites);
    expect(applyChange(lists, { type: "favorite", key: "proxy/claude-opus-5-5", on: false }, models).favorites).toEqual(["proxy/*"]);
  });

  it("makes the default a shown favorite, as Pi does when it saves a default", () => {
    const next = applyChange({ favorites: ["proxy/claude-opus-5-5"], visible: [], defaultModel: null }, { type: "default", key: "local/llama3:8b" }, models);
    expect(next).toEqual({ favorites: ["proxy/claude-opus-5-5", "local/llama3:8b"], visible: ["local/llama3:8b"], defaultModel: "local/llama3:8b", defaultThinkingLevel: undefined });
    // Without favorites every model is in Pi's scope, so no star is added.
    expect(applyChange({ favorites: [], visible: null }, { type: "default", key: "local/llama3:8b" }, models).favorites).toEqual([]);
    expect(applyChange({ favorites: [], visible: null }, { type: "defaultLevel", level: "low" }, models).defaultThinkingLevel).toBe("low");
  });

  it("will not hide or unstar the default", () => {
    const lists = { favorites: ["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash"], visible: ["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash"], defaultModel: "proxy/claude-opus-5-5" };
    expect(applyChange(lists, { type: "favorite", key: "proxy/claude-opus-5-5", on: false }, models).favorites).toEqual(lists.favorites);
    const hidden = applyChange(lists, { type: "show", keys: ["proxy/claude-opus-5-5", "proxy/gemini-3.8-flash"], on: false }, models);
    expect(hidden).toMatchObject({ favorites: ["proxy/claude-opus-5-5"], visible: ["proxy/claude-opus-5-5"], defaultModel: "proxy/claude-opus-5-5" });
  });

  it("shows models without listing one twice", () => {
    expect(applyChange({ favorites: [], visible: ["local/llama3:8b"] }, { type: "show", keys: ["local/llama3:8b", "proxy/gemini-3.8-flash"], on: true }, models).visible)
      .toEqual(["local/llama3:8b", "proxy/gemini-3.8-flash"]);
  });
});
