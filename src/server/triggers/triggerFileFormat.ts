import { isMap, isNode, LineCounter, parseDocument } from "yaml";
import { Check, Errors } from "typebox/value";
import { DEFAULT_LATE, lateMinutes, WorkflowScheduleBlockSchema, type WorkflowScheduleBlock } from "../../shared/triggerFiles.js";
import { TriggerActionSchema, TriggerIdSchema, type TriggerCreate } from "../../shared/triggers.js";
import { parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import { parseModelReference } from "../../shared/thinkingLevels.js";
import { assertProseOnly, parseWorkflow, workflowInputs } from "../resources/workflowLibrary.js";
import { TriggerError } from "./durableTriggers.js";

/** YAML's Document API retains comments and insertion order; only the front matter is serialized on edit. */
function frontmatter(text: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (match?.index !== 0) throw new TriggerError("Expected YAML front matter", 400, undefined, 1);
  const yaml = match[1] ?? "";
  const counter = new LineCounter();
  const document = parseDocument(yaml, { lineCounter: counter });
  const error = document.errors[0];
  if (error !== undefined) throw new TriggerError(error.message, 400, undefined, (error.linePos?.[0].line ?? counter.linePos(error.pos[0]).line) + 1);
  if (!isMap(document.contents)) throw new TriggerError("Front matter must be a mapping", 400, undefined, 2);
  const line = (keys: string[]) => {
    for (let length = keys.length; length > 0; length--) {
      const node = document.getIn(keys.slice(0, length), true);
      if (isNode(node) && node.range != null) return counter.linePos(node.range[0]).line + 1;
    }
    return 2;
  };
  return { document, body: text.slice(match[0].length), line };
}

export function editScheduleBlock(text: string, block: WorkflowScheduleBlock | null): string {
  const { document, body } = frontmatter(text);
  if (block === null) document.delete("schedule");
  else if (isMap(document.get("schedule", true))) {
    const current = document.get("schedule", true);
    if (isMap(current)) for (const pair of [...current.items]) {
      if (isNode(pair.key) && "value" in pair.key && typeof pair.key.value === "string" && !Object.hasOwn(block, pair.key.value)) current.delete(pair.key.value);
    }
    for (const [key, value] of Object.entries(block)) document.setIn(["schedule", key], value);
  } else document.set("schedule", block);
  return `---\n${document.toString()}---\n${body}`;
}

export function parseScheduledWorkflow(name: string, path: string, text: string, timezone: string) {
  if (!/^(?:\uFEFF)?---\r?\n/u.test(text)) return undefined;
  const parsed = frontmatter(text);
  const node = parsed.document.get("schedule", true);
  const value: unknown = isNode(node) ? node.toJSON() : node;
  if (value === undefined) return undefined;
  const problem = (message: string, key?: string): never => { throw new TriggerError(message, 400, key === undefined ? "schedule" : `schedule.${key}`, parsed.line(key === undefined ? ["schedule"] : ["schedule", key])); };
  if (!Check(WorkflowScheduleBlockSchema, value)) {
    const first = Errors(WorkflowScheduleBlockSchema, value)[0];
    const extra = first?.keyword === "additionalProperties" ? first.params.additionalProperties[0] : undefined;
    problem(first?.message ?? "Invalid schedule block", extra ?? first?.instancePath.split("/")[1]);
  }
  // TypeBox validation above is also the runtime boundary for the file's untrusted values.
  if (!Check(WorkflowScheduleBlockSchema, value)) throw new Error("Invalid schedule");
  if (!Check(TriggerIdSchema, name)) problem("Scheduled workflow names must contain lowercase letters, digits or hyphens (at most 64 characters)");
  const block = value;
  if (block.name?.trim() === "") problem("Give the schedule a non-empty name", "name");
  const missedGraceMinutes = lateMinutes(block.late ?? DEFAULT_LATE);
  if (missedGraceMinutes === undefined) return problem("late must be 0 or a duration of at most seven days", "late");
  const schedule = block.days === undefined ? { kind: "daily" as const, at: block.at, timezone: block.timezone ?? timezone } : { kind: "weekly" as const, at: block.at, timezone: block.timezone ?? timezone, on: block.days };
  try { parseTriggerSchedule(schedule); } catch (error) { problem(error instanceof Error ? error.message : String(error), "timezone"); }
  let workflow;
  try { workflow = parseWorkflow(name, path, text); assertProseOnly(workflow); }
  catch (error) { throw new TriggerError(error instanceof Error ? error.message : String(error), 400, "workflow", parsed.line(["workflow"])); }
  let inputs;
  try { inputs = workflowInputs(workflow.definition, block.inputs ?? {}); }
  catch (error) { problem(error instanceof Error ? error.message : String(error), "inputs"); }
  const input: TriggerCreate = { id: name, name: block.name ?? name, schedule, missedGraceMinutes,
    action: { kind: "workflow", workflow: name, targets: block.projects === "all" ? { kind: "all" } : { kind: "projects", cwds: block.projects }, inputs: inputs ?? {}, ...(block.model === undefined ? {} : parseModelReference(block.model)) } };
  if (!Check(TriggerActionSchema, input.action)) {
    const error = Errors(TriggerActionSchema, input.action)[0];
    const key = error?.instancePath.split("/")[1];
    problem(error?.message ?? "Invalid scheduled workflow action", key === "targets" ? "projects" : key === "thinkingLevel" ? "model" : key);
  }
  return { block, input, workflow, projectsLine: parsed.line(["schedule", "projects"]), modelLine: parsed.line(["schedule", "model"]) };
}
