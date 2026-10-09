import { describe, expect, it } from "vitest";
import { countMarks, parseAsides, parseCorrection, parseTimeline, readQuoteSource, parseBars, parseCheckList, parseClaims, parseCommands, parseComparison, parseDisclosure, parseFacts, parseFileTree, parseSteps, readCalloutMarker } from "./richBlockSyntax";

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

describe("files", () => {
  it("nests indented lines under a directory and reads marks and notes", () => {
    expect(parseFileTree("src/server/\n  ~ app.ts # wires the guide\n  + guide.ts\n- old.md")).toEqual([
      { name: "src/server", directory: true, note: "", children: [
        { name: "app.ts", directory: false, mark: "changed", note: "wires the guide", children: [] },
        { name: "guide.ts", directory: false, mark: "added", note: "", children: [] },
      ] },
      { name: "old.md", directory: false, mark: "deleted", note: "", children: [] },
    ]);
  });

  it("builds the same tree from whole paths and counts the marks", () => {
    const tree = parseFileTree("+ ui/src/ui/A.tsx\n+ ui/src/ui/A.css\n~ ui/package.json");
    expect(tree).toEqual([{ name: "ui", directory: true, note: "", children: [
      { name: "src/ui", directory: true, note: "", children: [
        { name: "A.tsx", directory: false, mark: "added", note: "", children: [] },
        { name: "A.css", directory: false, mark: "added", note: "", children: [] },
      ] },
      { name: "package.json", directory: false, mark: "changed", note: "", children: [] },
    ] }]);
    expect(countMarks(tree)).toEqual({ added: 2, changed: 1, deleted: 0 });
  });

  it("keeps a hyphenated file name that is not a mark", () => {
    expect(parseFileTree("my-file.ts")[0]).toMatchObject({ name: "my-file.ts" });
    expect(parseFileTree("-my-file.ts")[0]).toMatchObject({ name: "-my-file.ts" });
  });
});

describe("status", () => {
  it("reads every state, the title, and indented detail", () => {
    expect(parseCheckList("Release\n[x] Build\n[~] Review\n[ ] Deploy\n[!] Visual\n    Clips the composer.\n[-] Tablet\n- [X] Lint")).toEqual({
      title: "Release",
      items: [
        { state: "done", text: "Build", detail: "" },
        { state: "active", text: "Review", detail: "" },
        { state: "todo", text: "Deploy", detail: "" },
        { state: "failed", text: "Visual", detail: "Clips the composer." },
        { state: "skipped", text: "Tablet", detail: "" },
        { state: "done", text: "Lint", detail: "" },
      ],
    });
  });

  it("reads an item cut off mid-stream", () => {
    expect(parseCheckList("[x] Bui").items).toEqual([{ state: "done", text: "Bui", detail: "" }]);
    expect(parseCheckList("[").items).toEqual([]);
  });
});

describe("facts", () => {
  it("reads Label: value lines and keeps colons inside the value", () => {
    expect(parseFacts("Tests: 1017 passed\nStarted: 21:17:02\nnot a fact")).toEqual([
      { label: "Tests", value: "1017 passed" }, { label: "Started", value: "21:17:02" },
    ]);
  });
});

describe("claims", () => {
  it("reads each confidence, the title, and the evidence under a claim", () => {
    expect(parseClaims("Why the guide is missing\nverified: sessiond started at 18:22\n  `systemctl show` says so.\nInferred: no session has it\n- opinion: restart now\nunknown: child agents")).toEqual({
      title: "Why the guide is missing",
      claims: [
        { confidence: "verified", text: "sessiond started at 18:22", detail: "`systemctl show` says so." },
        { confidence: "inferred", text: "no session has it", detail: "" },
        { confidence: "opinion", text: "restart now", detail: "" },
        { confidence: "unknown", text: "child agents", detail: "" },
      ],
    });
  });
});

describe("details", () => {
  it("makes the first line the summary and dedents the rest", () => {
    expect(parseDisclosure("\nFull log, 40 lines\n  line one\n  line two")).toEqual({ summary: "Full log, 40 lines", body: "line one\nline two" });
    expect(parseDisclosure("Only a summ")).toEqual({ summary: "Only a summ", body: "" });
  });
});

describe("commands", () => {
  it("attaches notes, drops prompts, and joins continued lines", () => {
    expect(parseCommands("# Rebuild\n$ npm run build\n\n# Restart both\n# then check\nsystemctl --user restart \\\n  web sessiond\nls")).toEqual([
      { note: "Rebuild", command: "npm run build" },
      { note: "Restart both then check", command: "systemctl --user restart \\\n  web sessiond" },
      { note: "", command: "ls" },
    ]);
  });

  it("keeps a command or note cut off mid-stream", () => {
    expect(parseCommands("# Rebuild\nnpm run bu")).toEqual([{ note: "Rebuild", command: "npm run bu" }]);
    expect(parseCommands("# Rebu")).toEqual([{ note: "Rebu", command: "" }]);
  });
});

describe("bars", () => {
  it("reads the title, numbers with units and separators, and skips text after the bars", () => {
    expect(parseBars("Slowest files, seconds\nbuildContents: 28.7 s\narchiveNext: 7.2\nbig: 1,250 ms\nnot a bar")).toEqual({
      title: "Slowest files, seconds",
      bars: [
        { label: "buildContents", value: 28.7, display: "28.7 s" },
        { label: "archiveNext", value: 7.2, display: "7.2" },
        { label: "big", value: 1250, display: "1,250 ms" },
      ],
    });
  });
});

describe("correction", () => {
  it("reads was, now and cause in any order, with continued lines", () => {
    expect(parseCorrection("now: about 1,100 tokens\ncause: I put characters and tokens\n  side by side.\nwas: 4,000 tokens per message")).toEqual({
      wrong: "4,000 tokens per message", right: "about 1,100 tokens", cause: "I put characters and tokens\nside by side.",
    });
    expect(parseCorrection("was: half")).toEqual({ wrong: "half", right: "", cause: "" });
  });
});

describe("asides", () => {
  it("reads each severity and the detail under it", () => {
    expect(parseAsides("High: sessiond is stale\n  It started at 18:22.\n- low: a label\nnot an aside")).toEqual([
      { severity: "high", text: "sessiond is stale", detail: "It started at 18:22." },
      { severity: "low", text: "a label", detail: "not an aside" },
    ]);
  });
});

describe("timeline", () => {
  it("splits when from what on a spaced dash and keeps detail and title", () => {
    expect(parseTimeline("Tonight\n18:22 - sessiond started\n21:20 – guide landed on main\n  Commit 84e7ff4f.\n2026-10-08 23:42 — sessiond restarted")).toEqual({
      title: "Tonight",
      events: [
        { when: "18:22", text: "sessiond started", detail: "" },
        { when: "21:20", text: "guide landed on main", detail: "Commit 84e7ff4f." },
        { when: "2026-10-08 23:42", text: "sessiond restarted", detail: "" },
      ],
    });
  });

  it("does not split on a hyphen inside a word or an indented detail dash", () => {
    expect(parseTimeline("18:22 - sessiond-start ran\n  - first note").events).toEqual([{ when: "18:22", text: "sessiond-start ran", detail: "- first note" }]);
  });
});

describe("quote sources", () => {
  it("reads an em dash or double hyphen source line", () => {
    expect(readQuoteSource("— src/app.ts:12")).toBe("src/app.ts:12");
    expect(readQuoteSource("-- AGENTS.md")).toBe("AGENTS.md");
    expect(readQuoteSource("- a list item")).toBeUndefined();
  });
});
