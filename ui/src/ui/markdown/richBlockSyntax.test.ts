import { describe, expect, it } from "vitest";
import { parseComparison, parseSteps, readCalloutMarker } from "./richBlockSyntax";

describe("callout markers", () => {
  it("reads GitHub alert markers in any case and reports how much to remove", () => {
    expect(readCalloutMarker("[!WARNING]\nThe unit restarts.")).toEqual({ type: "kind", kind: "warning", length: 11 });
    expect(readCalloutMarker("[!tip] Inline body")).toEqual({ type: "kind", kind: "tip", length: 7 });
  });

  it("leaves ordinary quotes and unknown kinds alone", () => {
    expect(readCalloutMarker("Plain quote")).toBeUndefined();
    expect(readCalloutMarker("[!DANGER] not a GitHub kind")).toBeUndefined();
    expect(readCalloutMarker("[link text] after")).toBeUndefined();
  });

  it("treats a marker that is still arriving as pending", () => {
    for (const text of ["[", "[!", "[!WARN", "!WARN"]) expect(readCalloutMarker(text)).toEqual({ type: "partial" });
    expect(readCalloutMarker("WARN")).toBeUndefined();
    expect(readCalloutMarker("[!WARN more")).toBeUndefined();
  });
});

describe("steps", () => {
  it("makes each marker line a step and the indented lines under it its detail", () => {
    expect(parseSteps("1. Stop the unit\n   Run `systemctl --user stop web`.\n\n   Wait for inactive.\n2. Rebuild\n3. Start it")).toEqual([
      { title: "Stop the unit", detail: "Run `systemctl --user stop web`.\n\nWait for inactive." },
      { title: "Rebuild", detail: "" },
      { title: "Start it", detail: "" },
    ]);
  });

  it("keeps a nested list inside the step instead of splitting it", () => {
    expect(parseSteps("- Check\n  - disk\n  - memory\n- Deploy")).toEqual([
      { title: "Check", detail: "- disk\n- memory" },
      { title: "Deploy", detail: "" },
    ]);
  });

  it("reads a block cut off mid-stream and keeps unmarked lines", () => {
    expect(parseSteps("Open settings\n1.")).toEqual([{ title: "Open settings", detail: "" }, { title: "", detail: "" }]);
    expect(parseSteps("")).toEqual([]);
  });
});

describe("compare", () => {
  it("splits options by heading, marks the pick, and sorts strengths, costs, and summary", () => {
    expect(parseComparison("Which renderer?\n\n## Fences (recommended)\nOne block each.\n+ Streams well\n- Body is not Markdown\n## Directives\n+ Real Markdown\n− Breaks the splitter")).toEqual({
      caption: "Which renderer?",
      options: [
        { title: "Fences", recommended: true, summary: "One block each.", pros: ["Streams well"], cons: ["Body is not Markdown"] },
        { title: "Directives", recommended: false, summary: "", pros: ["Real Markdown"], cons: ["Breaks the splitter"] },
      ],
    });
  });

  it("returns what has arrived so far", () => {
    expect(parseComparison("## Fen")).toEqual({ caption: "", options: [{ title: "Fen", recommended: false, summary: "", pros: [], cons: [] }] });
    expect(parseComparison("Picking a")).toEqual({ caption: "Picking a", options: [] });
  });
});
