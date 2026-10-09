import { Type, type Static } from "typebox";

const text = Type.String({ minLength: 1 });
const identity = { id: text, repo: text, path: text, branch: text };
export const WorktreeKeepReasonSchema = Type.Union([
  Type.Literal("dirty"), Type.Literal("unmerged"), Type.Literal("in-use"),
  Type.Literal("setup-incomplete"), Type.Literal("checkout-changed"), Type.Literal("error"),
]);
export const WorktreeCleanupOutcomeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("removed") }),
  Type.Object({ kind: Type.Literal("kept"), reason: WorktreeKeepReasonSchema, detail: Type.Optional(text) }),
]);
export type WorktreeCleanupOutcome = Static<typeof WorktreeCleanupOutcomeSchema>;
export const WorktreeCleanupReportSchema = Type.Object({
  startedAt: text, finishedAt: text,
  removed: Type.Array(Type.Object(identity)),
  kept: Type.Array(Type.Object({ ...identity, reason: WorktreeKeepReasonSchema, detail: Type.Optional(text) })),
});
export type WorktreeCleanupReport = Static<typeof WorktreeCleanupReportSchema>;
export const WorktreeCleanupStateSchema = Type.Union([
  Type.Object({ phase: Type.Literal("never-run") }),
  Type.Object({ phase: Type.Literal("running"), previous: Type.Optional(WorktreeCleanupReportSchema) }),
  Type.Object({ phase: Type.Literal("done"), report: WorktreeCleanupReportSchema }),
  Type.Object({ phase: Type.Literal("failed"), error: text, previous: Type.Optional(WorktreeCleanupReportSchema) }),
]);
export type WorktreeCleanupState = Static<typeof WorktreeCleanupStateSchema>;
