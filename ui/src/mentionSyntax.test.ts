import { describe, expect, it } from "vitest";
import { fileReference, mentionFormatter, mentionMatcher, mentionPlacement } from "./mentionSyntax";

describe("Forgerie mention syntax", () => {
  it("keeps @ files and # qualified models", () => {
    expect(mentionMatcher("read @src/main", "@", 14)).toEqual({ query: "src/main", offset: 5, endOffset: 14 });
    expect(mentionMatcher("use #provider/model", "#", 19)).toEqual({ query: "provider/model", offset: 4, endOffset: 19 });
    expect(mentionFormatter("#").serialize({ id: "provider/model-id", type: "model", label: "Friendly name" })).toBe("#provider/model-id");
    expect(mentionFormatter("@").serialize({ id: "src/main.ts", type: "file", label: "Main" })).toBe("@src/main.ts");
  });
  it("distinguishes tracked files, all files, and quoted paths", () => {
    expect(mentionMatcher("@ src with spaces", "@ ", 17)?.query).toBe("src with spaces");
    expect(mentionMatcher("@ src", "@", 5)?.query).toBe(" src");
    expect(mentionMatcher('read @"dir with sp', "@", 18)?.query).toBe("dir with sp");
    expect(mentionMatcher("!@vendor", "!@", 8)?.offset).toBe(0);
    expect(mentionMatcher("!@vendor", "@", 8)).toBeNull();
    expect(mentionFormatter("!@").serialize({ id: "vendor/", type: "file", label: "vendor/" })).toBe("!@vendor/");
    expect(mentionFormatter("@ ").serialize({ id: "dir with space/", type: "file", label: "dir" })).toBe('@ "dir with space/"');
    expect(mentionFormatter("@ ").serialize({ id: "ignored file", type: "file", label: "ignored" })).toBe('@"ignored file"');
    expect(fileReference("path\twith tab")).toBe('@"path\twith tab"');
  });
  it("detects at the caret, not at the end of the message, and leaves ordinary text alone", () => {
    expect(mentionMatcher("read @src then explain", "@", 9)).toEqual({ query: "src", offset: 5, endOffset: 9 });
    expect(mentionMatcher("name@example.com", "@", 16)).toBeNull();
    const repeated = "read @src/main.ts then @src";
    expect(mentionMatcher(repeated, "@", repeated.length)).toEqual({ query: "src", offset: 23, endOffset: repeated.length });
    expect(mentionMatcher('read @"finished file" ', "@", 22)).toBeNull();
    expect(mentionMatcher("#model", "#", 0)).toBeNull();
    expect(mentionFormatter("@").parse("read @src/main.ts")).toEqual([{ kind: "text", text: "read @src/main.ts" }]);
  });
});

describe("suggestion placement", () => {
  it("fits all Fold postures, short keyboard panes and narrow containers", () => {
    for (const [width, height] of [[704, 783], [932, 553], [475, 638], [711, 374], [475, 280], [280, 500]]) {
      const plan = mentionPlacement({ left: 16, width: width! - 32, top: height! - 100, bottom: height! - 52 },
        { left: 0, top: 0, width: width!, height: height! });
      expect(plan.left).toBeGreaterThanOrEqual(8);
      expect(plan.left + plan.width).toBeLessThanOrEqual(width! - 8);
      expect(plan.top - plan.maxHeight).toBeGreaterThanOrEqual(8);
      expect(plan.up).toBe(true);
    }
  });
  it("uses space below a high input and accounts for visual viewport offsets", () => {
    const plan = mentionPlacement({ left: 0, top: 110, bottom: 150, width: 600 }, { left: 20, top: 100, width: 300, height: 300 });
    expect(plan).toEqual({ left: 28, width: 284, top: 158, maxHeight: 234, up: false });
  });
});
