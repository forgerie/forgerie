import { Type, type Static } from "typebox";
import { BacklogSourceSchema, BacklogSourceSettingsSchema } from "./backlogSources.js";
import { BacklogConfigSchema } from "./backlog.js";
export const GitHubLoginSchema = Type.String({ minLength: 1, maxLength: 39, pattern: "^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$" });
export const BacklogSettingsEntrySchema = Type.Object({ backlog: Type.Intersect([BacklogConfigSchema, Type.Required(Type.Pick(BacklogConfigSchema, ["providers"]))]), revision: Type.Integer({ minimum: 1 }), updatedAt: Type.String() }, { additionalProperties: false });
export const BacklogSettingsV1FileSchema = Type.Object({ version: Type.Literal(1), revision: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), githubLogin: Type.Optional(GitHubLoginSchema), projects: Type.Record(Type.String(), BacklogSettingsEntrySchema) }, { additionalProperties: false });
export const BacklogSettingsFileSchema = Type.Object({
  ...BacklogSettingsV1FileSchema.properties, version: Type.Literal(2), sources: Type.Record(Type.String(), BacklogSourceSchema),
}, { additionalProperties: false });
export type BacklogSettingsFile = Static<typeof BacklogSettingsFileSchema>;
export const BacklogProjectSettingsSchema = Type.Object({ projectId: Type.String(), source: Type.Union([Type.Literal("forgerie"), Type.Literal("repo-file"), Type.Literal("default")]), backlog: BacklogConfigSchema, revision: Type.Optional(Type.Integer({ minimum: 1 })), warnings: Type.Optional(Type.Array(Type.String())) });
export type BacklogProjectSettings = Static<typeof BacklogProjectSettingsSchema>;
export const BacklogProjectSettingsErrorSchema = Type.Object({ projectId: Type.String(), error: Type.String() }, { additionalProperties: false });
export const BacklogSettingsResponseSchema = Type.Object({ githubLogin: Type.Optional(GitHubLoginSchema), sources: Type.Array(BacklogSourceSettingsSchema), projects: Type.Array(Type.Union([BacklogProjectSettingsSchema, BacklogProjectSettingsErrorSchema])) });
export type BacklogSettingsResponse = Static<typeof BacklogSettingsResponseSchema>;
export const BacklogSettingsSaveSchema = Type.Object({ backlog: BacklogConfigSchema, baseRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const BacklogSettingsDeleteSchema = Type.Object({ baseRevision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const BacklogGitHubLoginRequestSchema = Type.Object({ githubLogin: Type.Union([GitHubLoginSchema, Type.Null()]) }, { additionalProperties: false });
