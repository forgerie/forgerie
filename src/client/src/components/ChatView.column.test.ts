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

  // How many fields stand side by side is the grid's own decision, taken from
  // the room a record has and the width its values asked for. A track count in
  // the style sheet would pair up two sentences and stack six dates.
  it("gains and loses field tracks with the room, never from a column count", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tbody\s*{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, var\(--record-field-min, 14rem\)\), 1fr\)\)/);
  });

  // One grid for the whole table: a grid per record places each record's fields
  // wherever its own values end, and nothing lines up down the table.
  it("lines the fields up down the whole table, not down one record", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tr\s*{[^}]*grid-template-columns:\s*subgrid/);
  });

  // A record with one value has nothing to stand beside, so it takes the row
  // instead of a track and a half-empty gap.
  it("gives a lone value the whole row", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:nth-child\(2\):last-child\s*{[^}]*grid-column:\s*1 \/ -1/);
  });

  // Two columns carry both headings above the records, so the value has no
  // label under the name. Drawn at the same ink it read as a second statement
  // rather than as what the name means.
  it("draws an unlabelled lone value quieter than the name it belongs to", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:nth-child\(2\):last-child:not\(\[data-label\]\)\s*{[^}]*color:\s*var\(--pi-muted\)/);
  });

  it("separates records with a rule rather than drawing a box around each one", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked tr \+ tr\s*{[^}]*border-top:\s*1px solid/);
    expect(proseCss).not.toMatch(/\.table-scroll\.stacked tr\s*{[^}]*border-radius/);
  });

  // The step down to --pi-text-sm pays for column width; a stacked table has no
  // columns left to pay for, and it left the heading at 11px under the value it
  // names.
  it("reads a record at the reading size, with its heading one step under", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td\s*{[^}]*font-size:\s*var\(--pi-text-md\)/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked td::before\s*{[^}]*font-size:\s*var\(--pi-text-sm\)/);
    expect(proseCss).not.toMatch(/\.table-scroll\.stacked td::before\s*{[^}]*font-size:\s*var\(--pi-text-xs\)/);
  });

  it("reads the record's name as a title instead of repeating its heading", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:first-child\s*{[^}]*font-weight:\s*600/);
    expect(proseCss).toMatch(/\.table-scroll\.stacked td:first-child::before\s*{[^}]*content:\s*none/);
    expect(proseCss).toContain("content: attr(data-record-label)");
  });

  // The table asks how much room it has, never what is showing it: a viewport
  // rule would stack a wide table inside a narrow pane and leave a narrow one
  // beside it in two columns.
  it("lays a record out from the table's own width, never the viewport's", () => {
    expect(proseCss).toMatch(/\.table-scroll\.stacked\s*{[^}]*container-type:\s*inline-size/);
    expect(proseCss).not.toMatch(/@media[^{]*\(max-width[^{]*\)\s*{[^}]*table-scroll/);
  });
});

describe("a table measured against its column", () => {
  // The old measurement asked whether every cell could hold its sentence on one
  // line. None can, so every table of prose stacked. Released, the table states
  // what it wants and the wrapper what it may have, and the two are compared.
  it("releases the table and the wrapper while it is measured", () => {
    expect(proseCss).toMatch(/\.table-scroll\.measuring\s*{[^}]*inline-size:\s*calc\(100% \+ var\(--calm-bleed, 0px\)\)/);
    expect(proseCss).toMatch(/\.table-scroll\.measuring\s*{[^}]*max-inline-size:\s*none/);
    expect(proseCss).toMatch(/\.table-scroll\.measuring table\s*{[^}]*width:\s*max-content/);
    expect(proseCss).toMatch(/\.table-scroll\.measuring table\s*{[^}]*max-width:\s*none/);
  });

  it("wraps a table that asks for more than it may have, instead of scrolling it", () => {
    expect(proseCss).toMatch(/\n {2}table\s*{[^}]*max-width:\s*100%/);
  });
});
