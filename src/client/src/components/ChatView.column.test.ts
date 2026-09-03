import { describe, expect, it } from "vitest";
import { chatStyles, formattedTextStyles } from "./shared";

const transcriptCss = chatStyles.cssText;
const proseCss = formattedTextStyles.cssText;

describe("transcript reading column", () => {
  it("tracks the reading measure, so everything it holds shares both edges", () => {
    expect(transcriptCss).toContain("grid-template-columns: minmax(0, var(--calm-measure))");
  });

  it("keeps the bleed out of the column, so an empty screen carries no rag", () => {
    expect(transcriptCss).not.toContain("--calm-column");
    expect(proseCss).not.toContain("--calm-column");
  });

  it("lets a feature take what it needs, bounded by the bleed", () => {
    expect(proseCss).toContain("inline-size: fit-content");
    expect(proseCss).toContain("max-inline-size: calc(100% + var(--calm-bleed, 0px))");
  });

  it("withholds the bleed inside a message bubble", () => {
    expect(transcriptCss).toMatch(/\.msg\.user\s*{[^}]*--calm-bleed:\s*0px/);
  });

  it("widens without negative margins, which a later margin shorthand would undo", () => {
    expect(proseCss).not.toContain("margin-inline: calc(-1");
  });
});

describe("a table too wide for the column", () => {
  it("stops scrolling sideways and becomes one card per row", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked\s*{[^}]*overflow-x:\s*visible/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked table\s*{[^}]*display:\s*block/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked tr\s*{[^}]*display:\s*grid/);
  });

  it("carries the heading into each cell and drops the heading row", () => {
    expect(proseCss).toContain("content: attr(data-label)");
    expect(proseCss).toMatch(/\.table-scroll\.stacked thead\s*{[^}]*display:\s*none/);
  });

  // min() takes lengths, not max-content. Spelled that way the declaration is
  // dropped and every heading lands on its own line, which looks deliberate.
  it("bounds the heading by a share of the card, so no width is a special case", () => {
    expect(proseCss).toContain("grid-template-columns: fit-content(32%) minmax(0, 1fr)");
  });

  it("lines the values up down the card rather than after each heading", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td\s*{[^}]*grid-template-columns:\s*subgrid/);
  });
});
