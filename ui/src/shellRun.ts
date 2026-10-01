import type { PiMessage, SessionEvent } from "./contracts";

/** One `!` command and what is known of its result. */
export type ShellResult =
  /** `clipped`: older live output was dropped to stay within {@link LIVE_OUTPUT_LIMIT}. */
  | { type: "running"; output: string; clipped?: boolean }
  | { type: "done"; output: string; exitCode?: number; cancelled: boolean; truncated: boolean; fullOutputPath?: string }
  /** The server could not run the command. `error` is its message. */
  | { type: "failed"; output: string; error: string }
  /** The row lost its end event, so its result is unknown. */
  | { type: "interrupted"; output: string };
/**
 * `command` and `excludeFromContext` are unknown when the client joined after
 * the command started. They are known again once the saved record loads.
 */
export interface ShellRun { command?: string; excludeFromContext?: boolean; result: ShellResult }
export type ShellEnd = Extract<SessionEvent, { type: "shell.end" }>;

function doneResult(fields: { output?: string | undefined; exitCode?: number | null | undefined; cancelled?: boolean | undefined;
  truncated?: boolean | undefined; fullOutputPath?: string | undefined }, fallbackOutput = ""): ShellResult {
  return { type: "done", output: fields.output ?? fallbackOutput, ...(fields.exitCode == null ? {} : { exitCode: fields.exitCode }),
    cancelled: fields.cancelled === true, truncated: fields.truncated === true,
    ...(fields.fullOutputPath ? { fullOutputPath: fields.fullOutputPath } : {}) };
}

export function runFromRecord(record: PiMessage): ShellRun {
  return { ...(record.command === undefined ? {} : { command: record.command }),
    excludeFromContext: record.excludeFromContext === true, result: doneResult(record) };
}
export function startedRun(command: string, excludeFromContext: boolean | undefined): ShellRun {
  return { command, excludeFromContext: excludeFromContext === true, result: { type: "running", output: "" } };
}
/** Pi saves at most 50 KB of a command's output. Live output keeps the same tail, so a runaway command cannot grow the page without bound. */
export const LIVE_OUTPUT_LIMIT = 51_200;
export function appendOutput(run: ShellRun, chunk: string): ShellRun {
  if (run.result.type !== "running") return run;
  const output = run.result.output + chunk;
  return { ...run, result: output.length > LIVE_OUTPUT_LIMIT
    ? { type: "running", output: output.slice(-LIVE_OUTPUT_LIMIT), clipped: true }
    : { ...run.result, output } };
}
/** The end event's output is the whole result; chunks only cover what arrived. */
export function finishRun(run: ShellRun, event: ShellEnd): ShellRun {
  const output = run.result.output;
  return { ...run, result: event.isError === true
    ? { type: "failed", output, error: event.output || "The shell command failed." }
    : doneResult(event, output) };
}
export function interruptRun(run: ShellRun): ShellRun {
  return run.result.type === "running" ? { ...run, result: { type: "interrupted", output: run.result.output } } : run;
}
export const unknownRun: ShellRun = { result: { type: "running", output: "" } };

/** True when a saved record is the stored copy of a command whose events were observed. */
export function isRecordOf(saved: ShellRun, observed: { command?: string | undefined; end: ShellEnd }): boolean {
  const { end } = observed;
  if (end.isError === true || saved.result.type !== "done") return false;
  if (observed.command !== undefined && saved.command !== observed.command) return false;
  return saved.result.output === (end.output ?? "") && saved.result.exitCode === (end.exitCode ?? undefined)
    && saved.result.cancelled === (end.cancelled === true);
}

/** True when `saved`, a history record, is the stored copy of `live`, a finished row seen through events. */
export function isSavedCopy(saved: ShellRun, live: ShellRun): boolean {
  if (saved.result.type !== "done" || live.result.type !== "done") return false;
  if (live.command !== undefined && saved.command !== live.command) return false;
  return saved.result.output === live.result.output && saved.result.exitCode === live.result.exitCode
    && saved.result.cancelled === live.result.cancelled;
}
/** True when two rows show the same finished command. */
export function isSameRun(a: ShellRun, b: ShellRun): boolean {
  return a.command === b.command && a.result.type === b.result.type && a.result.output === b.result.output
    && (a.result.type !== "done" || b.result.type !== "done" || a.result.exitCode === b.result.exitCode);
}
/** A late event revives a row the join closed, because its result was still on the way. */
export function reopenRun(run: ShellRun): ShellRun {
  return run.result.type === "interrupted" ? { ...run, result: { type: "running", output: run.result.output } } : run;
}

/** Plain text for copying: the command line, then its output. */
export function shellText(run: ShellRun): string {
  const error = run.result.type === "failed" ? run.result.error : "";
  return `$ ${run.command ?? "(command unknown)"}\n${run.result.output}${error}`;
}
