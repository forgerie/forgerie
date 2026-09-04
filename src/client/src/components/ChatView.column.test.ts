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
  it("stops scrolling sideways and is read as records", () => {
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
  it("bounds the heading by a share of the table, so no width is a special case", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tbody\s*{[^}]*grid-template-columns:\s*fit-content\(32%\) minmax\(0, 1fr\)/);
  });

  // One grid for the whole table: a grid per record measures only its own
  // headings, and the values then start at a different place in every record.
  it("lines the values up down the whole table, not down one record", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tr\s*{[^}]*grid-template-columns:\s*subgrid/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked td\s*{[^}]*grid-template-columns:\s*subgrid/);
  });

  it("separates records with a rule rather than drawing a box around each one", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tr \+ tr\s*{[^}]*border-top:\s*1px solid/);
    expect(proseCss).not.toMatch(/\.table-scroll\.stacked tr\s*{[^}]*border-radius/);
  });

  it("reads the record's name as a title instead of repeating its heading", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:first-child\s*{[^}]*font-weight:\s*600/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:first-child::before\s*{[^}]*content:\s*none/);
    expect(proseCss).toContain("content: attr(data-record-label)");
  });

  // The table asks how much room it has, never what is showing it: a viewport
  // rule would stack a wide table inside a narrow pane and leave a narrow one
  // beside it in two columns.
  it("moves the headings above their values from the table's own width", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked\s*{[^}]*container-type:\s*inline-size/);
    expect(proseCss).toMatch(/@container \(max-width: 26rem\)/);
    expect(proseCss).not.toMatch(/@media[^{]*\(max-width[^{]*\)\s*{[^}]*table-scroll/);
  });
});
