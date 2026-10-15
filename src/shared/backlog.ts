import { Type, type Static } from "typebox";
import { UserSessionStartSchema } from "./sessionWorktree.js";

const text = Type.String({ minLength: 1, maxLength: 4096 });
/** Which issue authors a GitHub backlog lists. `trusted` means the repo's owner, members, and collaborators. */
export const BacklogGitHubAuthorsSchema = Type.Union([Type.Literal("trusted"), Type.Literal("all")]);
export const BacklogGitHubConfigSchema = Type.Object({
  /** `owner/name`. Overrides the repo read from the project's `origin` remote. */
  repo: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$" })),
  authors: Type.Optional(BacklogGitHubAuthorsSchema),
  /** Bot logins whose text reaches the agent even when only trusted authors are listed. */
  trustedBots: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}\\[bot\\]$" }), { maxItems: 20, uniqueItems: true })),
}, { additionalProperties: false });
/** Server-owned credentials are never accepted in project config. */
export const BacklogAzureDevopsConfigSchema = Type.Object({
  organization: Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$" }),
  project: Type.String({ minLength: 1, maxLength: 128, pattern: "^(?!\\.{1,2}$)[^\\u0000-\\u001f/\\\\]+$" }),
  /** Optional exact Azure Area Path; includes descendants. */
  areaPath: Type.Optional(Type.String({ minLength: 1, maxLength: 1024, pattern: "^[^\\u0000-\\u001f]+$" })),
}, { additionalProperties: false });
export type BacklogAzureDevopsConfig = Static<typeof BacklogAzureDevopsConfigSchema>;
export const BacklogConfigSchema = Type.Object({
  dir: Type.Optional(text),
  /** Providers this project lists. Omitted means markdown only. */
  providers: Type.Optional(Type.Array(Type.Union([Type.Literal("markdown"), Type.Literal("github"), Type.Literal("azure-devops")]), { minItems: 1, maxItems: 3, uniqueItems: true })),
  github: Type.Optional(BacklogGitHubConfigSchema),
  azureDevops: Type.Optional(BacklogAzureDevopsConfigSchema),
}, { additionalProperties: false });
export type BacklogConfig = Static<typeof BacklogConfigSchema>;

/** Retire legacy Azure sections without changing the project-owned provider configuration. */
export function projectOwnedBacklog(backlog: BacklogConfig): BacklogConfig & { providers: NonNullable<BacklogConfig["providers"]> } {
  const { providers } = backlog;
  const rest = { ...(backlog.dir === undefined ? {} : { dir: backlog.dir }), ...(backlog.github === undefined ? {} : { github: backlog.github }) };
  const enabled = providers?.filter((provider) => provider !== "azure-devops");
  return { ...rest, ...(enabled === undefined || enabled.length === 0 ? { providers: ["markdown"] } : { providers: enabled }) };
}

export const BacklogMetadataSchema = Type.Object({
  id: text, title: text,
  status: Type.Optional(text), priority: Type.Optional(text),
  labels: Type.Optional(Type.Array(text, { maxItems: 100 })),
  created: Type.Optional(text), source: Type.Optional(text),
  blocked_by: Type.Optional(Type.Array(text, { maxItems: 1000 })),
});
export type BacklogMetadata = Static<typeof BacklogMetadataSchema>;

/**
 * Where an item comes from, such as `markdown`. Azure identity is (provider, id); project providers use (repo, provider, id).
 * Which providers exist is a fact of the host, not of this contract. Not the frontmatter `source` field,
 * which records who captured a markdown item.
 */
export const BacklogProviderIdSchema = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export type BacklogProviderId = Static<typeof BacklogProviderIdSchema>;
export const BacklogScopeSchema = Type.Union([Type.Literal("mine"), Type.Literal("everyone")]);
export type BacklogScope = Static<typeof BacklogScopeSchema>;
export const BacklogListQuerySchema = Type.Object({ scope: Type.Optional(BacklogScopeSchema) }, { additionalProperties: false });
export const BacklogItemQuerySchema = Type.Object({ provider: Type.Optional(BacklogProviderIdSchema), scope: Type.Optional(BacklogScopeSchema) }, { additionalProperties: false });

const claimIdentity = {
  claimId: text, requestId: text, fingerprint: text,
  projectId: text, provider: BacklogProviderIdSchema, itemId: text, repo: text, cwd: text, claimedAt: text,
  sourceId: Type.Optional(text),
};
export const BacklogClaimSchema = Type.Union([
  Type.Object({ ...claimIdentity, kind: Type.Literal("launching") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("interrupted") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("claimed"), sessionId: text, branch: Type.Optional(text) }, { additionalProperties: false }),
]);
export type BacklogClaim = Static<typeof BacklogClaimSchema>;

const projectOwner = Type.Object({ kind: Type.Literal("project"), projectId: text, projectName: text, repo: text }, { additionalProperties: false });
const sourceOwner = Type.Object({ kind: Type.Literal("source"), sourceId: text, label: text }, { additionalProperties: false });
export const BacklogOwnerSchema = Type.Union([projectOwner, sourceOwner]);
export type BacklogItemOwner = Static<typeof BacklogOwnerSchema>;
export const DestinationSchema = Type.Union([
  Type.Object({ kind: Type.Literal("routed"), projectId: text, reason: Type.Union([Type.Literal("source-destination"), Type.Literal("project-owned")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("not-routed"), reason: Type.Union([Type.Literal("unset"), Type.Literal("missing-project")]) }, { additionalProperties: false }),
]);
export type Destination = Static<typeof DestinationSchema>;
const itemFields = {
  ...BacklogMetadataSchema.properties,
  provider: BacklogProviderIdSchema,
  destination: DestinationSchema,
  /** Where the item lives inside its provider: a repo-relative file for markdown, `owner/name#42` for GitHub. */
  path: text,
  /** A web page for the item, when the provider has one. */
  url: Type.Optional(Type.String({ pattern: "^https://", maxLength: 4096 })),
  status: text, labels: Type.Array(text), blocked_by: Type.Array(text),
  assignedToMe: Type.Boolean(), assignees: Type.Array(text, { maxItems: 10 }),
  open: Type.Boolean(),
  readiness: Type.Union([Type.Literal("ready"), Type.Literal("blocked"), Type.Literal("claimed"), Type.Literal("closed")]),
  blockingIds: Type.Array(text),
  claim: Type.Optional(BacklogClaimSchema),
  /** Legacy duplicate Azure claims remain held until explicit release. */
  contested: Type.Optional(Type.Object({ claims: Type.Array(BacklogClaimSchema, { minItems: 2 }), message: Type.String() })),
};
export const BacklogItemSchema = Type.Union([
  Type.Object({ ...itemFields, owner: projectOwner, projectId: text, projectName: text, repo: text }),
  Type.Object({ ...itemFields, owner: sourceOwner, projectId: Type.Optional(Type.Never()), projectName: Type.Optional(Type.Never()), repo: Type.Optional(Type.Never()) }),
]);
export type BacklogItem = Static<typeof BacklogItemSchema>;

export const BacklogWarningSchema = Type.Object({
  projectId: Type.Optional(text), sourceId: Type.Optional(text), path: text,
  kind: Type.Union([
    Type.Literal("ignored-directory"), Type.Literal("invalid-item"), Type.Literal("project-error"), Type.Literal("scan-limit"),
    /** The provider is not set up on this machine, or its setup stopped working. The fix is in the backlog, not in files. */
    Type.Literal("provider-auth"),
    /** The provider is set up but may not read this project's repo. The fix is to install it there. */
    Type.Literal("provider-install"),
    /** The provider could not list items: no access, no remote, rate limited, or offline. The message names the fix. */
    Type.Literal("provider-unavailable"),
    /** Some items were left out on purpose, such as issues from untrusted authors. */
    Type.Literal("items-hidden"), Type.Literal("source-overlap"), Type.Literal("contested-claim"), Type.Literal("retired-repo-azure"),
  ]),
  provider: Type.Optional(BacklogProviderIdSchema),
  message: Type.String(),
});
export type BacklogWarning = Static<typeof BacklogWarningSchema>;
export const BacklogSourceSummarySchema = Type.Object({
  sourceId: text, label: text, provider: Type.Literal("azure-devops"),
  organization: text, areaPath: Type.Optional(text), destination: DestinationSchema, warnings: Type.Array(BacklogWarningSchema),
});
export type BacklogSourceSummary = Static<typeof BacklogSourceSummarySchema>;
export const BacklogListResponseSchema = Type.Object({
  projects: Type.Optional(Type.Array(Type.Object({ projectId: text, providers: Type.Array(BacklogProviderIdSchema) }))),
  sources: Type.Array(BacklogSourceSummarySchema),
  items: Type.Array(BacklogItemSchema), warnings: Type.Array(BacklogWarningSchema), generatedAt: text,
});
export type BacklogListResponse = Static<typeof BacklogListResponseSchema>;
export const BacklogImageSummarySchema = Type.Object({
  count: Type.Integer({ minimum: 0 }), eligibleCount: Type.Integer({ minimum: 0 }),
  skipped: Type.Array(Type.Object({ index: Type.Integer({ minimum: 1 }), name: Type.String(), reason: Type.String() })),
});
export const BacklogPromptImageSchema = Type.Object({
  kind: Type.Literal("image"), mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg"), Type.Literal("image/gif"), Type.Literal("image/webp")]),
  data: Type.String(), name: Type.Optional(Type.String()),
});
export const BacklogLaunchContentSchema = Type.Object({
  initialPrompt: Type.String(), images: Type.Optional(Type.Array(BacklogPromptImageSchema, { maxItems: 10 })),
});
export type BacklogLaunchContent = Static<typeof BacklogLaunchContentSchema>;
export type BacklogImageSummary = Static<typeof BacklogImageSummarySchema>;
export const BacklogDetailResponseSchema = Type.Object({
  item: BacklogItemSchema, body: Type.String(), initialPrompt: Type.String(), imageSummary: Type.Optional(BacklogImageSummarySchema),
});
export type BacklogDetailResponse = Static<typeof BacklogDetailResponseSchema>;
export const BacklogLaunchRequestSchema = Type.Object({
  requestId: text,
  start: UserSessionStartSchema,
}, { additionalProperties: false });
export type BacklogLaunchRequest = Static<typeof BacklogLaunchRequestSchema>;
export const BacklogLaunchResponseSchema = Type.Object({
  session: Type.Object({ id: text, cwd: text }, { additionalProperties: false }),
  claim: BacklogClaimSchema,
  ...BacklogLaunchContentSchema.properties, reused: Type.Boolean(),
});
export type BacklogLaunchResponse = Static<typeof BacklogLaunchResponseSchema>;
export const BacklogReleaseRequestSchema = Type.Object({ claimId: text }, { additionalProperties: false });
export type BacklogReleaseRequest = Static<typeof BacklogReleaseRequestSchema>;
export const BacklogReleaseResponseSchema = Type.Object({ released: Type.Literal(true) }, { additionalProperties: false });
export type BacklogReleaseResponse = Static<typeof BacklogReleaseResponseSchema>;

export const BacklogErrorSchema = Type.Object({
  kind: Type.Union([Type.Literal("invalid-request"), Type.Literal("not-found"), Type.Literal("conflict"), Type.Literal("unavailable")]),
  error: Type.String(), claim: Type.Optional(BacklogClaimSchema),
});
export type BacklogErrorResponse = Static<typeof BacklogErrorSchema>;
