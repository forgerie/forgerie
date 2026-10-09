import { Type, type Static } from "typebox";
import { RelatedSessionSchema, type RelatedSession } from "./projectGroups.js";

const text = Type.String({ minLength: 1 });
export const NewSessionDestinationSchema = Type.Union([
  Type.Object({ kind: Type.Literal("fresh-worktree") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("existing-workspace") }, { additionalProperties: false }),
]);
export type NewSessionDestination = Static<typeof NewSessionDestinationSchema>;

export const WorktreeLifecycleStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("active") }),
  Type.Object({ kind: Type.Literal("landed"), sha: text, at: text }),
  Type.Object({ kind: Type.Literal("discarded"), at: text }),
]);
export type WorktreeLifecycleState = Static<typeof WorktreeLifecycleStateSchema>;

export const WorktreeSetupSchema = Type.Object({
  phase: Type.Union([Type.Literal("creating"), Type.Literal("hook"), Type.Literal("starting"), Type.Literal("done"), Type.Literal("failed")]),
  log: Type.String(),
  exitCode: Type.Optional(Type.Integer()),
  error: Type.Optional(Type.String()),
});

const savedSession = Type.Object({
  id: text, cwd: text, path: Type.String(), created: text, modified: text,
  messageCount: Type.Integer({ minimum: 0 }), firstMessage: Type.String(),
  name: Type.Optional(text), parentSessionPath: Type.Optional(text), agentSpawned: Type.Optional(Type.Boolean()),
});
const savedTranscript = Type.Object({ id: text, cwd: text, transcriptPath: text, session: savedSession });
export const WorktreeCleanupSchema = Type.Union([
  Type.Object({ kind: Type.Literal("pending") }),
  Type.Object({ kind: Type.Literal("done") }),
  Type.Object({ kind: Type.Literal("failed"), error: text }),
]);
const archiveCleanup = Type.Union([
  Type.Object({ kind: Type.Literal("removed"), cleanup: WorktreeCleanupSchema }),
  Type.Object({ kind: Type.Literal("retained"), reason: text }),
]);
export const SessionWorktreeRecordSchema = Type.Object({
  id: Type.String({ pattern: "^[a-zA-Z0-9-]+$" }),
  repo: text,
  path: text,
  branch: text,
  defaultBranch: text,
  /** Immutable parent HEAD for child allocations; ordinary sessions use the default branch. */
  sourceCommit: Type.Optional(text),
  /** A Durable conversation has no project/session catalog entry of its own. */
  childOwner: Type.Optional(Type.Object({ id: text, cwd: text })),
  sessionId: Type.Optional(text),
  /** A secondary checkout used by the same chat, not a new session. */
  relatedSession: Type.Optional(RelatedSessionSchema),
  ownerSession: Type.Optional(savedSession),
  startupToken: Type.Optional(text),
  renamed: Type.Boolean(),
  pendingRename: Type.Optional(Type.Object({ from: text, to: text })),
  setup: WorktreeSetupSchema,
  state: WorktreeLifecycleStateSchema,
  discardConfirmationToken: Type.Optional(text),
  discardedBranchTip: Type.Optional(text),
  operation: Type.Optional(Type.Union([Type.Literal("land"), Type.Literal("discard"), Type.Literal("archive")])),
  archiveCleanup: Type.Optional(archiveCleanup),
  cleanup: WorktreeCleanupSchema,
  transcripts: Type.Array(savedTranscript),
  createdAt: text,
  updatedAt: text,
});
export type SessionWorktreeRecord = Static<typeof SessionWorktreeRecordSchema>;
export type WorktreeSetup = Static<typeof WorktreeSetupSchema>;

export interface SessionWorktreeInfo {
  id: string;
  owned: boolean;
  relatedSession?: RelatedSession;
  repo: string;
  path: string;
  branch: string;
  defaultBranch: string;
  state: WorktreeLifecycleState;
  setup: WorktreeSetup;
  cleanup: SessionWorktreeRecord["cleanup"];
  ahead?: number;
  behind?: number;
  dirtyFiles?: number;
  /** The files no longer exist or git status could not be read. Never interpreted as clean. */
  statusError?: string;
  archiveCleanup?: SessionWorktreeRecord["archiveCleanup"];
}

export interface WorktreeSessionEvent {
  type: "session.worktree";
  worktree: SessionWorktreeRecord;
}

export const WorktreeDiscardPreviewSchema = Type.Object({
  worktreeId: text,
  branch: text,
  defaultBranch: text,
  commits: Type.Array(Type.Object({ sha: text, subject: Type.String() })),
  dirtyFiles: Type.Array(text),
  confirmationToken: text,
});
export type WorktreeDiscardPreview = Static<typeof WorktreeDiscardPreviewSchema>;

export const WorktreeActionResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal("landed"), sha: text, cleanup: SessionWorktreeRecordSchema.properties.cleanup }),
  Type.Object({ kind: Type.Literal("discarded"), cleanup: SessionWorktreeRecordSchema.properties.cleanup }),
  Type.Object({ kind: Type.Literal("conflict"), files: Type.Array(text), defaultBranch: text, prompt: text }),
  Type.Object({ kind: Type.Literal("blocked"), reason: text, files: Type.Array(text) }),
  Type.Object({ kind: Type.Literal("stale-preview") }),
]);
export type WorktreeActionResult = Static<typeof WorktreeActionResultSchema>;

export const ChildWorktreeSummarySchema = Type.Object({
  path: text, branch: text,
  state: Type.Union([Type.Literal("active"), Type.Literal("landed"), Type.Literal("discarded")]),
  ahead: Type.Integer({ minimum: 0 }), dirty: Type.Boolean(),
});
export type ChildWorktreeSummary = Static<typeof ChildWorktreeSummarySchema>;
export type WorktreeArchiveCleanupResult =
  | { kind: "removed"; cleanup: SessionWorktreeRecord["cleanup"] }
  | { kind: "retained"; reason: string };

export const UserSessionStartSchema = Type.Object({
  cwd: text,
  startupToken: Type.Optional(text),
  modelSpec: Type.Optional(text),
  thinkingLevel: Type.Optional(text),
  destination: Type.Optional(NewSessionDestinationSchema),
  /** Retry an unowned failed setup instead of allocating another worktree. */
  setupId: Type.Optional(text),
}, { additionalProperties: false });
export type UserSessionStart = Static<typeof UserSessionStartSchema>;
