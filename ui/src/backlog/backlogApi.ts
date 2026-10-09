// The one file that knows the backlog wire contract (src/shared/backlog.ts and
// src/shared/github.ts on Forgerie's main branch). Everything else in this client
// reads the types below, so a contract change lands here. Only the fields this
// client reads are specified; an unknown readiness or claim kind degrades, it
// never drops the whole list.
import { z } from "zod";
import type { Fetch } from "../newSession";

const text = z.string().min(1);
/** Where an item comes from. A server older than providers sends none, and all its items are markdown. */
const provider = z.string().min(1).catch("markdown");

const claimIdentity = { claimId: text, projectId: text, provider, itemId: text, repo: text, cwd: text, claimedAt: text };
export const backlogClaimSchema = z.discriminatedUnion("kind", [
  z.object({ ...claimIdentity, kind: z.literal("launching") }),
  z.object({ ...claimIdentity, kind: z.literal("interrupted") }),
  z.object({ ...claimIdentity, kind: z.literal("claimed"), sessionId: text, branch: text.optional().catch(undefined) }),
]);
export type BacklogClaim = z.infer<typeof backlogClaimSchema>;

export const backlogItemSchema = z.object({
  id: text, title: text, provider, projectId: text, projectName: text, repo: text,
  /** A repo-relative file for markdown; `owner/name#42` for a GitHub issue. */
  path: text,
  /** The item's own web page, when its provider has one. Only https. */
  url: z.string().regex(/^https:\/\//u).optional().catch(undefined),
  status: z.string().catch(""),
  priority: z.string().optional().catch(undefined),
  labels: z.array(z.string()).catch([]),
  created: z.string().optional().catch(undefined),
  open: z.boolean(),
  // A readiness this client does not know reads as blocked: it never offers a launch the server would refuse.
  readiness: z.enum(["ready", "blocked", "claimed", "closed"]).catch("blocked"),
  blockingIds: z.array(z.string()).catch([]),
  claim: backlogClaimSchema.optional().catch(undefined),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

export const backlogWarningSchema = z.object({
  projectId: text, path: z.string(),
  kind: z.enum(["ignored-directory", "invalid-item", "project-error", "scan-limit", "provider-auth", "provider-install", "provider-unavailable", "items-hidden"]).or(z.string()),
  provider: z.string().optional().catch(undefined),
  message: z.string(),
});
export type BacklogWarning = z.infer<typeof backlogWarningSchema>;

export const backlogListSchema = z.object({
  // One malformed item drops out, not the list.
  items: z.array(z.unknown()).transform((items) => items.flatMap((item) => {
    const parsed = backlogItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  })),
  warnings: z.array(z.unknown()).transform((warnings) => warnings.flatMap((warning) => {
    const parsed = backlogWarningSchema.safeParse(warning);
    return parsed.success ? [parsed.data] : [];
  })),
  generatedAt: z.string(),
});
export type BacklogList = z.infer<typeof backlogListSchema>;

export const backlogDetailSchema = z.object({ item: backlogItemSchema, body: z.string(), initialPrompt: z.string() });
export type BacklogDetail = z.infer<typeof backlogDetailSchema>;

export const backlogLaunchSchema = z.object({
  session: z.object({ id: text, cwd: text }),
  claim: backlogClaimSchema,
  initialPrompt: z.string(),
  reused: z.boolean().catch(false),
});

export const backlogErrorSchema = z.object({
  kind: z.enum(["invalid-request", "not-found", "conflict", "unavailable"]).catch("unavailable"),
  error: z.string(),
  claim: backlogClaimSchema.optional().catch(undefined),
});

/** What the launch route takes beyond the item: the new-session choices, as `/api/sessions` takes them. */
export interface BacklogStart {
  cwd: string; modelSpec?: string | undefined; thinkingLevel?: string | undefined;
  destination?: { kind: "fresh-worktree" | "existing-workspace" } | undefined; setupId?: string | undefined;
}

/** The server refused a backlog request. `claim` is the claim that already holds the item, on a conflict. */
export class BacklogRefusal extends Error {
  constructor(message: string, readonly kind: z.infer<typeof backlogErrorSchema>["kind"], readonly status: number, readonly claim?: BacklogClaim) {
    super(message);
  }
}

/** One item. The same id from two providers is two items, so a reference always says which provider; absent means markdown. */
export interface BacklogRef { projectId: string; itemId: string; provider?: string | undefined }
export const MARKDOWN = "markdown";
export const providerOf = (ref: Pick<BacklogRef, "provider">) => ref.provider ?? MARKDOWN;
/** Markdown items keep the bare path, so this client still works against a server older than providers. */
const itemPath = (ref: BacklogRef) => `/api/backlog/${encodeURIComponent(ref.projectId)}/items/${encodeURIComponent(ref.itemId)}`;
const providerQuery = (ref: BacklogRef) => providerOf(ref) === MARKDOWN ? "" : `?provider=${encodeURIComponent(providerOf(ref))}`;

/** The reads and writes of the backlog. Nothing here retries. */
export function createBacklogApi(fetchFn: Fetch) {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await fetchFn(path, init);
    if (!response.ok) {
      const body = backlogErrorSchema.safeParse(await response.json().catch(() => undefined));
      if (body.success) throw new BacklogRefusal(body.data.error, body.data.kind, response.status, body.data.claim);
      throw new BacklogRefusal(`Request failed: HTTP ${String(response.status)}`, "unavailable", response.status);
    }
    return schema.parse(await response.json());
  }
  const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    ...(signal ? { signal } : {}) });
  return {
    list: (signal?: AbortSignal) => call("/api/backlog", backlogListSchema, signal ? { signal } : {}),
    detail: (ref: BacklogRef, signal?: AbortSignal) => call(`${itemPath(ref)}${providerQuery(ref)}`, backlogDetailSchema, signal ? { signal } : {}),
    /**
     * Claim the item and start its session in one step. The same `requestId`
     * with the same choices returns the same session, so a lost reply is safe
     * to ask again; this client still never retries on its own.
     */
    launch: (ref: BacklogRef, requestId: string, start: BacklogStart) =>
      call(`${itemPath(ref)}/launch${providerQuery(ref)}`, backlogLaunchSchema, post({ requestId, start })),
    release: (ref: BacklogRef, claimId: string) =>
      call(`${itemPath(ref)}/release${providerQuery(ref)}`, z.object({ released: z.literal(true) }), post({ claimId })),
  };
}
export type BacklogApi = ReturnType<typeof createBacklogApi>;
