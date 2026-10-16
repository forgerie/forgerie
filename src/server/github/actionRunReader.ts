import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { ActionRunSchema, type ActionJob, type ActionRun } from "../../shared/actionRuns.js";
import type { Caller, SessionRepo } from "./githubAgent.js";
import type { GitHubAuthor, GitHubAuthorTrust } from "./githubTrust.js";

const nullable = Type.Union([Type.String(), Type.Null()]);
const User = Type.Union([Type.Object({ login: Type.String() }), Type.Null()]);
const Run = Type.Object({ id: Type.Integer(), run_number: Type.Integer({ minimum: 1 }), run_attempt: Type.Integer(), name: nullable, path: Type.String(), display_title: Type.String(), event: Type.String(), head_branch: nullable, head_sha: Type.String(), actor: User, html_url: Type.String(), status: Type.String(), conclusion: nullable, created_at: Type.String(), updated_at: Type.String(), pull_requests: Type.Array(Type.Object({ number: Type.Integer() })) });
const Runs = Type.Object({ total_count: Type.Integer(), workflow_runs: Type.Array(Run) });
const Job = Type.Object({ id: Type.Integer(), name: Type.String(), status: Type.String(), conclusion: nullable, html_url: Type.String(), started_at: nullable, completed_at: nullable, check_run_url: Type.Optional(Type.String()) });
const Jobs = Type.Object({ total_count: Type.Integer(), jobs: Type.Array(Job) });
const Annotation = Type.Object({ message: Type.String(), raw_details: nullable });
export interface ActionRunFilters { branch?: string; headSha?: string; workflow?: string; limit?: number }

export async function readActionRun(repo: SessionRepo, call: Caller, trust: Pick<GitHubAuthorTrust, "judge">, runId: number, annotations = true): Promise<ActionRun> {
  const raw = await call.get(`/actions/runs/${String(runId)}`, Run, "Actions: read");
  const jobs: ActionJob[] = [];
  let complete = false;
  let total: number | undefined;
  let annotationsRead = 0;
  const seen = new Set<number>();
  for (let page = 1; page <= 5; page++) {
    // Pin jobs to the observed attempt. A rerun must never mix two attempts' jobs.
    const batch = await call.get(`/actions/runs/${String(runId)}/attempts/${String(raw.run_attempt)}/jobs?per_page=100&page=${String(page)}`, Jobs, "Actions: read");
    total ??= batch.total_count;
    if (total !== batch.total_count) break;
    for (const job of batch.jobs) {
      if (seen.has(job.id)) return { ...await shapeRun(repo, call, trust, raw), jobs, complete: false };
      seen.add(job.id);
      const state: ActionJob["state"] = job.status !== "completed" ? (job.status === "queued" || job.status === "waiting" ? "queued" : "running")
        : job.conclusion === "skipped" ? "skipped" : job.conclusion === "cancelled" ? "cancelled" : job.conclusion === "success" || job.conclusion === "neutral" ? "passed" : "failed";
      const seconds = job.started_at === null || job.completed_at === null ? NaN : (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000;
      const item: ActionJob = { id: job.id, name: job.name, state, url: job.html_url,
        ...(job.started_at === null ? {} : { startedAt: job.started_at }), ...(job.completed_at === null ? {} : { completedAt: job.completed_at }),
        ...(Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {}) };
      if (annotations && (state === "failed" || state === "cancelled") && annotationsRead < 5) {
        const checkId = job.check_run_url === undefined ? undefined : /\/check-runs\/([1-9]\d*)$/u.exec(job.check_run_url)?.[1];
        if (checkId !== undefined) {
          annotationsRead++;
          const output = await call.get(`/check-runs/${checkId}/annotations?per_page=100`, Type.Array(Annotation), "Checks: read");
          const text = output.map(value => value.raw_details ?? value.message).join("\n").slice(-8000).split("\n").slice(-40).join("\n");
          if (text !== "") { item.logTail = text; item.logSource = "annotations"; }
        }
      }
      jobs.push(item);
    }
    if (jobs.length === batch.total_count) { complete = true; break; }
    if (batch.jobs.length < 100) break;
  }
  const run = await shapeRun(repo, call, trust, raw);
  if (run.status === "completed" && jobs.some(job => job.state === "queued" || job.state === "running")) complete = false;
  const result = { ...run, jobs, complete };
  if (!Check(ActionRunSchema, result)) throw new Error("GitHub sent unexpected job data.");
  return result;
}

export async function listActionRuns(repo: SessionRepo, call: Caller, trust: Pick<GitHubAuthorTrust, "judge">, filters: ActionRunFilters = {}): Promise<ActionRun[]> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 50);
  const query = new URLSearchParams({ per_page: String(limit) });
  if (filters.branch !== undefined) query.set("branch", filters.branch);
  if (filters.headSha !== undefined) query.set("head_sha", filters.headSha);
  const path = filters.workflow === undefined ? "/actions/runs" : `/actions/workflows/${encodeURIComponent(filters.workflow)}/runs`;
  const result = await call.get(`${path}?${query.toString()}`, Runs, "Actions: read");
  return Promise.all(result.workflow_runs.map(raw => shapeRun(repo, call, trust, raw)));
}

/** Derived rows need the whole head-SHA result, not a silently truncated recent-runs page. */
export async function listHeadActionRuns(repo: SessionRepo, call: Caller, trust: Pick<GitHubAuthorTrust, "judge">, headSha: string): Promise<ActionRun[]> {
  const runs: Static<typeof Run>[] = [];
  const ids = new Set<number>();
  let total: number | undefined;
  for (let page = 1; page <= 5; page++) {
    const query = new URLSearchParams({ head_sha: headSha, per_page: "100", page: String(page) });
    const result = await call.get(`/actions/runs?${query.toString()}`, Runs, "Actions: read");
    total ??= result.total_count;
    if (total !== result.total_count) break;
    for (const run of result.workflow_runs) {
      if (ids.has(run.id) || run.head_sha !== headSha) throw new Error("The head-SHA run list changed while paging. Refresh it.");
      ids.add(run.id); runs.push(run);
    }
    if (runs.length === total) return Promise.all(runs.map(run => shapeRun(repo, call, trust, run)));
    if (result.workflow_runs.length < 100) break;
  }
  throw new Error("The head-SHA run list is incomplete. Refresh or read the runs on GitHub.");
}

async function shapeRun(repo: SessionRepo, call: Caller, trust: Pick<GitHubAuthorTrust, "judge">, raw: Static<typeof Run>): Promise<ActionRun> {
  let title = raw.display_title.slice(0, 8000);
  if (!repo.everyone) {
    // The dispatcher/actor can be trusted while the title comes from an outside PR commit.
    const authors: GitHubAuthor[] = [];
    if (raw.pull_requests.length > 0) {
      for (const pull of raw.pull_requests) {
        const author = await call.get(`/pulls/${String(pull.number)}`, Type.Object({ user: User, author_association: Type.String() }), "Pull requests: read");
        authors.push({ login: author.user?.login, association: author.author_association });
      }
    }
    const commit = await call.get(`/commits/${encodeURIComponent(raw.head_sha)}`, Type.Object({ author: User }), "Contents: read");
    authors.push({ login: commit.author?.login, association: "NONE" });
    const allowed = await trust.judge(repo.slug, await call.token(), authors);
    if (!authors.every(allowed)) title = "(text hidden: outside contributor)";
  }
  if (!["completed", "in_progress", "queued", "waiting", "pending", "requested"].includes(raw.status)) throw new Error("GitHub sent an unexpected workflow run status.");
  const status = raw.status === "completed" ? "completed" : raw.status === "in_progress" ? "running" : ["waiting", "pending", "requested"].includes(raw.status) ? "waiting" : "queued";
  const run = { repo: repo.slug, runId: raw.id, runNumber: raw.run_number, attempt: raw.run_attempt, workflow: raw.name ?? raw.path, workflowPath: raw.path, title, event: raw.event, branch: raw.head_branch ?? "", headSha: raw.head_sha, actor: raw.actor?.login ?? "deleted-user", url: raw.html_url,
    status, conclusion: raw.conclusion, createdAt: raw.created_at, updatedAt: raw.updated_at, pullNumbers: raw.pull_requests.map(pull => pull.number), jobs: [], complete: true };
  if (!Check(ActionRunSchema, run)) throw new Error("GitHub sent an unexpected workflow run state.");
  return run;
}
