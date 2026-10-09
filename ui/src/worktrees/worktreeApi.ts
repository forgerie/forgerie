// The one file that knows the session-worktree wire contract
// (src/shared/sessionWorktree.ts and apiTypes.ts on Forgerie's main branch,
// documented in docs/session-worktrees.md there). Everything else in this
// client reads the types below, so a contract change lands here.
import { z } from "zod";

const text = z.string().min(1);

/** Where a new browser session starts. Omitted: fresh for a Git project, existing otherwise. */
export const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fresh-worktree") }),
  z.object({ kind: z.literal("existing-workspace") }),
]);
export type NewSessionDestination = z.infer<typeof destinationSchema>;

export const worktreeOptionsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("git"), repo: text, defaultBranch: text, defaultDestination: z.literal("fresh-worktree").catch("fresh-worktree") }),
  z.object({ kind: z.literal("non-git") }),
]);
export type WorktreeOptions = z.infer<typeof worktreeOptionsSchema>;

export const lifecycleStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }),
  z.object({ kind: z.literal("landed"), sha: text, at: text }),
  z.object({ kind: z.literal("discarded"), at: text }),
]);
export type WorktreeLifecycleState = z.infer<typeof lifecycleStateSchema>;

export const setupSchema = z.object({
  // A phase this client does not know reads as still running, never as done.
  phase: z.enum(["creating", "hook", "starting", "done", "failed"]).catch("starting"),
  log: z.string().catch(""),
  exitCode: z.number().int().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});
export type WorktreeSetup = z.infer<typeof setupSchema>;

export const cleanupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("failed"), error: text }),
]);
export type WorktreeCleanup = z.infer<typeof cleanupSchema>;

export const archiveCleanupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("removed"), cleanup: cleanupSchema }),
  z.object({ kind: z.literal("retained"), reason: text }),
]);
export type ArchiveCleanup = z.infer<typeof archiveCleanupSchema>;

/** A worktree as the server stores it. Live events carry this shape; it has no Git counts. */
export const worktreeRecordSchema = z.object({
  id: text,
  repo: text,
  path: text,
  branch: text,
  defaultBranch: text,
  sessionId: text.optional(),
  relatedSession: z.object({ id: text, cwd: text, projectId: text }).optional(),
  ownerSession: z.object({ id: text, cwd: text, name: z.string().optional() }).passthrough().optional(),
  startupToken: text.optional(),
  setup: setupSchema,
  state: lifecycleStateSchema,
  archiveCleanup: archiveCleanupSchema.optional().catch(undefined),
  cleanup: cleanupSchema.catch({ kind: "pending" }),
  updatedAt: z.string().optional(),
});
export type WorktreeRecord = z.infer<typeof worktreeRecordSchema>;

/** A session's worktree with fresh Git status. `ahead`, `behind`, and `dirtyFiles` exist only while it is active and readable. */
export const worktreeInfoSchema = z.object({
  id: text,
  owned: z.boolean(),
  relatedSession: z.object({ id: text, cwd: text, projectId: text }).optional(),
  repo: text,
  path: text,
  branch: text,
  defaultBranch: text,
  state: lifecycleStateSchema,
  setup: setupSchema,
  cleanup: cleanupSchema.catch({ kind: "pending" }),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
  dirtyFiles: z.number().int().nonnegative().optional(),
  /** Git status could not be read. Never read as clean. */
  statusError: z.string().optional(),
  archiveCleanup: archiveCleanupSchema.optional().catch(undefined),
});
export type WorktreeInfo = z.infer<typeof worktreeInfoSchema>;

/**
 * Fold a live record into what the client knows. The record wins on what it
 * carries (state, setup, cleanup, a renamed branch); the counts stay until the
 * next status read, except after the worktree left "active", when they no
 * longer describe anything.
 */
export function mergeRecord(info: WorktreeInfo | undefined, record: WorktreeRecord): WorktreeInfo {
  const active = record.state.kind === "active";
  const { ahead, behind, dirtyFiles, statusError } = info ?? {};
  return {
    id: record.id, owned: info?.owned ?? true, repo: record.repo, path: record.path, branch: record.branch, defaultBranch: record.defaultBranch,
    state: record.state, setup: record.setup, cleanup: record.cleanup,
    ...(record.archiveCleanup ? { archiveCleanup: record.archiveCleanup } : info?.archiveCleanup ? { archiveCleanup: info.archiveCleanup } : {}),
    ...(active ? { ...(ahead === undefined ? {} : { ahead }), ...(behind === undefined ? {} : { behind }),
      ...(dirtyFiles === undefined ? {} : { dirtyFiles }), ...(statusError === undefined ? {} : { statusError }) } : {}),
  };
}

export const discardPreviewSchema = z.object({
  worktreeId: text,
  branch: text,
  defaultBranch: text,
  commits: z.array(z.object({ sha: text, subject: z.string() })),
  dirtyFiles: z.array(text),
  confirmationToken: text,
});
export type DiscardPreview = z.infer<typeof discardPreviewSchema>;

export const actionResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("landed"), sha: text, cleanup: cleanupSchema }),
  z.object({ kind: z.literal("discarded"), cleanup: cleanupSchema }),
  z.object({ kind: z.literal("conflict"), files: z.array(text), defaultBranch: text, prompt: text }),
  z.object({ kind: z.literal("blocked"), reason: text, files: z.array(text) }),
  z.object({ kind: z.literal("stale-preview") }),
]);
export type WorktreeActionResult = z.infer<typeof actionResultSchema>;

/** `{type:"session.worktree"}` on the machine and session event sockets. Anything else returns undefined. */
export function parseWorktreeEvent(value: unknown): WorktreeRecord | undefined {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "session.worktree") return undefined;
  const parsed = worktreeRecordSchema.safeParse((value as { worktree?: unknown }).worktree);
  return parsed.success ? parsed.data : undefined;
}

/** A refusal the server explained (HTTP 409 and friends), or a transport failure. */
export class WorktreeRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type Fetch = (path: string, init?: RequestInit) => Promise<Response>;
const errorBody = z.object({ error: z.string() });

/** The worktree reads and writes. Local machine only, like the rest of this client. Nothing here retries. */
export function createWorktreeApi(fetchFn: Fetch, prefix = "/api") {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(`${prefix}${path}`, init);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = errorBody.safeParse(body);
      throw new WorktreeRequestError(error.success ? error.data.error : `Request failed: HTTP ${String(response.status)}`, response.status);
    }
    return schema.parse(body);
  }
  const post = (body: unknown = {}): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const id = (worktreeId: string) => encodeURIComponent(worktreeId);
  return {
    /** Whether a folder is in a Git project, its main checkout, and its default branch. */
    options: (cwd: string, signal?: AbortSignal) => call(`/sessions/worktree-options?${new URLSearchParams({ cwd })}`, worktreeOptionsSchema, signal ? { signal } : {}),
    /** Worktrees of one repository (its main path) or one exact worktree path. */
    list: (cwd: string, signal?: AbortSignal) => call(`/sessions/worktrees?${new URLSearchParams({ cwd })}`, z.object({ worktrees: z.array(worktreeRecordSchema) }), signal ? { signal } : {})
      .then((result) => result.worktrees),
    /** One worktree with fresh Git counts. */
    get: (worktreeId: string, signal?: AbortSignal) => call(`/sessions/worktrees/${id(worktreeId)}`, z.object({ worktree: worktreeRecordSchema, info: worktreeInfoSchema }), signal ? { signal } : {}),
    land: (worktreeId: string) => call(`/sessions/worktrees/${id(worktreeId)}/land`, actionResultSchema, post()),
    discardPreview: (worktreeId: string) => call(`/sessions/worktrees/${id(worktreeId)}/discard-preview`, discardPreviewSchema, post()),
    discard: (worktreeId: string, confirmationToken: string) => call(`/sessions/worktrees/${id(worktreeId)}/discard`, actionResultSchema, post({ confirmationToken })),
  };
}
export type WorktreeApi = ReturnType<typeof createWorktreeApi>;
