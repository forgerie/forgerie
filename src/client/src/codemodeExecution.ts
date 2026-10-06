import { CODEMODE_TOOL_NAME } from "../../shared/codemodeScript";
import type { ToolExecutionPart } from "./components/shared";

/** Pi's statuses for a call a script made. `cancelled` means the script ended first. */
export type CodemodeCallStatus = "running" | "ok" | "error" | "cancelled";

/** One call a script made, as the card lists it. */
export interface CodemodeCall {
  readonly key: string;
  readonly name: string;
  /** The argument a reader identifies the call by: a command, a path, or else the compact arguments. */
  readonly target: string;
  readonly status: CodemodeCallStatus;
  readonly durationMs?: number;
  /** Cost in USD of a `models.*` call; tool calls carry none. */
  readonly costUsd?: number;
  readonly error?: string;
}

/**
 * What a `codemode` execution says, read from the shapes Pi gives it.
 *
 * The call list is Pi's `details.calls`, which Pi refreshes while the script
 * runs and keeps on the tool result, so a live card and a reloaded one draw
 * the same rows. The text is the script's output with Pi's run header lifted
 * out into `wallTimeSeconds`, and a failure's `Script error:` block lifted out
 * into `scriptError`.
 */
export interface CodemodeExecution {
  readonly script: string;
  readonly calls: readonly CodemodeCall[];
  readonly output: string;
  readonly scriptError?: string;
  readonly wallTimeSeconds?: number;
  /** Where Pi wrote the whole output when it shortened what the model saw. */
  readonly fullOutputPath?: string;
  /** Total cost of the script's `models.*` calls, when any reported one. */
  readonly modelCostUsd?: number;
}

const RUN_HEADER = /^Script (?:completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n$/u;
const SCRIPT_ERROR_PREFIX = "Script error:\n";
const TARGET_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "name", "agent"] as const;
const CALL_STATUSES: readonly CodemodeCallStatus[] = ["running", "ok", "error", "cancelled"];

export function isCodemodeExecution(execution: ToolExecutionPart): boolean {
  return execution.toolName === CODEMODE_TOOL_NAME;
}

export function codemodeExecution(execution: ToolExecutionPart): CodemodeExecution {
  const calls = codemodeCalls(execution.details);
  const text = codemodeText(execution);
  const fullOutputPath = stringProperty(execution.details, "fullOutputPath");
  const modelCostUsd = calls.reduce<number | undefined>((total, call) => call.costUsd === undefined ? total : (total ?? 0) + call.costUsd, undefined);
  return {
    script: stringProperty(execution.args, "code") ?? "",
    calls,
    output: text.output,
    ...(text.scriptError === undefined ? {} : { scriptError: text.scriptError }),
    ...(text.wallTimeSeconds === undefined ? {} : { wallTimeSeconds: text.wallTimeSeconds }),
    ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
    ...(modelCostUsd === undefined ? {} : { modelCostUsd }),
  };
}

/** The newest call still running, which is what the script is doing right now. */
export function codemodeCurrentCall(execution: ToolExecutionPart): CodemodeCall | undefined {
  if (!isCodemodeExecution(execution) || execution.status !== "running") return undefined;
  const calls = codemodeCalls(execution.details);
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call?.status === "running") return call;
  }
  return undefined;
}

/** Durations as Pi's terminal shows them: milliseconds under a second, then tenths of seconds. */
export function formatCodemodeDuration(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Cents for larger amounts, two significant digits for the fractions of a cent classifier calls cost. */
export function formatCodemodeCost(costUsd: number): string {
  return `$${costUsd >= 0.01 ? costUsd.toFixed(2) : costUsd.toPrecision(2)}`;
}

function codemodeCalls(details: unknown): CodemodeCall[] {
  const calls = property(details, "calls");
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call: unknown, index): CodemodeCall[] => {
    const name = stringProperty(call, "name");
    const status = CALL_STATUSES.find((candidate) => candidate === stringProperty(call, "status"));
    if (name === undefined || status === undefined) return [];
    const durationMs = finiteNumberProperty(call, "durationMs");
    const costUsd = finiteNumberProperty(call, "cost");
    const error = stringProperty(call, "error");
    return [{
      // Pi gives a call its final id only once it settles; until then several
      // calls share a placeholder, so the position is the stable identity.
      key: String(index),
      name,
      target: callTarget(stringProperty(call, "args") ?? ""),
      status,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(costUsd === undefined || costUsd === 0 ? {} : { costUsd }),
      ...(error === undefined || error === "" ? {} : { error }),
    }];
  });
}

/**
 * Pi gives arguments as compact JSON cut to a display length, so the JSON may
 * not parse. A cut argument still reads better raw than not at all.
 */
function callTarget(args: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return args;
  }
  for (const key of TARGET_KEYS) {
    const value = stringProperty(parsed, key);
    if (value !== undefined && value !== "") return value;
  }
  return args === "{}" ? "" : args;
}

function codemodeText(execution: ToolExecutionPart): { output: string; scriptError?: string; wallTimeSeconds?: number } {
  const items = textItems(execution);
  let wallTimeSeconds: number | undefined;
  const first = items[0];
  const header = first === undefined ? null : RUN_HEADER.exec(first);
  if (header !== null) {
    items.shift();
    const seconds = Number(header[1]);
    if (Number.isFinite(seconds)) wallTimeSeconds = seconds;
  }
  let scriptError: string | undefined;
  const last = items.at(-1);
  if (last?.startsWith(SCRIPT_ERROR_PREFIX) === true) {
    items.pop();
    scriptError = last.slice(SCRIPT_ERROR_PREFIX.length).trim();
  }
  return {
    output: items.map((item) => item.replace(/\n$/u, "")).join("\n").trim(),
    ...(scriptError === undefined ? {} : { scriptError }),
    ...(wallTimeSeconds === undefined ? {} : { wallTimeSeconds }),
  };
}

/** The result's text items in order; images render beside the card, not in it. */
function textItems(execution: ToolExecutionPart): string[] {
  if (Array.isArray(execution.content)) {
    return execution.content.flatMap((item: unknown) => {
      if (stringProperty(item, "type") !== "text") return [];
      const text = stringProperty(item, "text");
      return text === undefined ? [] : [text];
    });
  }
  return execution.resultText === undefined || execution.resultText === "" ? [] : [execution.resultText];
}

function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringProperty(value: unknown, key: string): string | undefined {
  const found = property(value, key);
  return typeof found === "string" ? found : undefined;
}

function finiteNumberProperty(value: unknown, key: string): number | undefined {
  const found = property(value, key);
  return typeof found === "number" && Number.isFinite(found) ? found : undefined;
}
