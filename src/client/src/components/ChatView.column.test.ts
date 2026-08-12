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
