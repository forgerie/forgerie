import { describe, expect, it } from "vitest";
import { maintenance, maintenanceDocument, brokenMaintenance, MAINTENANCE_TEXT } from "./fixtures/triggerFiles";
import { HOST_ZONE, NOW, projects, FORGERIE } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";
import {
  dayTimeWords, descriptionOf, inputOverrides, invalidWords, lineOf, saveRequestOf, savingWords, scheduleBlockOf, scheduleDraftOf, settingsChanged,
} from "./triggerFile";

const start = scheduleDraftOf(maintenance, maintenanceDocument, HOST_ZONE);
const block = (change: Partial<typeof start>) =>
  scheduleBlockOf({ trigger: maintenance, document: maintenanceDocument, start, draft: { ...start, ...change }, projects });

describe("the side panel's draft and the schedule block it writes", () => {
  it("starts from the file's block: time, zone, late, model, and the projects the server resolved", () => {
    expect(start).toMatchObject({ at: "01:00", repeat: "daily", timezone: "America/Denver", grace: 360, model: "openai/gpt-5", paused: false, inputs: {} });
    expect(start.targets).toEqual(maintenance.action.targets);
    expect(settingsChanged(start, start)).toBe(false);
  });
  it("changes only the keys the reader changed, so a project name stays a name", () => {
    expect(block({ at: "02:00" })).toEqual({ ...maintenanceDocument.schedule, at: "02:00" });
    expect(block({ repeat: "days", days: ["mon", "fri"] })).toEqual({ ...maintenanceDocument.schedule, days: ["mon", "fri"] });
    expect(block({ grace: 0 })).toEqual({ ...maintenanceDocument.schedule, late: "0" });
    expect(block({ model: undefined })).not.toHaveProperty("model");
    expect(block({ model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high" }).model).toBe("anthropic/claude-sonnet-4-5:high");
    expect(block({ targets: { kind: "projects", cwds: [FORGERIE, "/elsewhere"] } }).projects).toEqual(["forgerie", "/elsewhere"]);
    expect(block({ targets: { kind: "all" } }).projects).toBe("all");
    expect(block({ paused: true }).paused).toBe(true);
  });
  it("writes a whole block from the panel when the file has none the server could read", () => {
    const fallback = scheduleDraftOf(brokenMaintenance, undefined, HOST_ZONE);
    expect(scheduleBlockOf({ trigger: brokenMaintenance, document: undefined, start: fallback, draft: { ...fallback, at: "01:30" }, projects }))
      .toEqual({ name: "Nightly maintenance", at: "01:30", timezone: HOST_ZONE, late: "6h", projects: ["forgerie", "pi-mono", "caliper"], model: "openai/gpt-5" });
  });
  it("keeps only inputs that differ from the file's defaults, typed as declared", () => {
    expect(inputOverrides(maintenanceDocument.definition, { improvements: "4", deadline: "180", commits: "" })).toEqual({ improvements: 4 });
  });
  it("sends the block with a save only when the panel changed", () => {
    const base = { trigger: maintenance, document: maintenanceDocument, start, projects, text: MAINTENANCE_TEXT, baseSha256: maintenanceDocument.sha256 };
    expect(saveRequestOf({ ...base, draft: start })).toEqual({ text: MAINTENANCE_TEXT, baseSha256: maintenanceDocument.sha256 });
    expect(saveRequestOf({ ...base, draft: { ...start, at: "02:00" } }).schedule?.at).toBe("02:00");
  });
});

describe("the file page's words", () => {
  it("reads the description from the front matter, one line or folded", () => {
    expect(descriptionOf(MAINTENANCE_TEXT)).toMatch(/^Fix failing tests, keep checks fast/u);
    expect(descriptionOf("---\ndescription: >\n  Two\n  lines\nname: x\n---\nBody")).toBe("Two lines");
    expect(descriptionOf("No front matter")).toBeUndefined();
    expect(lineOf(MAINTENANCE_TEXT, "stages")).toBe(25);
  });
  it("says what Save does: the next run and where it reads the file", () => {
    expect(savingWords({ ...start, at: "02:00" }, start, clock, projectLabel))
      .toEqual({ before: "Saving writes the file. The next run, ", when: "Tue at 2:00 AM", after: ", reads it in all 3 projects. Launches by hand read it too." });
    expect(savingWords({ ...start, paused: true }, start, clock, projectLabel).before).toMatch(/pauses the trigger/u);
  });
  it("says which line is wrong and what runs tonight", () => {
    expect(invalidWords(brokenMaintenance, brokenMaintenance.file!, clock, projectLabel)).toEqual({
      line: 5, title: "Line 5 of the file has an error.", message: "`at` must be a time such as \"01:00\". The file now says \"1am\".",
      running: "Tonight's run uses the last good version, saved today at 9:41 AM: every night at 1:00 AM, 3 projects.",
    });
  });
  it("names a version's day in the browser's zone", () => {
    expect(dayTimeWords(NOW - 3_600_000, clock)).toBe("Today, 5:00 PM");
    expect(dayTimeWords(NOW - 86_400_000, clock)).toBe("Yesterday, 6:00 PM");
    expect(dayTimeWords(Date.UTC(2026, 9, 1, 18), clock)).toBe("Oct 1, 12:00 PM");
  });
});
