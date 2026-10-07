import { Type, type Static } from "typebox";
import { UserSessionStartSchema } from "./sessionWorktree.js";

const text = Type.String({ minLength: 1, maxLength: 4096 });
/** Which issue authors a GitHub backlog lists. `trusted` means the repo's owner, members, and collaborators. */
export const BacklogGitHubAuthorsSchema = Type.Union([Type.Literal("trusted"), Type.Literal("all")]);
export const BacklogGitHubConfigSchema = Type.Object({
  /** `owner/name`. Overrides the repo read from the project's `origin` remote. */
  repo: Type.Optional(Type.String({ pattern: "^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$" })),
  authors: Type.Optional(BacklogGitHubAuthorsSchema),
}, { additionalProperties: false });
export const BacklogConfigSchema = Type.Object({
  dir: Type.Optional(text),
  /** Providers this project lists. Omitted means markdown only. */
  providers: Type.Optional(Type.Array(Type.Union([Type.Literal("markdown"), Type.Literal("github")]), { minItems: 1, maxItems: 2, uniqueItems: true })),
  github: Type.Optional(BacklogGitHubConfigSchema),
}, { additionalProperties: false });
export type BacklogConfig = Static<typeof BacklogConfigSchema>;

export const BacklogMetadataSchema = Type.Object({
  id: text, title: text,
  status: Type.Optional(text), priority: Type.Optional(text),
  labels: Type.Optional(Type.Array(text, { maxItems: 100 })),
  created: Type.Optional(text), source: Type.Optional(text),
  blocked_by: Type.Optional(Type.Array(text, { maxItems: 1000 })),
});
export type BacklogMetadata = Static<typeof BacklogMetadataSchema>;

/**
 * Where an item comes from, such as `markdown`. An item is identified by (repo, provider, id), never by id alone.
 * Which providers exist is a fact of the host, not of this contract. Not the frontmatter `source` field,
 * which records who captured a markdown item.
 */
export const BacklogProviderIdSchema = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export type BacklogProviderId = Static<typeof BacklogProviderIdSchema>;
export const BacklogItemQuerySchema = Type.Object({ provider: Type.Optional(BacklogProviderIdSchema) });

const claimIdentity = {
  claimId: text, requestId: text, fingerprint: text,
  projectId: text, provider: BacklogProviderIdSchema, itemId: text, repo: text, cwd: text, claimedAt: text,
};
export const BacklogClaimSchema = Type.Union([
  Type.Object({ ...claimIdentity, kind: Type.Literal("launching") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("interrupted") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("claimed"), sessionId: text, branch: Type.Optional(text) }, { additionalProperties: false }),
]);
export type BacklogClaim = Static<typeof BacklogClaimSchema>;

export const BacklogItemSchema = Type.Object({
  ...BacklogMetadataSchema.properties,
  provider: BacklogProviderIdSchema,
  projectId: text, projectName: text, repo: text,
  /** Where the item lives inside its provider: a repo-relative file for markdown, `owner/name#42` for GitHub. */
  path: text,
  /** A web page for the item, when the provider has one. */
  url: Type.Optional(Type.String({ pattern: "^https://", maxLength: 4096 })),
  status: text, labels: Type.Array(text), blocked_by: Type.Array(text),
  open: Type.Boolean(),
  readiness: Type.Union([Type.Literal("ready"), Type.Literal("blocked"), Type.Literal("claimed"), Type.Literal("closed")]),
  blockingIds: Type.Array(text),
  claim: Type.Optional(BacklogClaimSchema),
});
export type BacklogItem = Static<typeof BacklogItemSchema>;

export const BacklogWarningSchema = Type.Object({
  projectId: text, path: text,
  kind: Type.Union([
    Type.Literal("ignored-directory"), Type.Literal("invalid-item"), Type.Literal("project-error"), Type.Literal("scan-limit"),
    /** The provider needs a login before it can list items. The fix is to connect, not to edit files. */
    Type.Literal("provider-auth"),
    /** The provider could not list items: no access, no remote, rate limited, or offline. The message names the fix. */
    Type.Literal("provider-unavailable"),
    /** Some items were left out on purpose, such as issues from untrusted authors. */
    Type.Literal("items-hidden"),
  ]),
  provider: Type.Optional(BacklogProviderIdSchema),
  message: Type.String(),
});
export type BacklogWarning = Static<typeof BacklogWarningSchema>;
export const BacklogListResponseSchema = Type.Object({
  items: Type.Array(BacklogItemSchema), warnings: Type.Array(BacklogWarningSchema), generatedAt: text,
});
export type BacklogListResponse = Static<typeof BacklogListResponseSchema>;
export const BacklogDetailResponseSchema = Type.Object({
  item: BacklogItemSchema, body: Type.String(), initialPrompt: Type.String(),
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
  initialPrompt: Type.String(), reused: Type.Boolean(),
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
