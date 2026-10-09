import { REPLY_FORMAT_GUIDE } from "@shared/replyFormatGuide";
import { describe, expect, it } from "vitest";
import {
  parseAsides, parseBars, parseCheckList, parseClaims, parseCommands, parseComparison, parseCorrection, parseDisclosure, parseFacts,
  parseFileTree, parseSteps, parseTimeline, readCalloutMarker, readQuoteSource,
} from "./richBlockSyntax";
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

  it("names every callout kind and a quote source the renderer reads", () => {
    for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) expect(readCalloutMarker(`[!${kind}]`)).toMatchObject({ type: "kind" });
    expect(readQuoteSource(/`> (— [^`]+)`/.exec(REPLY_FORMAT_GUIDE)![1]!)).toBe("path/to/file.ts:12");
  });

  it("gives examples that parse into the structure it describes", () => {
    const steps = parseSteps(example("steps"));
    expect(steps.map((step) => step.title)).toEqual(["Stop the web unit", "Rebuild", "Start it again"]);
    expect(steps[0]!.detail).not.toBe("");
    const compare = parseComparison(example("compare"));
    expect(compare.options.map((option) => [option.recommended, option.pros.length, option.cons.length])).toEqual([[true, 1, 1], [false, 1, 0]]);
    const status = parseCheckList(example("status"));
    expect(status.title).toBe("Release checks");
    expect(status.items.map((item) => item.state)).toEqual(["done", "active", "failed", "todo", "skipped"]);
    expect(status.items[2]!.detail).not.toBe("");
    const files = parseFileTree(example("files"));
    expect(files.map((node) => [node.name, node.mark])).toEqual([["src/server", undefined], ["old.md", "deleted"]]);
    expect(files[0]!.children.map((node) => [node.mark, node.note])).toEqual([["changed", "changed, with a note"], ["added", ""]]);
    expect(parseFacts(example("facts"))).toHaveLength(2);
    const claims = parseClaims(example("claims")).claims;
    expect(claims.map((claim) => claim.confidence)).toEqual(["verified", "inferred", "opinion", "unknown"]);
    expect(claims[0]!.detail).not.toBe("");
    expect(parseCommands(example("commands"))).toEqual([{ note: "What the next command does", command: "npm run build" }]);
    expect(parseDisclosure(example("details"))).toEqual({ summary: "One-line summary that stays visible", body: "Material the reader may skip." });
    const bars = parseBars(example("bars"));
    expect([bars.title, bars.bars.map((bar) => bar.value)]).toEqual(["Title, with the unit", [28.7, 7.2]]);
    expect(Object.values(parseCorrection(example("correction"))).every((field) => field !== "")).toBe(true);
    expect(parseAsides(example("asides")).map((aside) => aside.severity)).toEqual(["high", "medium", "low"]);
    const timeline = parseTimeline(example("timeline"));
    expect(timeline.events.map((event) => event.when)).toEqual(["18:22", "21:20"]);
    expect(timeline.events[1]!.detail).toBe("Indented detail.");
    expect(example("diagram")).toMatch(/^flowchart /);
  });
});
