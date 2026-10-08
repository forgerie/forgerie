// The one file that knows the pull request wire contract
// (src/shared/pullRequests.ts and docs/pull-requests.md on Forgerie's main
// branch). Everything else in this client reads the types below, so a
// contract change lands here.
import { z } from "zod";

const text = z.string();
/** Absolute timestamps. The client computes relative labels. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}T/);

export const pullWatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("watching"), since: date, wakes: z.number().int().min(0), lastWake: date.optional(), error: text.optional() }),
  z.object({ kind: z.literal("stopped"), reason: text, at: date }),
]);
export type PullWatch = z.infer<typeof pullWatchSchema>;

const checkState = z.enum(["queued", "running", "passed", "failed", "cancelled"]);
export type CheckState = z.infer<typeof checkState>;
export const pullCheckSchema = z.object({
  id: text, name: text, state: checkState, url: text, required: z.boolean(),
  updatedAt: date.optional(), seconds: z.number().min(0).optional(),
  /** Bounded check annotations, not a raw Actions log. */
  logTail: text.optional(), logSource: z.literal("annotations").optional(),
});
export type PullCheck = z.infer<typeof pullCheckSchema>;

export const pullRemarkSchema = z.object({
  id: text, author: text, body: text, updatedAt: date, url: text,
  kind: z.enum(["comment", "review"]),
  path: text.optional(), line: z.number().int().optional(),
});
/** An unresolved review thread's first comment, or a conversation comment. */
export type PullComment = z.infer<typeof pullRemarkSchema>;

const reviewSchema = z.object({ reviewer: text, state: z.enum(["approved", "changes_requested", "commented"]), updatedAt: date });
/** Each reviewer's latest review. */
export type PullReview = z.infer<typeof reviewSchema>;

export const pullRequestSchema = z.object({
  repo: text, number: z.number().int().min(1), title: text, url: text,
  state: z.enum(["open", "draft", "merged", "closed"]),
  head: text, headSha: text, base: text, author: text, updatedAt: date,
  mergeability: z.enum(["clean", "conflicting", "unknown"]),
  files: z.number().int(), additions: z.number().int(), deletions: z.number().int(),
  checks: z.array(pullCheckSchema),
  reviews: z.array(reviewSchema),
  comments: z.array(pullRemarkSchema),
  /** False when a page or a required check was not read. The server then blocks merge. */
  complete: z.boolean(),
  /** The server's merge gate. The client never infers merge permission itself. */
  merge: z.discriminatedUnion("kind", [z.object({ kind: z.literal("allowed") }), z.object({ kind: z.literal("blocked"), reason: text })]),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const pullLinkSchema = z.object({
  session: z.object({ id: text, cwd: text }),
  repo: text, number: z.number().int().min(1), watch: pullWatchSchema,
});
export type PullLink = z.infer<typeof pullLinkSchema>;

const sessionPullSchema = z.object({ link: pullLinkSchema.nullable(), pull: pullRequestSchema.nullable() });
export type SessionPull = z.infer<typeof sessionPullSchema>;
export const pullCatalogSchema = z.object({ links: z.array(pullLinkSchema) });
const mergedSchema = z.object({ text, url: text.optional() });
const errorSchema = z.object({ error: z.string() });

/** `session.pull-request` on the machine and session streams: a link or watch changed. */
export const pullEventSchema = z.object({ type: z.literal("session.pull-request"), link: pullLinkSchema });
export function parsePullEvent(value: unknown): PullLink | undefined {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "session.pull-request") return undefined;
  return pullEventSchema.parse(value).link;
}

export type MergeMethod = "rebase" | "squash" | "merge";
export interface PullSessionRef { id: string; cwd: string }
export type PullRequestFn = (path: string, init: RequestInit) => Promise<Response>;

export interface PullRequestApi {
  read(ref: PullSessionRef, signal?: AbortSignal): Promise<SessionPull>;
  link(ref: PullSessionRef, number: number): Promise<SessionPull>;
  watch(ref: PullSessionRef): Promise<PullLink>;
  stopWatch(ref: PullSessionRef): Promise<PullLink | null>;
  /** Confirmation binds the repository, number, and head SHA the reader saw. */
  merge(ref: PullSessionRef, pr: Pick<PullRequest, "repo" | "number" | "headSha">, method: MergeMethod): Promise<{ text: string; url?: string | undefined }>;
}

/** A GitHub read takes several requests; give it longer than a local read. */
const TIMEOUT_MS = 45_000;

export function createPullRequestApi(request: PullRequestFn, prefix = "/api"): PullRequestApi {
  const path = (ref: PullSessionRef, tail = "") => `${prefix}/sessions/${encodeURIComponent(ref.id)}/pull-request${tail}`;
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
    read: (ref, signal) => call(`${path(ref)}?${new URLSearchParams({ cwd: ref.cwd })}`, sessionPullSchema, {}, signal),
    link: (ref, number) => call(path(ref), sessionPullSchema, json("PUT", { cwd: ref.cwd, number })),
    watch: (ref) => call(path(ref, "/watch"), pullLinkSchema, json("POST", { cwd: ref.cwd })),
    stopWatch: (ref) => call(`${path(ref, "/watch")}?${new URLSearchParams({ cwd: ref.cwd })}`, pullLinkSchema.nullable(), { method: "DELETE" }),
    merge: (ref, pr, method) => call(path(ref, "/merge"), mergedSchema, json("POST", { cwd: ref.cwd, repo: pr.repo, number: pr.number, headSha: pr.headSha, method })),
  };
}
