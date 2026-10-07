import { Type, type Static } from "typebox";
import { UserSessionStartSchema } from "./sessionWorktree.js";

const text = Type.String({ minLength: 1, maxLength: 4096 });
export const BacklogConfigSchema = Type.Object({ dir: text }, { additionalProperties: false });
export type BacklogConfig = Static<typeof BacklogConfigSchema>;

export const BacklogMetadataSchema = Type.Object({
  id: text, title: text,
  status: Type.Optional(text), priority: Type.Optional(text),
  labels: Type.Optional(Type.Array(text, { maxItems: 100 })),
  created: Type.Optional(text), source: Type.Optional(text),
  blocked_by: Type.Optional(Type.Array(text, { maxItems: 1000 })),
});
export type BacklogMetadata = Static<typeof BacklogMetadataSchema>;

const claimIdentity = {
  claimId: text, requestId: text, fingerprint: text,
  projectId: text, itemId: text, repo: text, cwd: text, claimedAt: text,
};
export const BacklogClaimSchema = Type.Union([
  Type.Object({ ...claimIdentity, kind: Type.Literal("launching") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("interrupted") }, { additionalProperties: false }),
  Type.Object({ ...claimIdentity, kind: Type.Literal("claimed"), sessionId: text, branch: Type.Optional(text) }, { additionalProperties: false }),
]);
export type BacklogClaim = Static<typeof BacklogClaimSchema>;

export const BacklogItemSchema = Type.Object({
  ...BacklogMetadataSchema.properties,
  projectId: text, projectName: text, repo: text, path: text,
  status: text, labels: Type.Array(text), blocked_by: Type.Array(text),
  open: Type.Boolean(),
  readiness: Type.Union([Type.Literal("ready"), Type.Literal("blocked"), Type.Literal("claimed"), Type.Literal("closed")]),
  blockingIds: Type.Array(text),
  claim: Type.Optional(BacklogClaimSchema),
});
export type BacklogItem = Static<typeof BacklogItemSchema>;

export const BacklogWarningSchema = Type.Object({
  projectId: text, path: text,
  kind: Type.Union([Type.Literal("ignored-directory"), Type.Literal("invalid-item"), Type.Literal("project-error"), Type.Literal("scan-limit")]),
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
