import { describe, expect, it } from "vitest";
import { commandCatalogSchema, commandResultSchema, isCommand, matchSlash, piCommandFormatter } from "./commands";

describe("Pi command contracts", () => {
  it("matches only the leading command word and preserves arguments outside completion", () => {
    expect(matchSlash("/re", "/", 3)).toEqual({ query: "re", offset: 0, endOffset: 3 });
    expect(matchSlash("/name draft", "/", 5)).toEqual({ query: "name", offset: 0, endOffset: 5 });
    for (const text of ["read /file", " /name", "/name draft", "/name\ndraft"]) expect(matchSlash(text, "/", text.length)).toBeNull();
    expect(isCommand("/name draft")).toBe(true);
    expect(isCommand("read /file")).toBe(false);
    expect(piCommandFormatter.serialize({ label: "/skill:review" })).toBe("/skill:review");
  });
  it("accepts every command source and rejects malformed catalogs", () => {
    expect(commandCatalogSchema.parse(["builtin", "extension", "prompt", "skill"].map((source) => ({ name: source, source })))).toHaveLength(4);
    expect(commandCatalogSchema.safeParse([{ name: "bad", source: "remote" }]).success).toBe(false);
  });
  it("validates follow-up and tree results instead of treating every response as accepted", () => {
    expect(commandResultSchema.parse({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } }).type).toBe("tree");
    expect(commandResultSchema.safeParse({ type: "select", title: "Missing request" }).success).toBe(false);
    expect(commandResultSchema.safeParse({ accepted: true }).success).toBe(false);
  });
});
