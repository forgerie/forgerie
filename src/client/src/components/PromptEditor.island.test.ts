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
    expect(islandCss).toContain("margin: 0 clamp(");
    expect(islandCss).not.toContain("--pi-composer-rule");
  });

  it("keeps the context reading on the island's own edge", () => {
    expect(islandCss).toMatch(/context-usage-meter\s*{[^}]*position:\s*absolute/);
  });
});
