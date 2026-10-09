import { Type, type Static } from "typebox";

export const RESOURCE_EDITOR_MAX_BYTES = 1024 * 1024;
// JSON escaping can expand each UTF-8 input byte into six wire bytes.
export const RESOURCE_EDITOR_BODY_LIMIT = RESOURCE_EDITOR_MAX_BYTES * 6 + 4096;
export const RESOURCE_EDITOR_MAX_ITEMS = 1000;
const text = Type.String({ minLength: 1 });
const id = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const ResourceEditorScopeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("settings") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("session"), sessionId: text, cwd: text }, { additionalProperties: false }),
]);
export type ResourceEditorScope = Static<typeof ResourceEditorScopeSchema>;

export const ResourceEditorEntrySchema = Type.Object({
  id,
  kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("context")]),
  name: text,
  description: Type.String(),
  path: text,
  origin: Type.Object({
    kind: Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("package"), Type.Literal("bundled")]),
    source: text,
    scope: Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("temporary")]),
    root: text,
  }),
  activation: Type.Union([
    Type.Object({ kind: Type.Literal("active") }),
    Type.Object({ kind: Type.Literal("shadowed"), winnerId: id }),
    Type.Object({ kind: Type.Literal("disabled") }),
    Type.Object({ kind: Type.Literal("invalid"), message: text }),
  ]),
  manual: Type.Boolean(),
  edit: Type.Union([
    Type.Object({ kind: Type.Literal("writable"), saveEffect: Type.Union([Type.Literal("file-only"), Type.Literal("uncommitted"), Type.Literal("commit")]) }),
    Type.Object({ kind: Type.Literal("read-only"), reason: text }),
  ]),
});
export type ResourceEditorEntry = Static<typeof ResourceEditorEntrySchema>;

export const ResourceEditorInventorySchema = Type.Object({
  scope: ResourceEditorScopeSchema,
  basis: Type.Literal("configured-files-on-disk"),
  resources: Type.Array(ResourceEditorEntrySchema, { maxItems: RESOURCE_EDITOR_MAX_ITEMS }),
  diagnostics: Type.Array(Type.String()),
  maxFileBytes: Type.Literal(RESOURCE_EDITOR_MAX_BYTES),
});
export type ResourceEditorInventory = Static<typeof ResourceEditorInventorySchema>;

export const ResourceEditorFileSchema = Type.Object({
  resource: ResourceEditorEntrySchema,
  text: Type.String(),
  revision: id,
});
export type ResourceEditorFile = Static<typeof ResourceEditorFileSchema>;

export const ResourceEditorSaveRequestSchema = Type.Object({
  // The service bounds UTF-8 bytes, not JavaScript string length.
  text: Type.String(),
  baseRevision: id,
}, { additionalProperties: false });
export type ResourceEditorSaveRequest = Static<typeof ResourceEditorSaveRequestSchema>;

export const ResourceEditorSaveSchema = Type.Object({
  file: ResourceEditorFileSchema,
  effect: Type.Union([
    Type.Object({ kind: Type.Literal("unchanged") }),
    Type.Object({ kind: Type.Literal("file-only") }),
    Type.Object({ kind: Type.Literal("uncommitted") }),
    Type.Object({ kind: Type.Literal("committed"), sha: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }), branch: text }),
  ]),
  reload: Type.Literal("explicit-session-reload"),
});
export type ResourceEditorSave = Static<typeof ResourceEditorSaveSchema>;

// Git SHA-1 repositories return 40 digits; resource/revision IDs always use SHA-256.
export const ResourceEditorErrorSchema = Type.Object({
  error: Type.Object({
    kind: Type.Union([
      Type.Literal("invalid-request"), Type.Literal("not-found"), Type.Literal("read-only"), Type.Literal("conflict"), Type.Literal("over-limit"),
      Type.Literal("unsafe-git-state"), Type.Literal("commit-failed"), Type.Literal("io-error"), Type.Literal("busy"),
    ]),
    message: text,
    savedToDisk: Type.Boolean(),
  }),
});
export type ResourceEditorErrorResponse = Static<typeof ResourceEditorErrorSchema>;
