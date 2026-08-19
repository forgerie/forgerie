// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { UnifiedDiffViewer } from "./UnifiedDiffViewer";

afterEach(() => {
  document.body.replaceChildren();
});

describe("UnifiedDiffViewer", () => {
  it("renders an explicit empty state", async () => {
    const element = await mount("");

    expect(element.shadowRoot?.querySelector(".empty")?.textContent).toBe("No diff.");
    expect(element.shadowRoot?.querySelector("[role='table']")).toBeNull();
  });

  it("renders line numbers, prefixes, and inline changes as a table", async () => {
    const element = await mount([
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1,2 +1,2 @@",
      "-const value = 'old';",
      "+const value = 'new';",
      " unchanged();",
    ].join("\n"));

    const table = element.shadowRoot?.querySelector("[role='table']");
    const rows = [...(element.shadowRoot?.querySelectorAll("[role='row']") ?? [])];

    expect(table?.getAttribute("aria-label")).toBe("Unified diff");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(element.shadowRoot?.textContent).toContain("const value = 'old';");
    expect(element.shadowRoot?.textContent).toContain("const value = 'new';");
    expect(element.shadowRoot?.querySelectorAll(".inline-change").length).toBeGreaterThan(0);
    expect(element.shadowRoot?.querySelector(".line-number.remove")?.textContent).toBe("1");
    expect(element.shadowRoot?.querySelector(".line-number.new.add")?.textContent).toBe("1");
  });

  it("updates the rendered diff when its public value changes", async () => {
    const element = await mount("@@ -1 +1 @@\n-old\n+new");

    element.diff = "@@ -4 +4 @@\n-before\n+after";
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).not.toContain("old");
    expect(element.shadowRoot?.textContent).toContain("after");
    expect(element.shadowRoot?.querySelector(".line-number.remove")?.textContent).toBe("4");
  });
});

async function mount(diff: string): Promise<UnifiedDiffViewer> {
  const element = new UnifiedDiffViewer();
  element.diff = diff;
  document.body.append(element);
  await element.updateComplete;
  return element;
}
