import { expect, it } from "vitest";
import { Check } from "typebox/value";
import { lateMinutes, lateText, TriggerFileStateSchema, type TriggerFileState } from "../../shared/triggerFiles.js";
import { editScheduleBlock, parseScheduledWorkflow } from "./triggerFileFormat.js";

const file = (schedule: string) => `---\n# keep this\ndescription: Night\nworkflow: { version: 1, inputs: { scope: { type: string, default: ready } } }\nschedule:\n${schedule}\n---\nReview.\n`;
it("parses defaults, selected days, late and a model thinking suffix", () => {
  const parsed = parseScheduledWorkflow("night", "/night.md", file('  at: "03:00"\n  days: [mon, fri]\n  projects: all\n  late: 1d\n  model: provider/model:high'), "UTC");
  expect(parsed?.input).toMatchObject({ id: "night", name: "night", schedule: { kind: "weekly", on: ["mon", "fri"], timezone: "UTC" }, missedGraceMinutes: 1440, action: { model: "provider/model", thinkingLevel: "high", inputs: { scope: "ready" } } });
});
it.each([
  ['  at: "25:00"\n  projects: all', "at"],
  ['  at: "03:00"\n  projects: all\n  typo: true', "typo"],
  ['  at: "03:00"\n  projects: all\n  late: 8d', "late"],
  ['  at: "03:00"\n  projects: all\n  timezone: Moon/Sea', "timezone"],
  ['  at: "03:00"\n  projects: all\n  inputs: { scope: 1 }', "inputs"],
  ['  at: "03:00"\n  projects: all\n  inputs: { unknown: true }', "inputs"],
])("rejects invalid schedule %s with a source line", (schedule, field) => {
  try { parseScheduledWorkflow("night", "/night.md", file(schedule), "UTC"); expect.fail("Expected error"); }
  catch (error) { expect(error).toHaveProperty("line"); expect(error).toMatchObject({ status: 400, field: `schedule.${field}`,  }); }
});
it("keeps comments, key order and prose when replacing a schedule", () => {
  const text = file('  at: "03:00" # run time\n  projects: all');
  const edited = editScheduleBlock(text, { at: "04:00", projects: "all", paused: true });
  expect(edited).toContain("# keep this"); expect(edited).toContain("# run time");
  expect(edited.indexOf("description:")).toBeLessThan(edited.indexOf("workflow:"));
  expect(edited.indexOf("workflow:")).toBeLessThan(edited.indexOf("schedule:"));
  expect(edited.endsWith("---\nReview.\n")).toBe(true);
  expect(parseScheduledWorkflow("night", "/night.md", editScheduleBlock(edited, null), "UTC")).toBeUndefined();
});
it("rejects malformed YAML and workflow prose", () => {
  expect(() => parseScheduledWorkflow("night", "/night.md", file('  at: [\n  projects: all'), "UTC")).toThrow();
  expect(() => parseScheduledWorkflow("night", "/night.md", file('  at: "03:00"\n  projects: all').replace("Review.", ""), "UTC")).toThrow("empty");
});
it("converts late values without allowing more than seven days", () => {
  for (const [text, minutes] of [["0", 0], ["45m", 45], ["6h", 360], ["1d", 1440]] as const) { expect(lateMinutes(text)).toBe(minutes); expect(lateText(minutes)).toBe(text); }
  for (const value of ["8d", "-1h", "0h", "1000000000000000000000d"]) expect(lateMinutes(value)).toBeUndefined();
});

it("validates computed file diagnostics with one-based source lines", () => {
  const state: TriggerFileState = { path: "/night.md", status: "invalid", problem: { message: "Invalid time", line: 6 } };
  expect(Check(TriggerFileStateSchema, state)).toBe(true);
  expect(Check(TriggerFileStateSchema, { ...state, problem: { message: "Invalid time", line: 0 } })).toBe(false);
});

it("accepts a 64-character workflow file name and rejects a blank display name", () => {
  const name = "n".repeat(64);
  expect(parseScheduledWorkflow(name, `/${name}.md`, file('  at: "03:00"\n  projects: all'), "UTC")?.input.id).toBe(name);
  expect(() => parseScheduledWorkflow("night", "/night.md", file('  name: "  "\n  at: "03:00"\n  projects: all'), "UTC")).toThrow("non-empty name");
});

it("limits the base model to 128 characters independently of its thinking suffix", () => {
  const model = `p/${"m".repeat(126)}`;
  expect(parseScheduledWorkflow("night", "/night.md", file(`  at: "03:00"\n  projects: all\n  model: ${model}:minimal`), "UTC")?.input.action).toMatchObject({ model, thinkingLevel: "minimal" });
  for (const invalid of [`${model}m`, `${model}m:high`, `${model}:unknown`]) {
    expect(() => parseScheduledWorkflow("night", "/night.md", file(`  at: "03:00"\n  projects: all\n  model: ${invalid}`), "UTC")).toThrow();
  }
});
