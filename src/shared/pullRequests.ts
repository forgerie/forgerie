import { Type, type Static } from "typebox";

const text = Type.String();
const date = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T" });
export const PullRefSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 512 }),
  cwd: Type.String({ minLength: 1, maxLength: 32768 }),
});
export type PullSessionRef = Static<typeof PullRefSchema>;
export const PullWatchSchema = Type.Union([
  Type.Object({ kind: Type.Literal("off") }),
  Type.Object({ kind: Type.Literal("watching"), since: date, wakes: Type.Integer({ minimum: 0 }), lastWake: Type.Optional(date), error: Type.Optional(text) }),
  Type.Object({ kind: Type.Literal("stopped"), reason: text, at: date }),
]);
export const PullCheckSchema = Type.Object({
  id: text, name: text, state: Type.Union([Type.Literal("queued"), Type.Literal("running"), Type.Literal("passed"), Type.Literal("failed"), Type.Literal("cancelled")]),
  url: text, required: Type.Boolean(), updatedAt: Type.Optional(date), seconds: Type.Optional(Type.Number({ minimum: 0 })),
  logTail: Type.Optional(text), logSource: Type.Optional(Type.Literal("annotations")),
});
export type PullCheck = Static<typeof PullCheckSchema>;
export const PullRemarkSchema = Type.Object({
  id: text, author: text, body: text, updatedAt: date, url: text,
  kind: Type.Union([Type.Literal("comment"), Type.Literal("review")]),
  path: Type.Optional(text), line: Type.Optional(Type.Integer()),
});
export type PullRemark = Static<typeof PullRemarkSchema>;
export const PullRequestSchema = Type.Object({
  repo: text, number: Type.Integer({ minimum: 1 }), title: text, url: text,
  state: Type.Union([Type.Literal("open"), Type.Literal("draft"), Type.Literal("merged"), Type.Literal("closed")]),
  head: text, headSha: text, base: text, author: text, updatedAt: date,
  mergeability: Type.Union([Type.Literal("clean"), Type.Literal("conflicting"), Type.Literal("unknown")]),
  files: Type.Integer(), additions: Type.Integer(), deletions: Type.Integer(),
  checks: Type.Array(PullCheckSchema),
  reviews: Type.Array(Type.Object({ reviewer: text, state: Type.Union([Type.Literal("approved"), Type.Literal("changes_requested"), Type.Literal("commented")]), updatedAt: date })),
  comments: Type.Array(PullRemarkSchema),
  complete: Type.Boolean(),
  merge: Type.Union([Type.Object({ kind: Type.Literal("allowed") }), Type.Object({ kind: Type.Literal("blocked"), reason: text })]),
});
export type PullRequest = Static<typeof PullRequestSchema>;
export const PullProviderSchema = Type.Union([Type.Literal("github"), Type.Literal("azure-devops")]);
/** Optional link confirmation keeps a preview tied to the repository the reader saw. */
export const PullRepositorySchema = Type.Object({ provider: PullProviderSchema, repo: Type.String({ minLength: 1, maxLength: 512 }) }, { additionalProperties: false });
export type PullRepository = Static<typeof PullRepositorySchema>;
export const PullLinkSchema = Type.Object({ provider: PullProviderSchema, session: PullRefSchema, repo: text, number: Type.Integer({ minimum: 1 }), watch: PullWatchSchema });
export type PullLink = Static<typeof PullLinkSchema>;
/** One linked pull request and its provider read. */
export const SessionPullResponseSchema = Type.Object({ link: PullLinkSchema, pull: PullRequestSchema });
/** Every pull request linked to a session, oldest first. A failed read keeps its link, with `pull: null` and the reason. */
export const SessionPullsResponseSchema = Type.Object({ items: Type.Array(Type.Object({ link: PullLinkSchema, pull: Type.Union([PullRequestSchema, Type.Null()]), error: Type.Optional(text) })) });
export const PullErrorSchema = Type.Object({ kind: Type.Literal("pull_request_error"), error: text });

/** Discovery is separate from session links. At most 50 open/draft summaries, newest first. */
export const OpenPullSummarySchema = Type.Object({
  repo: Type.String({ minLength: 1, maxLength: 512 }), number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  title: Type.String({ maxLength: 8000 }), url: Type.String({ maxLength: 32768 }),
  state: Type.Union([Type.Literal("open"), Type.Literal("draft")]),
  head: Type.String({ maxLength: 1024 }), base: Type.String({ maxLength: 1024 }), author: Type.String({ maxLength: 1024 }), updatedAt: Type.String({ maxLength: 64, pattern: "^\\d{4}-\\d{2}-\\d{2}T" }),
});
export const RepositoryOpenPullsSchema = Type.Object({ repo: Type.String({ minLength: 1, maxLength: 512 }), items: Type.Array(OpenPullSummarySchema, { maxItems: 50 }), complete: Type.Boolean() });
export type RepositoryOpenPulls = Static<typeof RepositoryOpenPullsSchema>;
export const OpenPullsResponseSchema = Type.Object({ provider: PullProviderSchema, ...RepositoryOpenPullsSchema.properties });
export type OpenPullsResponse = Static<typeof OpenPullsResponseSchema>;
/** A read-only preview has no link and no watch state. */
export const PullPreviewResponseSchema = Type.Object({ provider: PullProviderSchema, pull: PullRequestSchema });
export type PullPreviewResponse = Static<typeof PullPreviewResponseSchema>;
