import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { WorkflowDefinitionSchema, WorkflowInputsSchema, type WorkflowDefinition, type WorkflowInputs } from "../../shared/workflowRuns.js";
import { routeProblems } from "../../shared/workflowStops.js";
import { readResourceFile, isMissingResource } from "./resourceEditorFiles.js";
import { promptNameProblem } from "./promptLibrary.js";

export class WorkflowError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}
export interface ProseWorkflow {
  name: string; path: string; sha256: string; text: string; body: string; definition: WorkflowDefinition;
  /** The prompt file's own description, for pickers. */
  description?: string;
}
export interface WorkflowInventory { workflows: ProseWorkflow[]; diagnostics: { name: string; path: string; error: string }[] }

/** Prompt files remain the single authoring system. Invalid project overrides never fall back to a profile file. */
export class WorkflowLibrary {
  constructor(private readonly agentDir: string) {}
  async list(cwd: string): Promise<WorkflowInventory> {
    const result: WorkflowInventory = { workflows: [], diagnostics: [] };
    const seen = new Set<string>();
    for (const dir of [join(cwd, ".pi", "prompts"), join(this.agentDir, "prompts")]) {
      const files = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => { if (isMissingResource(error)) return []; throw error; });
      for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!file.name.endsWith(".md") || (!file.isFile() && !file.isSymbolicLink())) continue;
        const name = file.name.slice(0, -3);
        if (seen.has(name)) continue;
        seen.add(name);
        const path = join(dir, file.name);
        try {
          const { text } = await readResourceFile(path);
          const parsed = parseFrontmatter(text);
          if (parsed.frontmatter["workflow"] === undefined) continue;
          result.workflows.push(parseWorkflow(name, path, text));
        } catch (error) { result.diagnostics.push({ name, path, error: error instanceof Error ? error.message : String(error) }); }
      }
    }
    return result;
  }
  async read(cwd: string, name: string): Promise<ProseWorkflow> {
    if (promptNameProblem(name) !== undefined) throw new WorkflowError(400, "Invalid workflow name");
    for (const dir of [join(cwd, ".pi", "prompts"), join(this.agentDir, "prompts")]) {
      const path = join(dir, `${name}.md`);
      try { return parseWorkflow(name, path, (await readResourceFile(path)).text); }
      catch (error) { if (!isMissingResource(error)) throw error; }
    }
    throw new WorkflowError(404, `No workflow named ${name}`);
  }
}

export function parseWorkflow(name: string, path: string, text: string): ProseWorkflow {
  if (promptNameProblem(name) !== undefined) throw new WorkflowError(400, "Invalid workflow name");
  const { frontmatter, body } = parseFrontmatter(text);
  const definition: unknown = frontmatter["workflow"];
  if (!Check(WorkflowDefinitionSchema, definition)) throw new WorkflowError(400, "Expected workflow frontmatter with version: 1, typed inputs, and optional stages");
  const problems = routeProblems(definition.stages ?? []);
  if (problems.length > 0) throw new WorkflowError(400, `Invalid workflow stages: ${problems.join("; ")}`);
  if (body.trim() === "") throw new WorkflowError(400, "Workflow prose is empty");
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    const accepts = (value: string | number | boolean) => typeof value === input.type && (input.choices === undefined || input.choices.includes(value));
    if (input.choices?.some((value) => typeof value !== input.type) === true || (input.default !== undefined && !accepts(input.default))) {
      throw new WorkflowError(400, `Invalid choices or default for input ${name}`);
    }
  }
  const description = typeof frontmatter["description"] === "string" && frontmatter["description"].trim() !== "" ? frontmatter["description"].trim() : undefined;
  return { name, path, text, body, definition, sha256: createHash("sha256").update(text).digest("hex"), ...(description === undefined ? {} : { description }) };
}

export function workflowInputs(definition: WorkflowDefinition, supplied: WorkflowInputs): WorkflowInputs {
  if (!Check(WorkflowInputsSchema, supplied)) throw new WorkflowError(400, "Invalid workflow inputs");
  const fields = definition.inputs ?? {};
  for (const name of Object.keys(supplied)) if (!Object.hasOwn(fields, name)) throw new WorkflowError(400, `Unknown workflow input ${name}`);
  const result: WorkflowInputs = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = Object.hasOwn(supplied, name) ? supplied[name] : field.default;
    if (value === undefined || typeof value !== field.type || (field.choices !== undefined && !field.choices.includes(value))) {
      throw new WorkflowError(400, `Input ${name} requires ${field.type}${field.choices === undefined ? "" : ` from ${JSON.stringify(field.choices)}`}`);
    }
    result[name] = value;
  }
  return result;
}

export function workflowPrompt(runId: string, workflow: ProseWorkflow, inputs: WorkflowInputs): string {
  // Do not interpolate arbitrary user values into instructions or expand slash commands a second time.
  const stages = workflow.definition.stages ?? [];
  const route = stages.length === 0 ? "" : `\n\nRoute (stages in order):\n${stages.map(stageLine).join("\n")}\n\n${STOP_RULES.replaceAll("RUN_ID", runId)}`;
  return `Workflow run ${runId}\n\n${workflow.body}${route}\n\nWorkflow inputs (JSON):\n${JSON.stringify(inputs)}\n\nCoordinate this workflow in this conversation. Use child_agent for tracked delegation; legacy subagent runs are not part of this record. ${stages.length === 0 ? "Its sequence, models, reviews, and human involvement come from the prose above." : "The prose above guides how you run each stage."} When all associated child work and reports settle, call workflow_finish with runId "${runId}", outcome (completed, failed, or stopped), and a final result. Idle pauses do not finish the run.`;
}

const STOP_RULES = `A stage marked "stop" is the user's. Forgerie holds the run there: when the work for that stop is ready, call workflow_stop with runId "RUN_ID", the stage id, and a short summary of what the user decides on, then end your turn. The user's decision arrives as a new message. Until the user approves a stop, child_agent refuses work that belongs after it. At a land stop, Forgerie lands the children's branches itself when the user chooses to; do not land, merge, or push them yourself. Name each child after its declared worker so its work joins the right stage.`;

function stageLine(stage: NonNullable<WorkflowDefinition["stages"]>[number], index: number): string {
  const kind = stage.stop === "approve" ? " [stop: the user approves]" : stage.stop === "land" ? " [stop: the user lands the branches]" : "";
  const workers = (stage.workers ?? []).map((worker) => `${worker.name}${worker.agent === undefined ? "" : ` (agent ${worker.agent}${worker.model === undefined ? "" : `, model ${worker.model}`})`}`);
  return `${String(index + 1)}. ${stage.name} (id ${stage.id})${kind}${stage.does === undefined ? "" : `: ${stage.does}`}${workers.length === 0 ? "" : ` Workers: ${workers.join(", ")}.`}`;
}

export function assertProseOnly(workflow: ProseWorkflow): void {
  if (/^\s*[\x60~]{3,}\s*(?:js|javascript)\s+workflow\b/imu.test(workflow.body)) throw new WorkflowError(409, "Workflow scripts are saved but cannot run until a script runtime is selected");
}
