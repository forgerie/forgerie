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
export const PullLinkSchema = Type.Object({ session: PullRefSchema, repo: text, number: Type.Integer({ minimum: 1 }), watch: PullWatchSchema });
export type PullLink = Static<typeof PullLinkSchema>;
export const SessionPullResponseSchema = Type.Object({ link: Type.Union([PullLinkSchema, Type.Null()]), pull: Type.Union([PullRequestSchema, Type.Null()]) });
export const PullErrorSchema = Type.Object({ kind: Type.Literal("pull_request_error"), error: text });
