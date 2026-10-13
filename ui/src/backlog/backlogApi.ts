import type { BacklogScope } from "./backlogScope";
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

/** For an Azure item, `projectId`, `repo` and `cwd` say where its session runs; `sourceId` names the board it came from. */
const claimIdentity = { claimId: text, projectId: text, provider, itemId: text, repo: text, cwd: text, claimedAt: text, sourceId: text.optional().catch(undefined) };
export const backlogClaimSchema = z.discriminatedUnion("kind", [
  z.object({ ...claimIdentity, kind: z.literal("launching") }),
  z.object({ ...claimIdentity, kind: z.literal("interrupted") }),
  z.object({ ...claimIdentity, kind: z.literal("claimed"), sessionId: text, branch: text.optional().catch(undefined) }),
]);
export type BacklogClaim = z.infer<typeof backlogClaimSchema>;

/** Who lists the item: a project (its Markdown files, its GitHub issues), or a backlog source that no project owns (an Azure board). */
const projectOwner = z.object({ kind: z.literal("project"), projectId: text, projectName: text, repo: text });
const sourceOwner = z.object({ kind: z.literal("source"), sourceId: text, label: text });
/**
 * Where a session for the item starts. A source with no destination, or one whose project is no longer
 * registered, is not routed. An unknown shape reads as not routed: this client never guesses a project.
 */
export const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("routed"), projectId: text, reason: z.enum(["source-destination", "project-owned"]) }),
  z.object({ kind: z.literal("not-routed"), reason: z.enum(["unset", "missing-project"]).catch("unset") }),
]).catch({ kind: "not-routed", reason: "unset" });
export type Destination = z.infer<typeof destinationSchema>;

const itemFields = {
  id: text, title: text, provider, destination: destinationSchema,
  /** A repo-relative file for markdown; `owner/name#42` for a GitHub issue. */
  path: text,
  /** The item's own web page, when its provider has one. Only https. */
  url: z.string().regex(/^https:\/\//u).optional().catch(undefined),
  status: z.string().catch(""),
  priority: z.string().optional().catch(undefined),
  labels: z.array(z.string()).catch([]),
  created: z.string().optional().catch(undefined),
  assignedToMe: z.boolean().catch(false), assignees: z.array(z.string()).max(10).catch([]),
  open: z.boolean(),
  // A readiness this client does not know reads as blocked: it never offers a launch the server would refuse.
  readiness: z.enum(["ready", "blocked", "claimed", "closed"]).catch("blocked"),
  blockingIds: z.array(z.string()).catch([]),
  claim: backlogClaimSchema.optional().catch(undefined),
  /** Two or more live claims for one Azure item, from before an item had one claim. It stays held until one remains. */
  contested: z.object({ claims: z.array(backlogClaimSchema).min(2), message: z.string() }).optional().catch(undefined),
};
/** A project's item names its project; a source's item has no project of its own, only a destination. */
export const backlogItemSchema = z.union([
  z.object({ ...itemFields, owner: projectOwner, projectId: text, projectName: text, repo: text }),
  z.object({ ...itemFields, owner: sourceOwner }),
]);
export type BacklogItem = z.infer<typeof backlogItemSchema>;
export type BacklogOwner = BacklogItem["owner"];

export const backlogWarningSchema = z.object({
  /** The project or the source the warning is about. A warning names at most one. */
  projectId: text.optional().catch(undefined), sourceId: text.optional().catch(undefined), path: z.string(),
  kind: z.enum(["ignored-directory", "invalid-item", "project-error", "scan-limit", "provider-auth", "provider-install", "provider-unavailable", "items-hidden",
    "source-overlap", "contested-claim", "retired-repo-azure"]).or(z.string()),
  provider: z.string().optional().catch(undefined),
  message: z.string(),
});
export type BacklogWarning = z.infer<typeof backlogWarningSchema>;

/** One malformed entry drops out, not the list. */
const readable = <T>(schema: z.ZodType<T>) => z.array(z.unknown()).transform((values) => values.flatMap((value) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? [parsed.data] : [];
}));
/** A backlog source as the list sees it: its board, its destination, and what went wrong reading it. */
export const backlogSourceSummarySchema = z.object({
  sourceId: text, label: text, provider: z.string().catch("azure-devops"), organization: text, areaPath: text.optional().catch(undefined),
  destination: destinationSchema, warnings: readable(backlogWarningSchema).catch([]),
});
export type BacklogSourceSummary = z.infer<typeof backlogSourceSummarySchema>;

export const backlogListSchema = z.object({
  projects: z.array(z.object({ projectId: text, providers: z.array(z.string()) })).optional(),
  sources: readable(backlogSourceSummarySchema).catch([]),
  items: readable(backlogItemSchema),
  warnings: readable(backlogWarningSchema),
  generatedAt: z.string(),
});
export type BacklogList = z.infer<typeof backlogListSchema>;

export const backlogDetailSchema = z.object({ item: backlogItemSchema, body: z.string(), initialPrompt: z.string(),
  imageSummary: z.object({ count: z.number().int().nonnegative(), eligibleCount: z.number().int().nonnegative(),
    skipped: z.array(z.object({ index: z.number().int().positive(), name: z.string(), reason: z.string() })),
  }).optional(),
});
export type BacklogDetail = z.infer<typeof backlogDetailSchema>;

export const backlogLaunchSchema = z.object({
  session: z.object({ id: text, cwd: text }),
  claim: backlogClaimSchema,
  initialPrompt: z.string(),
  reused: z.boolean().catch(false),
  images: z.array(z.object({ kind: z.literal("image"), mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]), data: z.string(), name: z.string().optional() })).max(10).optional(),
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

interface RefFields { itemId: string; provider?: string | undefined; scope?: BacklogScope | undefined }
/**
 * One item. A project's item is addressed through its project; a source's item through its source.
 * The same id from two providers is two items, so a reference always says which provider; absent means markdown.
 */
export type BacklogRef = (RefFields & { projectId: string; sourceId?: undefined }) | (RefFields & { sourceId: string; projectId?: undefined });
export const MARKDOWN = "markdown";
/** The one provider a source lists in this version. */
export const AZURE_DEVOPS = "azure-devops";
export const providerOf = (ref: Pick<RefFields, "provider">) => ref.provider ?? MARKDOWN;
/** Markdown items keep the bare path, so this client still works against a server older than providers. */
const itemPath = (ref: BacklogRef) => ref.sourceId !== undefined
  ? `/api/backlog/sources/${encodeURIComponent(ref.sourceId)}/items/${encodeURIComponent(ref.itemId)}`
  : `/api/backlog/${encodeURIComponent(ref.projectId)}/items/${encodeURIComponent(ref.itemId)}`;
const providerQuery = (ref: BacklogRef) => {
  const params = new URLSearchParams();
  // A source's route lists one provider, so it needs no name.
  if (ref.sourceId === undefined && providerOf(ref) !== MARKDOWN) params.set("provider", providerOf(ref));
  if (ref.scope !== undefined) params.set("scope", ref.scope);
  return params.size ? `?${params.toString()}` : "";
};

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
    list: (signal?: AbortSignal, scope: BacklogScope = "mine") => call(`/api/backlog?scope=${scope}`, backlogListSchema, signal ? { signal } : {}),
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
