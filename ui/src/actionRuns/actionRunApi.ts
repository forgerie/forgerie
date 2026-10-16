// The one file that knows the GitHub Actions run wire contract
// (src/shared/actionRuns.ts and docs/action-runs.md on the PR branch). The
// rest of this client reads the types below, so a contract change lands here.
import { z } from "zod";
import { pullWatchSchema } from "../pullRequests/pullRequestApi";

const text = z.string();
/** Absolute timestamps. The client computes relative labels. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}T/);
const runId = z.number().int().min(1);

/** The same watch shape as a pull request link: off, watching with its wakes, or stopped with a reason. */
export type RunWatch = z.infer<typeof pullWatchSchema>;

const jobState = z.enum(["queued", "running", "passed", "failed", "cancelled", "skipped"]);
export type JobState = z.infer<typeof jobState>;
export const actionJobSchema = z.object({
  /** GitHub's job ID, an integer on the wire. Views turn it into a string key. */
  id: z.number().int().min(1), name: text, state: jobState, url: text,
  startedAt: date.optional(), completedAt: date.optional(), seconds: z.number().min(0).optional(),
  /** Bounded failed-job annotations, not a raw Actions log. */
  logTail: text.optional(), logSource: z.literal("annotations").optional(),
});
export type ActionJob = z.infer<typeof actionJobSchema>;

const runStatus = z.enum(["queued", "waiting", "running", "completed"]);
const runConclusion = z.enum(["success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral", "stale"]).nullable();
export type RunConclusion = z.infer<typeof runConclusion>;
export const actionRunSchema = z.object({
  /** `runId` names the run in routes and keys; `runNumber` is GitHub's per-workflow `run_number`, the "#4812" people read. */
  repo: text, runId, runNumber: z.number().int().min(1), attempt: z.number().int().min(1), workflow: text, workflowPath: text, title: text, event: text,
  branch: text, headSha: text, actor: text, url: text, status: runStatus, conclusion: runConclusion,
  createdAt: date, updatedAt: date,
  pullNumbers: z.array(z.number().int()),
  jobs: z.array(actionJobSchema),
  /** False when a page of jobs or annotations was not read. */
  complete: z.boolean(),
});
export type ActionRun = z.infer<typeof actionRunSchema>;

const runSource = z.enum(["manual", "dispatch", "pull"]);
export const actionRunLinkSchema = z.object({
  provider: z.literal("github"),
  session: z.object({ id: text, cwd: text }),
  repo: text, runId, source: runSource, watch: pullWatchSchema,
});
export type ActionRunLink = z.infer<typeof actionRunLinkSchema>;

/** One linked run. A failed read keeps its link, with `run: null` and the server's reason. */
const runItemSchema = z.object({ link: actionRunLinkSchema, run: actionRunSchema.nullable(), error: text.optional() });
export type ActionRunItem = z.infer<typeof runItemSchema>;
/** The runs for one linked pull request's head commit. They have no stored link, and their jobs are not read. */
const derivedSchema = z.object({ pull: z.number().int().min(1), headSha: text, runs: z.array(actionRunSchema), error: text.optional() });
export type DerivedRuns = z.infer<typeof derivedSchema>;
const sessionRunsSchema = z.object({ items: z.array(runItemSchema), derived: z.array(derivedSchema) });
export type SessionActionRuns = z.infer<typeof sessionRunsSchema>;
const sessionRunSchema = z.object({ link: actionRunLinkSchema, run: actionRunSchema });
export type SessionActionRun = z.infer<typeof sessionRunSchema>;
export const actionRunCatalogSchema = z.object({ links: z.array(actionRunLinkSchema) });
/** `ActionRunErrorSchema` is `{ kind: "action_run_error", error }`; only the words matter to the reader. */
const errorSchema = z.object({ error: z.string() });

/**
 * On the machine and session streams: `session.action-run` when a link or
 * watch changed (each wake too), `session.action-run.unlinked` when a link
 * was removed. Each event carries one link.
 */
const runEventSchema = z.object({ type: z.enum(["session.action-run", "session.action-run.unlinked"]), link: actionRunLinkSchema });
export type ActionRunEvent = { link: ActionRunLink; removed: boolean };
export function parseActionRunEvent(value: unknown): ActionRunEvent | undefined {
  const type = typeof value === "object" && value !== null ? (value as { type?: unknown }).type : undefined;
  if (type !== "session.action-run" && type !== "session.action-run.unlinked") return undefined;
  const event = runEventSchema.parse(value);
  return { link: event.link, removed: event.type === "session.action-run.unlinked" };
}

/** A run's identity within one session: the repository (without case, as GitHub compares it) and the run ID. */
export const runKey = (run: { repo: string; runId: number }) => `${run.repo.toLowerCase()}#${String(run.runId)}`;
/** The identity of one link: the session, the repository, and the run ID. */
export const sameRunLink = (a: ActionRunLink, b: ActionRunLink) => a.session.id === b.session.id && runKey(a) === runKey(b);

export interface RunSessionRef { id: string; cwd: string }
export type RunRequestFn = (path: string, init: RequestInit) => Promise<Response>;

export interface ActionRunApi {
  /** Every linked run, oldest link first, plus the runs of each linked pull request's head. */
  list(ref: RunSessionRef, signal?: AbortSignal): Promise<SessionActionRuns>;
  /** One linked run, with its jobs. */
  read(ref: RunSessionRef, runId: number, signal?: AbortSignal): Promise<SessionActionRun>;
  /** Links a run by its ID or its URL on the session's repository. An existing link comes back unchanged. */
  link(ref: RunSessionRef, run: number | string): Promise<SessionActionRun>;
  unlink(ref: RunSessionRef, runId: number): Promise<ActionRunLink>;
  /** Starts the watch. A run that is not linked yet is linked first. */
  watch(ref: RunSessionRef, runId: number): Promise<ActionRunLink>;
  stopWatch(ref: RunSessionRef, runId: number): Promise<ActionRunLink>;
}

/** A run read takes several GitHub requests; give it longer than a local read. */
const TIMEOUT_MS = 45_000;

export function createActionRunApi(request: RunRequestFn, prefix = "/api"): ActionRunApi {
  const path = (ref: RunSessionRef, tail = "") => `${prefix}/sessions/${encodeURIComponent(ref.id)}/action-runs${tail}`;
  const one = (ref: RunSessionRef, id: number, tail = "") => path(ref, `/${String(id)}${tail}`);
  const query = (ref: RunSessionRef) => `?${new URLSearchParams({ cwd: ref.cwd })}`;
  async function call<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await request(url, { ...init, cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${String(response.status)}`);
    }
    return schema.parse(body);
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    list: (ref, signal) => call(`${path(ref)}${query(ref)}`, sessionRunsSchema, {}, signal),
    read: (ref, id, signal) => call(`${one(ref, id)}${query(ref)}`, sessionRunSchema, {}, signal),
    link: (ref, run) => call(path(ref), sessionRunSchema, json("PUT", { cwd: ref.cwd, run })),
    unlink: (ref, id) => call(`${one(ref, id)}${query(ref)}`, actionRunLinkSchema, { method: "DELETE" }),
    watch: (ref, id) => call(one(ref, id, "/watch"), actionRunLinkSchema, json("POST", { cwd: ref.cwd })),
    stopWatch: (ref, id) => call(`${one(ref, id, "/watch")}${query(ref)}`, actionRunLinkSchema, { method: "DELETE" }),
  };
}
