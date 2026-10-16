/**
 * How the client reads a GitHub Actions run. The data comes from the server
 * (`actionRunApi.ts`); this file only words it. Pure: no clock of its own, no I/O.
 */
import { duration } from "../pullRequests/pullRequestModel";
import type { ActionJob, ActionRun, JobState, RunConclusion, RunWatch } from "./actionRunApi";

/** Where a run stands, as one mark. The job states plus `waiting`: GitHub holds the run for someone's approval. */
export type RunMark = JobState | "waiting";

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

const CONCLUSION_MARK: Record<NonNullable<RunConclusion>, RunMark> = {
  success: "passed", failure: "failed", timed_out: "failed", cancelled: "cancelled",
  action_required: "waiting", skipped: "skipped", neutral: "skipped", stale: "skipped",
};
export function runMark(run: Pick<ActionRun, "status" | "conclusion">): RunMark {
  if (run.status === "queued") return "queued";
  if (run.status === "waiting") return "waiting";
  if (run.status === "running") return "running";
  return run.conclusion ? CONCLUSION_MARK[run.conclusion] : "skipped";
}

const CONCLUSION_WORD: Record<NonNullable<RunConclusion>, string> = {
  success: "Success", failure: "Failure", cancelled: "Cancelled", skipped: "Skipped", timed_out: "Timed out",
  action_required: "Action required", neutral: "Neutral", stale: "Stale",
};
const STATUS_WORD: Record<Exclude<ActionRun["status"], "completed">, string> = { queued: "Queued", waiting: "Waiting", running: "In progress" };
/** The status while it runs, the conclusion once it ends: the word GitHub's own run page shows. */
export function runWord(run: Pick<ActionRun, "status" | "conclusion">): string {
  if (run.status !== "completed") return STATUS_WORD[run.status];
  return run.conclusion ? CONCLUSION_WORD[run.conclusion] : "Completed";
}
/** A conclusion in a sentence: "timed out", "action required". */
export const conclusionPhrase = (conclusion: string) => conclusion.replaceAll("_", " ");

export const shortSha = (sha: string) => sha.slice(0, 7);

/** A run's short facts for a row: its ID, branch, commit, and attempt. `label` is the hover text. */
export function runFacts(run: ActionRun): { text: string; label: string; code?: boolean }[] {
  return [
    { text: `#${String(run.runId)}`, label: "Run ID", code: true },
    { text: run.branch, label: `Branch ${run.branch}`, code: true },
    { text: shortSha(run.headSha), label: `Commit ${run.headSha}`, code: true },
    { text: `attempt ${String(run.attempt)}`, label: "Attempt" },
  ];
}

const ENDED: ReadonlySet<JobState> = new Set(["passed", "failed", "cancelled", "skipped"]);
const JOB_ORDER: Record<JobState, number> = { failed: 0, cancelled: 1, running: 2, queued: 3, passed: 4, skipped: 5 };
/** Failures first, then what still runs, then the rest; GitHub's order within each. */
export const sortedJobs = (jobs: readonly ActionJob[]) => [...jobs].sort((a, b) => JOB_ORDER[a.state] - JOB_ORDER[b.state]);
export const failedJobs = (run: ActionRun) => run.jobs.filter((job) => job.state === "failed");

/** A job's run time: GitHub's figure, else its start and end, else nothing (it has not started). */
export function jobSeconds(job: ActionJob): number | undefined {
  if (job.seconds !== undefined) return job.seconds;
  if (!job.startedAt || !job.completedAt) return undefined;
  const ms = Date.parse(job.completedAt) - Date.parse(job.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : undefined;
}
/** A finished run's wall time, from creation to its last update. Undefined while it runs. */
export function runSeconds(run: ActionRun): number | undefined {
  if (run.status !== "completed") return undefined;
  const ms = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : undefined;
}

/**
 * One sentence that says where the run stands. A run that ended names its
 * conclusion; one that runs counts its jobs. An incomplete read says so,
 * because a missing page could hold a failure.
 */
export function runSentence(run: ActionRun): string {
  const failed = failedJobs(run).length;
  const jobs = run.jobs.length;
  const took = runSeconds(run);
  const time = took === undefined ? "" : ` in ${duration(took)}`;
  const partial = run.complete ? "" : " Forgerie could not read every job.";
  if (run.status === "queued") return `Queued.${partial}`;
  if (run.status === "waiting") return `Waiting for approval on GitHub.${partial}`;
  if (run.status === "running") {
    const done = run.jobs.filter((job) => ENDED.has(job.state)).length;
    const lead = failed > 0 ? `${plural(failed, "job", "jobs")} failed. ` : "";
    return `${lead}In progress${jobs > 0 ? `: ${String(done)} of ${plural(jobs, "job", "jobs")} done` : ""}.${partial}`;
  }
  if (failed > 0) return `${String(failed)} of ${plural(jobs, "job", "jobs")} failed${time}.${partial}`;
  switch (run.conclusion) {
    case "success": return `Succeeded${time}.${partial}`;
    case "cancelled": return `Cancelled${time}.${partial}`;
    case "timed_out": return `Timed out${time}.${partial}`;
    case "action_required": return `Needs action on GitHub.${partial}`;
    case "failure": return `Failed${time}.${partial}`;
    default: return `Finished: ${conclusionPhrase(run.conclusion ?? "completed")}${time}.${partial}`;
  }
}

/**
 * The tone of a list of runs, as the pull request tabs draw it: any failure
 * first, then anything still going, then all passed. Unread runs add nothing.
 */
export function listTone(runs: readonly (ActionRun | null)[]): "failed" | "waiting" | "ready" | undefined {
  const marks = runs.flatMap((run) => run ? [runMark(run)] : []);
  if (marks.includes("failed")) return "failed";
  if (marks.some((mark) => mark === "running" || mark === "queued" || mark === "waiting")) return "waiting";
  return marks.length > 0 && marks.every((mark) => mark === "passed") ? "ready" : undefined;
}

/** A completed run cannot be watched: the server refuses it. */
export const watchable = (run: ActionRun | null) => run === null || run.status !== "completed";

/** The watch in words: what it waits for, how often it woke the agent, or why it stopped. */
export function watchNote(watch: RunWatch): string | undefined {
  if (watch.kind === "off") return undefined;
  if (watch.kind === "stopped") return `Stopped: ${watch.reason.replace(/\.$/u, "")}.`;
  const woke = watch.wakes === 0 ? "Watching. Nothing has woken the agent yet."
    : `Watching. The agent woke ${watch.wakes === 1 ? "once" : `${String(watch.wakes)} times`}.`;
  return watch.error ? `${woke} The last read failed: ${watch.error}` : woke;
}

/**
 * The GitHub App lacks the Actions permission. The server's refusal reads
 * `…it needs "Actions: read". Grant it at https://…/permissions, then…`;
 * the reader needs that link, not the agent's instructions around it.
 */
export function permissionProblem(error: string | undefined): { url: string | undefined } | undefined {
  if (!error || !/Actions: (read|write)/u.test(error)) return undefined;
  const url = /https:\/\/\S+/u.exec(error)?.[0].replace(/[.,;:)]+$/u, "");
  return { url };
}

/**
 * What the link field accepts: a run ID, or a run URL. The server checks the
 * URL's repository; the client only refuses what cannot be a run at all.
 */
export function runInput(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) > 0 ? Number(trimmed) : undefined;
  return /^https?:\/\/\S+\/actions\/runs\/\d+/u.test(trimmed) ? trimmed : undefined;
}
