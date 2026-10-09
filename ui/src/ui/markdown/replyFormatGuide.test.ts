import { REPLY_FORMAT_GUIDE } from "@shared/replyFormatGuide";
import { describe, expect, it } from "vitest";
import { parseCheckList, parseComparison, parseFacts, parseFileTree, parseSteps, readCalloutMarker } from "./richBlockSyntax";
import { blockFences } from "./blockFences";
import { richBlocksByLanguage } from "./RichBlocks";

// The guide is injected into every hosted session's system prompt. Every
// example in it must render here, or the agent learns a syntax we drop.
const examples = [...REPLY_FORMAT_GUIDE.matchAll(/```(\w+)\n([\s\S]*?)\n```/g)].map(([, language, body]) => ({ language: language!, body: body! }));
const example = (language: string) => examples.find((candidate) => candidate.language === language)!.body;

describe("the injected reply format guide", () => {
  it("names only fence languages the renderer handles, and all of them", () => {
    const rendered = new Set([...Object.keys(richBlocksByLanguage), ...Object.keys(blockFences)].filter((language) => language !== "mermaid"));
    expect(new Set(examples.map((candidate) => candidate.language))).toEqual(rendered);
  });

  it("gives examples that parse into the structure it describes", () => {
    expect(readCalloutMarker(/> (\[!\w+\])/.exec(REPLY_FORMAT_GUIDE)![1]!)).toMatchObject({ type: "kind", kind: "warning" });
    expect(parseSteps(example("steps")).map((step) => step.title)).toEqual(["Stop the web unit", "Rebuild", "Start the unit again"]);
    const compare = parseComparison(example("compare"));
    expect(compare.options.map((option) => [option.recommended, option.pros.length, option.cons.length])).toEqual([[true, 1, 1], [false, 1, 1]]);
    const status = parseCheckList(example("status"));
    expect(status.title).toBe("Release checks");
    expect(status.items.map((item) => item.state)).toEqual(["done", "done", "failed", "todo"]);
    expect(status.items[2]!.detail).not.toBe("");
    const files = parseFileTree(example("files"));
    // Both paths start with src/, so they share one root.
    const [sessions, legacy] = files[0]!.children;
    expect([files[0]!.name, sessions!.name, legacy!.name]).toEqual(["src", "server/sessions", "legacy"]);
    expect(sessions!.children.map((node) => node.mark)).toEqual(["changed", "added"]);
    expect(legacy!.children[0]).toMatchObject({ name: "guide.md", mark: "deleted" });
    expect(parseFacts(example("facts"))).toHaveLength(3);
    expect(example("diagram")).toMatch(/^flowchart /);
  });
});
