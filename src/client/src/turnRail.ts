import type { ChatGroup } from "./chatGroups";
import { codemodeExecution, isCodemodeExecution } from "./codemodeExecution";
import type { ToolExecutionPart } from "./components/shared";

/** How far a step got. The wire's four statuses collapse to the three a reader acts on. */
export type TurnStepOutcome = "working" | "done" | "failed";

/**
 * One tool step, reduced to what the rail can say about it on a single line.
 *
 * `target` is the identity used for supersession and must stay boringly
 * literal -- the exact argument, never a semantic guess. `label` is the same
 * thing shortened for display, because the full path is what made the old
 * tool cards unreadable at folded-portrait width.
 */
export interface TurnStep {
  readonly verb: string;
  readonly target?: string;
  readonly label: string;
  readonly outcome: TurnStepOutcome;
  /** First sentence of the failure, with the path clause dropped; the line already names the target. */
  readonly evidence?: string;
}

/** One row in the expanded ledger, plus the real execution its detail opens. */
export interface TurnLedgerRow extends TurnStep {
  readonly key: string;
  readonly editCount?: number;
  /** Calls a `codemode` script made: the one quantity a script step owns. */
  readonly callCount?: number;
  readonly added: number;
  readonly removed: number;
  readonly execution: ToolExecutionPart;
}

interface TurnRailAggregate {
  readonly stepCount: number;
  readonly fileCount: number;
  readonly added: number;
  readonly removed: number;
  readonly retries: number;
}

/**
 * What the turn rail is, at any moment.
 *
 * Three cases, because a reader only ever asks three questions: is anything
 * happening, what broke, and what did the turn cost. Active and settled turns
 * share one aggregate contract, so their collapsed information cannot drift.
 */
export type TurnRailState =
  | { readonly kind: "idle" }
  | (TurnRailAggregate & {
    readonly kind: "working";
    /** Unresolved failures, oldest first. The only thing that makes the rail grow. */
    readonly pins: readonly TurnStep[];
    /** The step running right now; absent between steps, when the agent is thinking. */
    readonly current?: TurnStep;
  })
  | (TurnRailAggregate & {
    readonly kind: "settled";
    readonly outcome: "done" | "failed";
    /** Pins nothing superseded before the turn ended. Non-empty exactly when `outcome` is "failed". */
    readonly unresolved: readonly TurnStep[];
  });

/** Verbs whose target is a path on disk, and so count toward "files touched". */
const FILE_VERBS = new Set(["read", "edit", "write"]);

const MAX_EVIDENCE = 100;

/**
 * Reduce a turn's rail groups to the state the rail renders.
 *
 * The whole point of the register is that success never accumulates: steps
 * replace one another in `current`, and only unresolved failures survive as
 * `pins`. A turn that goes well therefore reads as one line whether it ran two
 * steps or twenty.
 */
export function turnRailState(groups: readonly ChatGroup[], live: boolean): TurnRailState {
  const steps = turnSteps(groups);
  if (steps.length === 0) return { kind: "idle" };

  const { pins, retries } = resolvePins(steps);
  const diff = countDiff(groups);
  const aggregate = {
    stepCount: steps.length,
    fileCount: countFiles(steps),
    added: diff.added,
    removed: diff.removed,
    retries,
  };
  if (live) {
    const current = lastWorkingStep(steps);
    return {
      kind: "working",
      pins,
      ...(current === undefined ? {} : { current }),
      ...aggregate,
    };
  }

  return {
    kind: "settled",
    // The receipt takes the worst standing state: one surviving pin makes the
    // whole turn failed, however much else landed.
    outcome: pins.length === 0 ? "done" : "failed",
    ...aggregate,
    unresolved: pins,
  };
}

/** Every tool step in a turn's rail groups, in the order the agent ran them. */
export function turnSteps(groups: readonly ChatGroup[]): TurnStep[] {
  return toolExecutions(groups).map(toTurnStep);
}

/**
 * The compact middle depth between a receipt and a full tool card.
 *
 * Rows only expose facts already carried by the execution: edit count from
 * args, diff quantities from details, and outcome from status. A verb with no
 * meaningful quantity leaves that space empty rather than inventing a grid to
 * fill. The original execution stays attached so opening the row can reuse the
 * shipped detail view instead of duplicating its failure handling and diff UI.
 */
export function turnLedgerRows(groups: readonly ChatGroup[]): TurnLedgerRow[] {
  return toolExecutions(groups).map((execution, index) => {
    const step = toTurnStep(execution);
    const diff = executionDiffStats(execution);
    const editCount = executionEditCount(execution);
    const callCount = isCodemodeExecution(execution) ? codemodeExecution(execution).calls.length : undefined;
    return {
      ...step,
      key: execution.toolCallId ?? `${String(index)}:${execution.toolName}:${step.target ?? step.label}`,
      ...(editCount === undefined ? {} : { editCount }),
      ...(callCount === undefined || callCount === 0 ? {} : { callCount }),
      added: diff.added,
      removed: diff.removed,
      execution,
    };
  });
}

/**
 * The literal identity a step is retried against.
 *
 * Exported because supersession, display, and the tool card must agree on what
 * a step is "about"; two definitions of target would let a pin clear against a
 * step the reader does not consider the same work.
 */
export function turnStepTarget(execution: ToolExecutionPart): string | undefined {
  const args = execution.args;
  if (FILE_VERBS.has(execution.toolName)) return stringArg(args, "path") ?? stringArg(args, "file_path");
  if (execution.toolName === "bash") return stringArg(args, "command");
  if (execution.toolName === "process") return stringArg(args, "name");
  if (execution.toolName === "subagent") return stringArg(args, "agent");
  return stringArg(args, "path") ?? stringArg(args, "file_path") ?? stringArg(args, "command");
}

function toTurnStep(execution: ToolExecutionPart): TurnStep {
  const target = turnStepTarget(execution);
  const outcome = stepOutcome(execution.status);
  const evidence = outcome === "failed" ? failureEvidence(failureText(execution)) : undefined;
  return {
    verb: execution.toolName,
    ...(target === undefined ? {} : { target }),
    label: stepLabel(execution, target),
    outcome,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

/**
 * Walk the pins forward, clearing each one only against its own verb and
 * target. Strictness is the point: a green `edit` says nothing about a red
 * `verify`, and a false clear hides a failure the receipt would otherwise
 * report.
 */
function resolvePins(steps: readonly TurnStep[]): { pins: TurnStep[]; retries: number } {
  const pins: TurnStep[] = [];
  let retries = 0;
  for (const step of steps) {
    if (step.outcome === "failed") {
      pins.push(step);
      continue;
    }
    if (step.outcome !== "done" || step.target === undefined) continue;
    const superseded = pins.findIndex((pin) => pin.verb === step.verb && pin.target === step.target);
    if (superseded === -1) continue;
    pins.splice(superseded, 1);
    retries += 1;
  }
  return { pins, retries };
}

/** The heartbeat only shows genuinely live work; between steps it shows nothing. */
function lastWorkingStep(steps: readonly TurnStep[]): TurnStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.outcome === "working") return step;
  }
  return undefined;
}

function countFiles(steps: readonly TurnStep[]): number {
  const files = new Set<string>();
  for (const step of steps) {
    if (FILE_VERBS.has(step.verb) && step.target !== undefined) files.add(step.target);
  }
  return files.size;
}

function countDiff(groups: readonly ChatGroup[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const execution of toolExecutions(groups)) {
    const stats = executionDiffStats(execution);
    added += stats.added;
    removed += stats.removed;
  }
  return { added, removed };
}

function executionDiffStats(execution: ToolExecutionPart): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  const diff = stringArg(execution.details, "diff");
  if (diff === undefined) return { added, removed };
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function executionEditCount(execution: ToolExecutionPart): number | undefined {
  if (execution.toolName !== "edit") return undefined;
  const edits = property(execution.args, "edits");
  if (Array.isArray(edits)) return edits.length;
  return typeof property(execution.args, "oldText") === "string" && typeof property(execution.args, "newText") === "string"
    ? 1
    : undefined;
}

function toolExecutions(groups: readonly ChatGroup[]): ToolExecutionPart[] {
  const executions: ToolExecutionPart[] = [];
  for (const group of groups) {
    if (group.kind !== "group") continue;
    for (const message of group.messages) {
      for (const part of message.parts) {
        if (part.type === "toolExecution") executions.push(part);
      }
    }
  }
  return executions;
}

function stepOutcome(status: ToolExecutionPart["status"]): TurnStepOutcome {
  if (status === "success") return "done";
  if (status === "error") return "failed";
  return "working";
}

function stepLabel(execution: ToolExecutionPart, target: string | undefined): string {
  if (target === undefined) return execution.summary === "" ? execution.toolName : execution.summary;
  if (!FILE_VERBS.has(execution.toolName)) return target;
  return basename(target);
}

/** Directory targets keep their trailing slash, so `app/src/` does not read as a file called `src`. */
function basename(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const suffix = path.endsWith("/") ? "/" : "";
  return name === "" ? path : `${name}${suffix}`;
}

/**
 * The text that says why a step failed. A script's result opens with Pi's run
 * header, so its reason is the script error that ends the result.
 */
function failureText(execution: ToolExecutionPart): string | undefined {
  if (!isCodemodeExecution(execution)) return execution.resultText;
  const view = codemodeExecution(execution);
  return view.scriptError ?? view.output;
}

/**
 * One line of why a step failed.
 *
 * Tool errors restate the absolute path they were given, which is exactly the
 * duplication this register exists to remove -- the pin already names the
 * target. Drop the path clause first, then keep the first sentence.
 */
function failureEvidence(resultText: string | undefined): string | undefined {
  if (resultText === undefined) return undefined;
  // The path may end the sentence, so the match must stop before trailing
  // punctuation -- otherwise the terminator goes with it and two sentences merge.
  const withoutPaths = resultText.replace(/\s+in\s+\/\S*[^\s.,;:]/g, "").trim();
  if (withoutPaths === "") return undefined;
  const sentence = /^[^.!?]*[.!?]/.exec(withoutPaths)?.[0] ?? withoutPaths.split("\n")[0] ?? withoutPaths;
  const trimmed = sentence.trim();
  return trimmed.length > MAX_EVIDENCE ? `${trimmed.slice(0, MAX_EVIDENCE - 1).trimEnd()}…` : trimmed;
}

function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringArg(value: unknown, key: string): string | undefined {
  const valueAtKey = property(value, key);
  return typeof valueAtKey === "string" && valueAtKey !== "" ? valueAtKey : undefined;
}
