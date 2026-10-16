import { describe, expect, it } from "vitest";
import {
  countEntries, deltaChange, findingPath, hasMarks, parseCheckResults, parseClaims, parseDelta, parseFileTree, parseFindings, parseLedger,
  parseRecap, parseRevisions, parseVerdict,
} from "./richBlockSyntax";

/** Every prefix of a block, as a streamed reply shows it. */
const prefixes = (text: string) => Array.from({ length: text.length + 1 }, (_, end) => text.slice(0, end));

describe("checks", () => {
  it("reads states, names and results, and a title", () => {
    expect(parseCheckResults("Verification\npass: Full server suite — 2,900 passed, 5 skipped\nfail: Typecheck -- 27 errors\nskip: Fold 8\nunchecked: Screen readers")).toEqual({
      title: "Verification",
      checks: [
        { state: "pass", name: "Full server suite", result: "2,900 passed, 5 skipped" },
        { state: "fail", name: "Typecheck", result: "27 errors" },
        { state: "skip", name: "Fold 8", result: "" },
        { state: "unchecked", name: "Screen readers", result: "" },
      ],
    });
  });
  it("keeps a hyphenated name whole and splits only on a spaced dash", () => {
    expect(parseCheckResults("pass: rich-blocks-acceptance.mjs — 4 postures").checks[0]).toMatchObject({ name: "rich-blocks-acceptance.mjs", result: "4 postures" });
  });
  it("never takes a first check that is still arriving for a title", () => {
    expect(parseCheckResults("pas").title).toBe("");
    expect(parseCheckResults("Verification\npas")).toEqual({ title: "Verification", checks: [] });
  });
});

describe("findings", () => {
  const review = "verdict: changes needed\nnit src/ui.ts:40 — minor\nP1 src/app.ts:12,14–15 — wrong\n  fix: smallest fix\nblocker src/b.ts — worst\nshould-fix src/c.ts:3 — next";
  it("reads the verdict and sorts defects worst first, keeping the written order within a rank", () => {
    const { verdict, findings } = parseFindings(review);
    expect(verdict).toBe("changes");
    expect(findings.map((finding) => [finding.severity, finding.where])).toEqual([["Blocker", "src/b.ts"], ["P1", "src/app.ts:12,14–15"], ["Should fix", "src/c.ts:3"], ["Nit", "src/ui.ts:40"]]);
    expect(findings[1]!.fix).toBe("smallest fix");
  });
  it("reads approve and blocked, and ignores a verdict word still arriving", () => {
    expect(parseFindings("verdict: approve").verdict).toBe("approve");
    expect(parseFindings("verdict: blocked").verdict).toBe("blocked");
    expect(parseFindings("verdict: chan").verdict).toBeUndefined();
  });
  it("names the file a location points at", () => {
    expect(findingPath("src/app.ts:12,14–15")).toBe("src/app.ts");
    expect(findingPath("src/app.ts")).toBe("src/app.ts");
  });
});

describe("recap", () => {
  it("collects repeated done and left lines", () => {
    expect(parseRecap("goal: g\ndone: a\ndone: b\nleft: c\nneeds you: approve\nnext: n")).toEqual({ goal: "g", done: ["a", "b"], left: ["c"], needs: "approve", next: "n" });
  });
  it("reads needs you: nothing as nothing waiting", () => {
    expect(parseRecap("needs you: nothing").needs).toBe("");
    expect(parseRecap("needs you: None.").needs).toBe("");
  });
});

describe("verdict", () => {
  it("reads the answer and joins a wrapped reason", () => {
    expect(parseVerdict("no: still syncing;\n236 MB left")).toEqual({ answer: "no", reason: "still syncing; 236 MB left" });
  });
  it("shows nothing until the answer word and its colon arrive", () => {
    expect(parseVerdict("part")).toBeUndefined();
    expect(parseVerdict("no")).toBeUndefined();
    expect(parseVerdict("partly:")).toEqual({ answer: "partly", reason: "" });
  });
});

describe("commits", () => {
  it("reads hash, state and subject, with an optional title", () => {
    expect(parseRevisions("Today\n1d3c2ba7 landed fix(ui): a\n`2d57cd45` pushed b")).toEqual({
      title: "Today",
      revisions: [{ hash: "1d3c2ba7", state: "landed", subject: "fix(ui): a" }, { hash: "2d57cd45", state: "pushed", subject: "b" }],
    });
  });
  it("skips a line whose state is not one of the four", () => {
    expect(parseRevisions("1d3c2ba7 merged x\n2d57cd45 local y").revisions.map((revision) => revision.hash)).toEqual(["2d57cd45"]);
  });
});

describe("delta", () => {
  it("reads which way is better, the label, and both numbers", () => {
    expect(parseDelta("lower: Cold boot (s): 34 -> 41\nWorkers: 4 → 6").rows).toEqual([
      { direction: "lower", label: "Cold boot (s)", before: "34", after: "41" },
      { direction: "", label: "Workers", before: "4", after: "6" },
    ]);
  });
  it("reads a regression as worse and an improvement as better", () => {
    const [boot, tests] = parseDelta("lower: Boot: 34 -> 41\nhigher: Tests: 2,040 -> 2,591").rows;
    expect(deltaChange(boot!)).toEqual({ complete: true, change: 7, places: 0, percent: (7 / 34) * 100, meaning: "worse" });
    expect(deltaChange(tests!)).toMatchObject({ change: 551, meaning: "better" });
  });
  it("has no percentage from zero or across zero, and no meaning without a direction", () => {
    const [zero, cross, same, none] = parseDelta("lower: a: 0 -> 3\nhigher: b: -3.4 -> 1.2\nlower: c: 412.6 -> 412.6\nd: 4 -> 6").rows;
    expect(deltaChange(zero!)).toMatchObject({ percent: "from zero", meaning: "worse" });
    expect(deltaChange(cross!)).toMatchObject({ percent: "crosses zero", meaning: "better", places: 1 });
    expect(deltaChange(same!)).toMatchObject({ change: 0, meaning: "same" });
    expect(deltaChange(none!)).toMatchObject({ meaning: "none" });
  });
  it("leaves the change out until the after value arrives", () => {
    const [row] = parseDelta("lower: Heap: 357.1 ->").rows;
    expect(row!.after).toBe("");
    expect(deltaChange(row!)).toEqual({ complete: false });
  });
});

describe("ledger", () => {
  it("reads rows, totals and a title", () => {
    expect(parseLedger("Earmarks\nRent: $1,200.00\n= Total: -$300.00")).toEqual({
      title: "Earmarks",
      rows: [{ label: "Rent", amount: "$1,200.00", total: false }, { label: "Total", amount: "-$300.00", total: true }],
    });
  });
  it("keeps an amount that has not arrived empty, and a written ? as the missing marker", () => {
    expect(parseLedger("Rent:\nTax: ?").rows.map((row) => row.amount)).toEqual(["", "?"]);
  });
  it("never takes a first row that is still arriving for a title", () => {
    expect(parseLedger("Rent")).toEqual({ title: "", rows: [] });
  });
});

describe("files as a layout", () => {
  it("is a layout when no entry carries a mark", () => {
    expect(hasMarks(parseFileTree("src/\n  a.ts # note"))).toBe(false);
    expect(hasMarks(parseFileTree("src/\n  + a.ts"))).toBe(true);
  });
  it("counts the entries under one top folder, not the folder itself", () => {
    expect(countEntries(parseFileTree("server/src/pace-tools/\n  reader.ts\n  context.ts\n  catalog.ts\n  queries/\n  appCards.ts"))).toBe(5);
    expect(countEntries(parseFileTree("a.ts\nb/\n  c.ts"))).toBe(3);
  });
});

describe("claims with research verdicts", () => {
  it("reads the four verdicts beside the four confidences", () => {
    expect(parseClaims("supported: a\npartly: b\nunsupported: c\ncontradicted: d\nverified: e").claims.map((claim) => claim.confidence))
      .toEqual(["supported", "partly", "unsupported", "contradicted", "verified"]);
  });
});

describe("half-written blocks", () => {
  it("never throws on any prefix of any round-four block", () => {
    const blocks: [(text: string) => unknown, string][] = [
      [parseCheckResults, "Verification\npass: Suite — 2,900 passed\nfail: Typecheck — 27 errors\nunchecked: Readers"],
      [parseFindings, "verdict: blocked\nP0 src/a.ts:1–2 — wrong\n  fix: right"],
      [parseRecap, "goal: g\ndone: d\nneeds you: approve\nnext: n"],
      [parseVerdict, "partly: The mockup is on main"],
      [parseRevisions, "Today\n1d3c2ba7 landed fix(ui): a"],
      [(text) => parseDelta(text).rows.map(deltaChange), "Soak\nlower: Heap (MiB): 1,284,950.2 -> 1,190,004.7\nhigher: Slack: -3.4 -> 1.2"],
      [parseLedger, "Sale\nPrice: $1,284,950.00\nTrue-up: $131.30 to -$68.70\n= Net: $674,655.87"],
    ];
    for (const [parse, text] of blocks) for (const prefix of prefixes(text)) expect(() => parse(prefix)).not.toThrow();
  });
});
