import { describe, expect, it } from "vitest";
import { chatStyles, formattedTextStyles } from "./shared";

const transcriptCss = chatStyles.cssText;
const proseCss = formattedTextStyles.cssText;

describe("transcript content column", () => {
  it("tracks the content column so everything shares one start edge", () => {
    expect(transcriptCss).toContain("grid-template-columns: minmax(0, var(--calm-column))");
  });

  it("caps what it holds at the reading measure rather than the track", () => {
    expect(transcriptCss).toContain(".chat > *, .turn-body > * { max-inline-size: min(100%, var(--calm-measure)); }");
  });

  it("lets content that is not prose run into the rest of the column", () => {
    expect(proseCss).toContain("inline-size: calc(100% + var(--calm-wide-run, 0px))");
  });

  it("widens without negative margins, which a later margin shorthand would undo", () => {
    expect(proseCss).not.toContain("margin-inline: calc(-1");
    expect(transcriptCss).not.toContain("--calm-bleed");
    expect(proseCss).not.toContain("--calm-bleed");
  });
});
