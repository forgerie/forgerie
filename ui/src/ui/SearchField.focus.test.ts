import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The page's `:focus-visible` ring ties with `.search-field-input` on specificity, so it drew a square ring
// round the bare input inside the rounded box. The box owns focus; the input never rings.
const css = readFileSync(new URL("./SearchField.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
describe("search field focus", () => {
  it("rings the rounded box, never the input inside it", () => {
    expect(css).toMatch(/\.search-field-input:focus-visible\s*\{\s*outline:\s*none;\s*\}/u);
    expect(css).toMatch(/\.search-field-box:has\(\.search-field-input:focus-visible\)\s*\{[^}]*outline:\s*calc\(2 \* var\(--hairline\)\) solid var\(--foreground\)/u);
  });
});
