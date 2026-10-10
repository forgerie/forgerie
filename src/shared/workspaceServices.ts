import { Type, type Static } from "typebox";

const text = Type.String({ minLength: 1 });
const relativePath = Type.String({ minLength: 1, maxLength: 1024, pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\\\\\u0000]+$" });
export const WorkspaceEnvironmentSchema = Type.Union([
  Type.Literal("auto"), Type.Literal("none"), Type.Array(text, { minItems: 1, maxItems: 32 }),
]);
export const WorkspaceServicesConfigSchema = Type.Union([
  relativePath,
  Type.Object({ file: relativePath, ports: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{0,31}$" }), { maxItems: 16, uniqueItems: true })), preview: Type.Optional(text) }, { additionalProperties: false }),
]);
export type WorkspaceEnvironment = Static<typeof WorkspaceEnvironmentSchema>;
export type WorkspaceServicesConfig = Static<typeof WorkspaceServicesConfigSchema>;
export const WorkspaceServiceProcessSchema = Type.Object({
  name: text,
  kind: Type.Union([Type.Literal("waiting"), Type.Literal("starting"), Type.Literal("running"), Type.Literal("ready"), Type.Literal("completed"), Type.Literal("stopped"), Type.Literal("failed"), Type.Literal("unknown")]),
  restarts: Type.Integer({ minimum: 0 }), exitCode: Type.Integer(),
});
export type WorkspaceServiceProcess = Static<typeof WorkspaceServiceProcessSchema>;
const base = { worktreeId: text, ports: Type.Record(Type.String(), Type.Integer({ minimum: 1, maximum: 65535 })), stateDirectory: text };
export const WorkspaceServicesSnapshotSchema = Type.Union([
  Type.Object({ kind: Type.Literal("not-configured"), worktreeId: text }),
  Type.Object({ kind: Type.Literal("stopped"), ...base }),
  Type.Object({ kind: Type.Literal("unavailable"), ...base, error: text }),
  Type.Object({ kind: Type.Literal("running"), ...base, processes: Type.Array(WorkspaceServiceProcessSchema) }),
]);
export type WorkspaceServicesSnapshot = Static<typeof WorkspaceServicesSnapshotSchema>;
export const WorkspaceServiceActionSchema = Type.Object({
  action: Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")]),
  service: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  approve: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type WorkspaceServiceAction = Static<typeof WorkspaceServiceActionSchema>;
export const WorkspaceServicesLogsSchema = Type.Object({ logs: Type.Array(Type.String()), truncated: Type.Boolean() });
export type WorkspaceServicesLogs = Static<typeof WorkspaceServicesLogsSchema>;
export const WorkspaceServicesWaitSchema = Type.Object({ timeoutMs: Type.Integer({ minimum: 1, maximum: 120_000 }), service: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }, { additionalProperties: false });
export type WorkspaceServicesWait = Static<typeof WorkspaceServicesWaitSchema>;
export interface WorkspaceServicesEvent { type: "workspace.services"; snapshot: WorkspaceServicesSnapshot }
