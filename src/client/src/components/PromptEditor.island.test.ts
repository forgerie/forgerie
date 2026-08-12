import { describe, expect, it } from "vitest";
import { promptEditorStyles } from "./shared";

const islandCss = promptEditorStyles.cssText;

describe("composer island styles", () => {
  it("sizes itself from its own container, never from the viewport", () => {
    expect(islandCss).toContain("container-type: inline-size");
    expect(islandCss).toContain("@container");
    // A width breakpoint here would land inside the Fold posture range, where
    // AGENTS.md forbids one; the composer must morph with the space it is given.
    expect(islandCss).not.toContain("@media");
    expect(islandCss).not.toMatch(/\d(vw|vh)\b/);
  });

  it("draws one inset surface rather than a full-width band", () => {
    expect(islandCss).toMatch(/border-radius:\s*16px/);
    expect(islandCss).not.toContain("--pi-composer-rule");
  });

  it("writes into the same column the transcript is read in", () => {
    expect(islandCss).toContain("inline-size: min(100%, var(--calm-measure) + 2 * var(--composer-text-inset))");
    expect(islandCss).toContain("margin: 0 auto max(8px, env(safe-area-inset-bottom))");
  });

  it("keeps its chrome inside the arithmetic when the island tightens", () => {
    expect(islandCss).not.toMatch(/footer\s*{\s*gap:\s*8px;\s*padding:/);
    expect(islandCss).toContain("--composer-island-pad: 8px");
  });

  it("measures its text inset from the chrome it actually draws", () => {
    expect(islandCss).toContain("--composer-text-inset: calc(var(--composer-island-edge) + var(--composer-island-pad) + var(--composer-draft-edge) + var(--composer-draft-pad))");
    expect(islandCss).toContain("padding: var(--composer-island-pad)");
    expect(islandCss).toContain("border: var(--composer-island-edge) solid var(--pi-border)");
    expect(islandCss).toContain("padding: var(--composer-draft-pad, 8px)");
    expect(islandCss).toContain("border: var(--composer-draft-edge, 1px) solid var(--pi-border)");
  });

  it("keeps the context reading on the island's own edge", () => {
    expect(islandCss).toMatch(/context-usage-meter\s*{[^}]*position:\s*absolute/);
  });

  it("lets completion menus extend above the island", () => {
    expect(islandCss).toMatch(/footer\s*{[^}]*overflow:\s*visible/);
  });
});
