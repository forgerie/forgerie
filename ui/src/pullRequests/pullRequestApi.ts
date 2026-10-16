// The one file that knows the pull request wire contract
// (src/shared/pullRequests.ts and docs/pull-requests.md on Forgerie's main
// branch). Everything else in this client reads the types below, so a
// contract change lands here.
import { z } from "zod";
import { Check } from "typebox/value";
import { OpenPullsResponseSchema, PullPreviewResponseSchema, type OpenPullsResponse, type PullPreviewResponse, type PullRepository } from "@shared/pullRequests";
export type { OpenPullsResponse, PullPreviewResponse } from "@shared/pullRequests";
const openPullsSchema = z.custom<OpenPullsResponse>(value => Check(OpenPullsResponseSchema, value));
const pullPreviewSchema = z.custom<PullPreviewResponse>(value => Check(PullPreviewResponseSchema, value));

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
  provider: z.enum(["github", "azure-devops"]),
  session: z.object({ id: text, cwd: text }),
  repo: text, number: z.number().int().min(1), watch: pullWatchSchema,
});
export type PullLink = z.infer<typeof pullLinkSchema>;

const sessionPullSchema = z.object({ link: pullLinkSchema, pull: pullRequestSchema });
export type SessionPull = z.infer<typeof sessionPullSchema>;
/** One linked pull request. A failed read keeps its link, with `pull: null` and the server's reason. */
const pullItemSchema = z.object({ link: pullLinkSchema, pull: pullRequestSchema.nullable(), error: text.optional() });
export type PullItem = z.infer<typeof pullItemSchema>;
const sessionPullsSchema = z.object({ items: z.array(pullItemSchema) });
export const pullCatalogSchema = z.object({ links: z.array(pullLinkSchema) });
const mergedSchema = z.object({ text, url: text.optional() });
const errorSchema = z.object({ error: z.string() });

/**
 * On the machine and session streams: `session.pull-request` when a link or
 * watch changed, `session.pull-request.unlinked` when a link was removed.
 * A session can link several pull requests; each event carries one.
 */
export const pullEventSchema = z.object({ type: z.enum(["session.pull-request", "session.pull-request.unlinked"]), link: pullLinkSchema });
export type PullEvent = { link: PullLink; removed: boolean };
export function parsePullEvent(value: unknown): PullEvent | undefined {
  const type = typeof value === "object" && value !== null ? (value as { type?: unknown }).type : undefined;
  if (type !== "session.pull-request" && type !== "session.pull-request.unlinked") return undefined;
  const event = pullEventSchema.parse(value);
  return { link: event.link, removed: event.type === "session.pull-request.unlinked" };
}
/** The identity of one link: the session, the repository (without case, as GitHub compares it), and the number. */
export const sameLink = (a: PullLink, b: PullLink) => a.session.id === b.session.id && a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase();

export type MergeMethod = "rebase" | "squash" | "merge";
export interface PullSessionRef { id: string; cwd: string }
export type PullRequestFn = (path: string, init: RequestInit) => Promise<Response>;

export interface PullRequestApi {
  open(ref: PullSessionRef, signal?: AbortSignal): Promise<OpenPullsResponse>;
  preview(ref: PullSessionRef, number: number, signal?: AbortSignal): Promise<PullPreviewResponse>;
  /** Every linked pull request, oldest first, each read from GitHub. */
  list(ref: PullSessionRef, signal?: AbortSignal): Promise<PullItem[]>;
  read(ref: PullSessionRef, number: number, signal?: AbortSignal): Promise<SessionPull>;
  /** Adds a link. It never replaces another pull request's link. */
  link(ref: PullSessionRef, number: number, expected?: PullRepository): Promise<SessionPull>;
  unlink(ref: PullSessionRef, number: number): Promise<PullLink>;
  watch(ref: PullSessionRef, number: number): Promise<PullLink>;
  stopWatch(ref: PullSessionRef, number: number): Promise<PullLink>;
  /** Confirmation binds the repository, number, and head SHA the reader saw. */
  merge(ref: PullSessionRef, pr: Pick<PullRequest, "repo" | "number" | "headSha">, method: MergeMethod): Promise<{ text: string; url?: string | undefined }>;
}

/** A GitHub read takes several requests; give it longer than a local read. */
const TIMEOUT_MS = 45_000;

export function createPullRequestApi(request: PullRequestFn, prefix = "/api"): PullRequestApi {
  const path = (ref: PullSessionRef, tail = "") => `${prefix}/sessions/${encodeURIComponent(ref.id)}/pull-requests${tail}`;
  const one = (ref: PullSessionRef, number: number, tail = "") => path(ref, `/${String(number)}${tail}`);
  const query = (ref: PullSessionRef) => `?${new URLSearchParams({ cwd: ref.cwd })}`;
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
    open: (ref, signal) => call(`${path(ref, "/open")}${query(ref)}`, openPullsSchema, {}, signal),
    preview: (ref, number, signal) => call(`${one(ref, number, "/preview")}${query(ref)}`, pullPreviewSchema, {}, signal),
    list: async (ref, signal) => (await call(`${path(ref)}${query(ref)}`, sessionPullsSchema, {}, signal)).items,
    read: (ref, number, signal) => call(`${one(ref, number)}${query(ref)}`, sessionPullSchema, {}, signal),
    link: (ref, number, expected) => call(path(ref), sessionPullSchema, json("PUT", { cwd: ref.cwd, number, ...(expected ? { expected } : {}) })),
    unlink: (ref, number) => call(`${one(ref, number)}${query(ref)}`, pullLinkSchema, { method: "DELETE" }),
    watch: (ref, number) => call(one(ref, number, "/watch"), pullLinkSchema, json("POST", { cwd: ref.cwd })),
    stopWatch: (ref, number) => call(`${one(ref, number, "/watch")}${query(ref)}`, pullLinkSchema, { method: "DELETE" }),
    merge: (ref, pr, method) => call(one(ref, pr.number, "/merge"), mergedSchema, json("POST", { cwd: ref.cwd, repo: pr.repo, headSha: pr.headSha, method })),
  };
}
