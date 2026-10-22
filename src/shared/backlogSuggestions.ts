import { Type, type Static } from "typebox";

const text = Type.String({ minLength: 1, maxLength: 4096, pattern: "\\S" });
export const BacklogSuggestionModelSchema = Type.Object({ modelSpec: Type.Optional(text), thinkingLevel: Type.Optional(text) }, { additionalProperties: false });
export type BacklogSuggestionModel = Static<typeof BacklogSuggestionModelSchema>;
export const SuggestBacklogInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }), body: Type.String({ maxLength: 48000 }),
  why: text, files: Type.Array(text, { maxItems: 100 }), decisions: Type.Array(text, { maxItems: 100 }),
}, { additionalProperties: false });
export type SuggestBacklogInput = Static<typeof SuggestBacklogInputSchema>;
export const BacklogSuggestionDestinationSchema = Type.Union([
  Type.Object({ provider: Type.Literal("markdown"), path: text }, { additionalProperties: false }),
  Type.Object({ provider: Type.Literal("github"), repo: text, label: Type.Literal("agent-filed") }, { additionalProperties: false }),
]);
export type BacklogSuggestionDestination = Static<typeof BacklogSuggestionDestinationSchema>;
const filed = { decisionLogWarning: Type.Optional(Type.String()), provider: Type.Union([Type.Literal("markdown"), Type.Literal("github")]), path: Type.Optional(text), number: Type.Optional(Type.Integer({ minimum: 1 })), url: Type.Optional(text), at: text };
export const BacklogSuggestionStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("open") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("filing"), action: Type.Union([Type.Literal("file"), Type.Literal("file-and-act")]) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("filed"), ...filed, launchError: Type.Optional(Type.Object({ message: Type.String(), retryable: Type.Boolean() }, { additionalProperties: false })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("started"), ...filed, sessionId: text, claimId: text, ...BacklogSuggestionModelSchema.properties }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("duplicate"), matches: Type.Array(Type.Object({ number: Type.Optional(Type.Integer({ minimum: 1 })), path: Type.Optional(text), title: Type.String(), state: Type.String(), url: Type.Optional(text) }, { additionalProperties: false })) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String(), retryable: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("dismissed"), at: text }, { additionalProperties: false }),
]);
export const BacklogSuggestionSchema = Type.Object({
  id: text, sessionId: text, projectId: text, sessionTitle: Type.Optional(text), title: SuggestBacklogInputSchema.properties.title, body: SuggestBacklogInputSchema.properties.body,
  context: Type.Object({ why: text, files: SuggestBacklogInputSchema.properties.files, decisions: SuggestBacklogInputSchema.properties.decisions }, { additionalProperties: false }),
  destination: BacklogSuggestionDestinationSchema, azureReadOnlyNote: Type.Optional(Type.Boolean()), defaultModel: BacklogSuggestionModelSchema,
  createdAt: text, revision: Type.Integer({ minimum: 1 }), state: BacklogSuggestionStateSchema,
}, { additionalProperties: false });
export type BacklogSuggestion = Static<typeof BacklogSuggestionSchema>;
export type BacklogSuggestionState = Static<typeof BacklogSuggestionStateSchema>;
export const BacklogSuggestionFileRequestSchema = Type.Object({ requestId: text, title: Type.Optional(SuggestBacklogInputSchema.properties.title), body: Type.Optional(SuggestBacklogInputSchema.properties.body), notDuplicateOf: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 100, uniqueItems: true })) }, { additionalProperties: false });
export const BacklogSuggestionActRequestSchema = Type.Object({ ...BacklogSuggestionFileRequestSchema.properties, ...BacklogSuggestionModelSchema.properties }, { additionalProperties: false });
export type BacklogSuggestionFileRequest = Static<typeof BacklogSuggestionFileRequestSchema>;
export type BacklogSuggestionActRequest = Static<typeof BacklogSuggestionActRequestSchema>;
export const BacklogSuggestionsQuerySchema = Type.Object({ sessionId: Type.Optional(text), state: Type.Optional(Type.Index(BacklogSuggestionStateSchema, ["kind"])) }, { additionalProperties: false });
export type BacklogSuggestionsQuery = Static<typeof BacklogSuggestionsQuerySchema>;
export const BacklogSuggestionsResponseSchema = Type.Object({ suggestions: Type.Array(BacklogSuggestionSchema) }, { additionalProperties: false });
export type BacklogSuggestionsResponse = Static<typeof BacklogSuggestionsResponseSchema>;
export interface BacklogSuggestionsChangedEvent { type: "backlog.suggestions.changed"; sessionId: string; suggestionId: string }
