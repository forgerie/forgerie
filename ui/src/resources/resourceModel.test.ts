import { describe, expect, it } from "vitest";
import { hides, kindCounts, refusalAdvice, rowFlags, saveConsequence, savedMessage, sections } from "./resourceModel";
import { bundledHandoff, entries, mobbin, sessionInventory, settingsInventory, testingGuide } from "./fixtures/resources";

const byId = new Map(entries.map((entry) => [entry.id, entry]));

describe("sections", () => {
  it("orders origins as Pi lets them win and leaves empty ones out", () => {
    expect(sections(entries, "skill").map((section) => section.title)).toEqual(["This project", "Yours", "Built into Forgerie", "From packages"]);
    expect(sections(settingsInventory.resources, "skill").map((section) => section.origin)).toEqual(["user", "bundled", "package"]);
  });

  it("sorts by name inside a section and names each root once", () => {
    const yours = sections(entries, "skill").find((section) => section.origin === "user");
    expect(yours?.entries.map((entry) => entry.name)).toEqual(["code-review", "draft-skill", "handoff", "teach"]);
    expect(yours?.roots).toEqual(["/home/ada/.agents/skills"]);
  });

  it("filters by every word of the query across name, description and package", () => {
    expect(sections(entries, "skill", "mobbin").flatMap((section) => section.entries)).toEqual([mobbin]);
    expect(sections(entries, "skill", "testing guide").flatMap((section) => section.entries)).toEqual([testingGuide]);
    expect(sections(entries, "skill", "no such thing")).toEqual([]);
  });

  it("counts each kind for the switch", () => {
    expect(kindCounts(entries)).toEqual({ skill: 8, prompt: 2, context: 2 });
  });
});

describe("rowFlags", () => {
  it("names the file that hides a shadowed one, and where it lives", () => {
    const hidden = entries.find((entry) => entry.activation.kind === "shadowed");
    expect(hidden && rowFlags(hidden, byId, false)).toEqual([{ text: "Hidden by handoff (built into Forgerie)" }]);
    expect(hides(bundledHandoff, entries).map((entry) => entry.path)).toEqual(["/home/ada/.agents/skills/handoff/SKILL.md"]);
  });

  it("says when a skill runs only on request, is broken, read-only, or has a draft", () => {
    const teach = entries.find((entry) => entry.name === "teach");
    const broken = entries.find((entry) => entry.activation.kind === "invalid");
    expect(teach && rowFlags(teach, byId, true)).toEqual([{ text: "Runs only when you ask" }, { text: "Unsaved changes", tone: "draft" }]);
    expect(broken && rowFlags(broken, byId, false)).toEqual([{ text: "The description is missing.", tone: "error" }]);
    expect(rowFlags(mobbin, byId, false)).toEqual([{ text: "Read-only" }]);
  });
});

describe("what saving does", () => {
  it("says before saving where the change goes and when a session reads it", () => {
    expect(saveConsequence(testingGuide, sessionInventory.scope)).toBe("Saving leaves an uncommitted change in this checkout. This session reads it after /reload.");
    expect(saveConsequence({ ...testingGuide, edit: { kind: "writable", saveEffect: "commit" } }, sessionInventory.scope))
      .toMatch(/^Saving commits this one file in the project's main checkout/u);
    expect(saveConsequence({ ...testingGuide, edit: { kind: "writable", saveEffect: "file-only" } }, settingsInventory.scope))
      .toBe("Saving writes the file. Sessions read it when they start or reload.");
    expect(saveConsequence(mobbin, settingsInventory.scope)).toBeUndefined();
  });

  it("reports each save effect after the fact", () => {
    expect(savedMessage({ kind: "committed", sha: "0123456789abcdef0123456789abcdef01234567", branch: "main" })).toBe("Saved and committed as 0123456 on main.");
    expect(savedMessage({ kind: "uncommitted" })).toBe("Saved. The change is not committed.");
    expect(savedMessage({ kind: "unchanged" })).toBe("Nothing changed, so nothing was saved.");
  });

  it("keeps the draft on a conflict and never offers a blind retry after a failed commit", () => {
    expect(refusalAdvice("conflict", false)).toMatch(/Your edits are still here/u);
    expect(refusalAdvice("commit-failed", true)).toMatch(/Check the checkout's Git status/u);
    expect(refusalAdvice("io-error", false)).toBeUndefined();
    expect(refusalAdvice("io-error", true)).toMatch(/Read it again/u);
  });
});
