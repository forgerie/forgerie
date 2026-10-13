import type { TriggersChangedEvent } from "./triggers.js";
import type { AzureDevopsGlobalConfig } from "./azureDevopsConfig.js";
export type { PromptRequestOptions } from "./promptRequest.js";
import type { SessionResponse } from "./sessionResponse.js";
import type { PullLink } from "./pullRequests.js";
import type { SessionWorktreeInfo, WorktreeSessionEvent } from "./sessionWorktree.js";
import type { WorkspaceServicesEvent } from "./workspaceServices.js";

/** Public wire types; their runtime schemas live in backlog.ts. */
export type { BacklogConfig, BacklogMetadata, BacklogProviderId, BacklogClaim, BacklogItem, BacklogWarning, BacklogListResponse, BacklogDetailResponse, BacklogLaunchRequest, BacklogLaunchResponse, BacklogReleaseRequest, BacklogReleaseResponse, BacklogErrorResponse } from "./backlog.js";

/** Registry of features that require rolling-version compatibility gates. */
export const PI_WEB_CAPABILITIES = {
  queuedCompaction: "session.queue.compact",
  promptRequestIds: "session.prompt.requestIds",
} as const;

export type PiWebCapability = typeof PI_WEB_CAPABILITIES[keyof typeof PI_WEB_CAPABILITIES];
export type PiWebPluginSettings = Record<string, unknown>;
export type PiWebPluginConfigMap = Record<string, PiWebPluginConfig>;

export interface PiWebPluginConfig {
  enabled?: boolean;
  settings?: PiWebPluginSettings;
  [key: string]: unknown;
}

export interface PiWebPathAccessConfig {
  allowedPaths?: string[];
}

export interface PiWebUploadsConfig {
  defaultFolder?: string;
}

export interface PiWebAgentConfig {
  /** Pi-compatible companion CLI used for diagnostics and safe package-managed updates. */
  command?: string;
  /** Pi-compatible profile directory containing auth.json, models.json, settings.json, and sessions/. */
  dir?: string;
}

export interface PiWebConfigValues {
  /** Azure CLI executable for the daemon's server-only credential source. */
  azureDevops?: AzureDevopsGlobalConfig;
  host?: string;
  port?: number;
  plugins?: PiWebPluginConfigMap;
  /** External filesystem roots Forgerie may expose outside a workspace. */
  pathAccess?: PiWebPathAccessConfig;
  /** Workspace-relative defaults for manual file uploads. */
  uploads?: PiWebUploadsConfig;
  /** Maximum accepted HTTP request body size in bytes (uploads/attachments). */
  maxUploadBytes?: number;
  /** When true, LLMs can start new sessions via the spawn_session tool. */
  spawnSessions?: boolean;
  /**
   * When true, LLMs can post a question set to the browser via the ask_user
   * tool. On by default; set to `false` to remove the tool from the runtime.
   */
  askUser?: boolean;
  /**
   * When true, hosted sessions start with Pi's `codemode` tool active: an
   * agent can run one JavaScript script that calls the other tools. On by
   * default; set to `false` to keep the tool inactive.
   */
  codemode?: boolean;
  /**
   * When true, hosted sessions get the `child_agent` tool: background child
   * agents that run inside the session's own Durable storage, which the user
   * can open, steer, stop, and answer. Off by default while it is new.
   */
  durableChildren?: boolean;
  /** Session tool names that Durable children must not share. Defaults to []. */
  childToolsDeny?: string[];
  /**
   * How long an extension dialog may wait for an answer before the daemon
   * auto-cancels it, in milliseconds. Applies only when the extension set no
   * `timeout` of its own (the sooner of the two wins); `0` waits forever.
   * Tuning knob only — extension dialogs are always enabled.
   */
  extensionDialogsTimeoutMs?: number;
  /**
   * `provider/model-id` of the model that writes session titles, for example a
   * small fast model. Omit to use each session's own model. If the model is
   * not available with credentials, the session's own model is used.
   */
  sessionTitleModel?: string;
  /** Desired Pi-compatible agent profile and companion CLI (Pi by default). */
  agent?: PiWebAgentConfig;
}

export type PiPackageScope = "user" | "project";

export interface PiPackageInfo {
  source: string;
  scope: PiPackageScope;
  filtered: boolean;
  installedPath?: string;
}

export interface PiPackagesResponse {
  packages: PiPackageInfo[];
}

export type PiPackageMutationAction = "install" | "remove" | "update";

export interface PiPackageMutationResponse extends PiPackagesResponse {
  action: PiPackageMutationAction;
  source?: string;
  scope?: PiPackageScope;
  removed?: boolean;
}

export type PiWebAgentDirEnvSource = "pi-web" | "pi-compatibility";

export interface PiWebConfigEnvOverrides {
  host: boolean;
  port: boolean;
  spawnSessions: boolean;
  askUser: boolean;
  codemode: boolean;
  agentCommand: boolean;
  agentDir: boolean;
  /** The configured directory environment source, even when Pi compatibility is inactive for the desired command. */
  agentDirSource?: PiWebAgentDirEnvSource;
  agentSessionDir: boolean;
}

export interface PiWebConfigResponse {
  path: string;
  exists: boolean;
  config: PiWebConfigValues;
  effectiveConfig: PiWebConfigValues;
  envOverrides: PiWebConfigEnvOverrides;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface WorkspaceEffectiveConfig {
  uploads?: PiWebUploadsConfig;
}

export interface Workspace {
  id: string;
  projectId: string;
  path: string;
  label: string;
  branch?: string;
  isMain: boolean;
  isGitRepo: boolean;
  isGitWorktree: boolean;
  /** Workspace-effective project/global settings needed by workspace UI features. Always present on current server workspace responses. */
  effectiveConfig: WorkspaceEffectiveConfig;
}

export interface SessionRef {
  id: string;
  cwd: string;
}

/** Sessions that may hold tab records at once; the store evicts the stalest beyond this. */
export const SESSION_TABS_SESSION_LIMIT = 200;
/** Tabs one session may promote. */
export const SESSION_TABS_PER_SESSION_LIMIT = 12;
export const SESSION_TABS_TOOL_ID_MAX_LENGTH = 200;

export const SESSION_UNREAD_LIMIT = 1_000;
export const SESSION_UNREAD_SESSION_ID_MAX_LENGTH = 512;
export const SESSION_UNREAD_CWD_MAX_LENGTH = 32 * 1024;
export const SESSION_UNREAD_CATALOG_ID_MAX_LENGTH = 512;
export const SESSION_UNREAD_COMPLETED_AT_MAX_LENGTH = 64;

export interface SessionUnreadSummary {
  sessionId: string;
  cwd: string;
  /** Monotonic within a catalog and never greater than its containing revision. */
  completionOrder: number;
  completedAt: string;
}

export interface SessionUnreadCatalogSnapshot {
  /** Stable for one persisted catalog epoch; changes when unread state is reset. */
  catalogId: string;
  /** Monotonic catalog mutation revision; at least every contained completion order. */
  catalogRevision: number;
  /** Bounded by `SESSION_UNREAD_LIMIT` and ordered newest completion first. */
  sessions: SessionUnreadSummary[];
}

export interface SessionUnreadAcknowledgeRequest {
  cwd: string;
  /** The catalog epoch in which `throughCompletionOrder` was observed. */
  catalogId: string;
  throughCompletionOrder: number;
}

/** Authoritative delta for one session in the daemon-owned unread catalog. */
export interface SessionUnreadEvent {
  type: "sessions.unread";
  catalogId: string;
  /** At least `unread.completionOrder` when carrying an unread summary. */
  catalogRevision: number;
  sessionId: string;
  cwd: string;
  unread: SessionUnreadSummary | null;
}

export const SESSION_NOTIFICATION_LIMIT = 100;
export const SESSION_NOTIFICATION_MESSAGE_BYTES = 8 * 1024;

export type SessionNotificationSeverity = "info" | "warning" | "error";

export interface SessionNotification {
  id: string;
  message: string;
  truncated: boolean;
  severity: SessionNotificationSeverity;
  receivedAt: string;
  order: number;
}

export interface SessionNotificationSummary {
  sessionId: string;
  cwd: string;
  inboxRevision: number;
  retainedCount: number;
  discardedCount: number;
  highestSeverity?: SessionNotificationSeverity;
}

export interface SessionNotificationDismissThrough {
  order: number;
  overflowWatermark: number;
}

export interface SessionNotificationInboxSnapshot {
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
  notifications: SessionNotification[];
  dismissThrough: SessionNotificationDismissThrough;
}

export interface SessionNotificationCatalogSnapshot {
  daemonInstanceId: string;
  catalogRevision: number;
  sessions: SessionNotificationSummary[];
}

export interface SessionNotificationDismissRequest {
  cwd: string;
  daemonInstanceId: string;
  notificationId: string;
}

export interface SessionNotificationDismissAllRequest {
  cwd: string;
  daemonInstanceId: string;
  throughOrder: number;
  throughOverflowWatermark: number;
}

export type SessionNotificationClearReason =
  | "runtime-close"
  | "archive"
  | "delete"
  | "restore"
  | "archive-reconcile"
  | "replacement"
  | "initialization-failed"
  | "service-dispose";

export type SessionNotificationInboxDelta =
  | { kind: "added"; notification: SessionNotification; evictedNotificationId?: string }
  | { kind: "dismissed"; notificationIds: string[] }
  | { kind: "cleared"; reason: SessionNotificationClearReason }
  | { kind: "resync" };

export interface SessionNotificationInboxEvent {
  type: "notifications.inbox";
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
  dismissThrough: SessionNotificationDismissThrough;
  delta: SessionNotificationInboxDelta;
}

export interface SessionNotificationSummaryEvent {
  type: "notifications.summary";
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
}

export interface SessionInfo extends SessionRef {
  /** An opt-in PR watch remains Working while the agent is idle. */
  watchingPullRequest?: boolean;
  /** Present for a session-owned worktree or a saved session in a completed worktree. */
  worktree?: SessionWorktreeInfo;
  path: string;
  /** True when the server has verified a backing session file exists; false when known transient. */
  persisted?: boolean;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  response?: SessionResponse;
  pendingAsk?: PendingAskUser;
  parentSessionPath?: string;
  /**
   * True when a tool reported spawning this session -- an agent-to-agent
   * conversation rather than one the user is in. Recorded in the session file
   * itself when the spawn is witnessed, because nothing about a spawned
   * session's contents distinguishes it from one the user continued.
   */
  agentSpawned?: boolean;
  /**
   * Working directory of the parent session, read from the parent session file
   * header. Only populated when the parent is outside this listing's cwd, so a
   * child whose parent lives in another worktree can point at it instead of
   * only reporting that the parent is unavailable here.
   */
  parentSessionCwd?: string;
  /** Session id of an out-of-cwd parent, so the browser can select it after switching workspace. */
  parentSessionId?: string;
  /**
   * Number of sessions in other workspaces of the same project that record this
   * session as their parent. Only set when non-zero, so a parent can show that
   * it has children which are not nested beneath it in this workspace.
   */
  childSessionsElsewhere?: number;
  archived?: boolean;
  archivedAt?: string;
  /**
   * True when the user pinned this session. Pinned sessions sort to the top
   * of their grouped list and are refused by every archive path until
   * unpinned. Server-owned so the flag roams across browsers.
   */
  pinned?: boolean;
  /**
   * Workspace tools promoted to this session's tab band, in band order.
   * Server-owned so the set roams across browsers; absent when the session
   * has no promoted tabs. Bounded by `SESSION_TABS_PER_SESSION_LIMIT`.
   */
  tabs?: string[];
}

export interface MachineSessionListingSnapshot {
  /** Full machine inventory, including archived sessions. */
  sessions: SessionInfo[];
  /** Statuses for runtimes that were already live when this snapshot was taken. */
  statuses: SessionStatus[];
  /** Last activities for runtimes that were already live when this snapshot was taken. */
  activities: SessionActivity[];
}

export interface ArchiveSessionsResponse {
  archived: true;
  sessionIds?: string[];
  archivedCount?: number;
  skippedAlreadyArchivedCount?: number;
  /** Pinned descendants left out of an archive-tree operation. */
  skippedPinnedCount?: number;
}

export interface SessionBulkMutationRef {
  id: string;
  cwd: string;
}

export interface SessionBulkMutationRequest {
  sessions: SessionBulkMutationRef[];
}

export interface SessionBulkFailure {
  sessionId: string;
  error: string;
}

export interface SessionBulkArchiveResponse {
  archived: true;
  archivedSessionIds: string[];
  failures: SessionBulkFailure[];
  generatedAt: string;
}

export interface SessionBulkDeleteArchivedResponse {
  deleted: true;
  deletedSessionIds: string[];
  failures: SessionBulkFailure[];
  generatedAt: string;
}

export interface SessionCleanupRequest {
  /** Archive non-archived sessions whose modified time is older than this many days. Omit/null to disable. */
  archiveIdleDays?: number | null;
  /** Permanently delete archived sessions whose archivedAt time is older than this many days. Omit/null to disable. */
  deleteArchivedDays?: number | null;
  /** Stored cwd paths selected from a preview. Omit/null to include all discovered project/workspace paths. */
  projectCwds?: string[] | null;
}

export interface SessionCleanupThresholds {
  archiveIdleDays?: number;
  deleteArchivedDays?: number;
}

export interface SessionCleanupProjectSummary {
  cwd: string;
  archiveCount: number;
  deleteCount: number;
}

export interface SessionCleanupTotals {
  archiveCount: number;
  deleteCount: number;
}

export interface SessionCleanupPreviewResponse {
  generatedAt: string;
  thresholds: SessionCleanupThresholds;
  projects: SessionCleanupProjectSummary[];
  totals: SessionCleanupTotals;
  skippedBusySessionIds?: string[];
}

export interface SessionCleanupExecuteResponse extends SessionCleanupPreviewResponse {
  archivedSessionIds: string[];
  deletedSessionIds: string[];
}

export interface SessionActivity {
  sessionId: string;
  phase: "active" | "idle" | "error";
  label: string;
  detail?: string;
  /** When the current continuous stretch of Working state began. */
  activeSince?: string;
  /** When this specific activity update was published. */
  at: string;
  /**
   * Set only on the startup window's own reports. A startup phase is genuinely
   * in progress, so it is published as `active` and rendered like any other
   * activity, but *starting* a session is not *working* in it: there is nothing
   * to stop, nothing that blocks reloading from disk, and no workspace-level
   * work to report. `isSessionActive()` reads this to keep the two apart.
   */
  startup?: boolean;
}

export interface QueuedSessionMessage {
  kind: "steer" | "followUp";
  text: string;
}

export type DoubleEscapeAction = "fork" | "tree" | "none";

export interface SessionAbortResult {
  aborted: true;
  /** Queued session work restored to the draft in delivery order. */
  restoredMessages: QueuedSessionMessage[];
}

/**
 * `customType` of the follow-up custom message that carries a closed ask back to
 * the model and into the transcript. Its `details` are an {@link AskUserOutcome}.
 */
export const ASK_USER_ANSWERS_CUSTOM_TYPE = "pi-web.ask.answers";

/** Largest question set one `ask_user` call may post. */
export const ASK_USER_QUESTION_LIMIT = 20;
/** Largest option list one question may offer. */
export const ASK_USER_OPTION_LIMIT = 12;
/** Length bound for ids: the ask id, question ids, and option values. */
export const ASK_USER_ID_MAX_LENGTH = 128;
/** Length bound for model-authored prose: questions, details, and option labels. */
export const ASK_USER_TEXT_MAX_LENGTH = 1_000;
/** Length bound for the free text a user types as a custom answer. */
export const ASK_USER_OTHER_TEXT_MAX_LENGTH = 4_000;

/** One selectable option of an {@link AskUserQuestion}. */
export interface AskUserQuestionOption {
  /** Stable machine value reported back to the model. */
  value: string;
  /** Short human label rendered in the browser. */
  label: string;
  /** Optional clarifying line rendered under the label. */
  detail?: string;
}

/**
 * One question of an `ask_user` set. Questions are never required: the user may
 * submit while leaving any of them untouched, and unanswered questions are
 * reported to the model as such.
 */
export interface AskUserQuestion {
  /** Unique within the ask; used as the answer key. */
  id: string;
  /** The question itself, as one plain-text line. */
  question: string;
  /** Optional supporting context rendered under the question. */
  detail?: string;
  /** Offered options; may be empty when only free text makes sense. */
  options: AskUserQuestionOption[];
  /** When true, several options may be selected at once. */
  multiple?: boolean;
}

/**
 * The open, unanswered question set of a session. Derived from the active transcript branch and reported in
 * {@link SessionStatus}, so a reconnecting or reloading browser rehydrates it
 * without depending on having seen the `ask.opened` event.
 */
export interface PendingAskUser {
  askId: string;
  askedAt: string;
  questions: AskUserQuestion[];
}

/**
 * Why an ask stopped being the session's open ask.
 *
 * `cancelled` and `answered-in-chat` both leave every question unanswered, but
 * they are different events and must stay separate cases: `cancelled` is the
 * user dismissing the form, while `answered-in-chat` is the user replying in
 * the composer instead. Collapsing them made models report a dismissal the user
 * never performed.
 */
export type AskUserCloseReason = "submitted" | "superseded" | "cancelled" | "answered-in-chat";

/**
 * What the user replied to one question. Absent from a submission means the
 * question was left untouched; an empty `values` with no `otherText` means the
 * same thing.
 */
export interface AskUserAnswer {
  /** Matches an {@link AskUserQuestion.id} of the open ask. */
  id: string;
  /** Selected {@link AskUserQuestionOption.value} entries; several only when the question allows it. */
  values: string[];
  /** Free text typed as the question's custom answer. */
  otherText?: string;
}

/** One submit of the open ask: answers for some or all of its questions. */
export interface AskUserSubmission {
  answers: AskUserAnswer[];
}

/**
 * One question of a closed ask paired with what came back for it. Carries the
 * question itself so the record renders without the original ask still existing.
 */
export interface AskUserQuestionRecord {
  question: AskUserQuestion;
  /** True when at least one option was selected or custom text was given. */
  answered: boolean;
  values: string[];
  otherText?: string;
}

/**
 * The complete result of an ask, computed when it closes. Shared by the
 * model-facing follow-up message and the browser's read-only record, so both
 * report the same answered and unanswered questions.
 */
export interface AskUserOutcome {
  askId: string;
  reason: AskUserCloseReason;
  askedAt: string;
  closedAt: string;
  questions: AskUserQuestionRecord[];
  answeredCount: number;
  /** Ids of the questions left unanswered, in the order they were asked. */
  unansweredIds: string[];
  /** One line, for example `Answered 3 of 5; unanswered: q2, q5`. */
  summary: string;
}

/**
 * Result of the browser closing an ask by submitting or cancelling it.
 *
 * `"stale"` is an ordinary race rather than an error: the named ask was already
 * submitted, superseded by a newer one, or gone with its session runtime. The
 * browser drops its card and trusts `sessionStatus`, which is returned in both
 * cases so closing an ask needs no follow-up status request.
 */
export interface AskUserCloseResponse {
  result: "closed" | "stale";
  /** Present only when this call is the one that closed the ask. */
  outcome?: AskUserOutcome;
  sessionStatus: SessionStatus;
}

/** Length bound for extension-dialog ids. */
export const EXTENSION_DIALOG_ID_MAX_LENGTH = 128;
/** Length bound for extension-authored dialog prose: titles, messages, options, placeholders. */
export const EXTENSION_DIALOG_TEXT_MAX_LENGTH = 1_000;
/** Largest option list one `select` dialog may offer. */
export const EXTENSION_DIALOG_OPTION_LIMIT = 24;
/** Length bound for the text a user types into an `input` dialog. */
export const EXTENSION_DIALOG_INPUT_MAX_LENGTH = 4_000;

/** Which extension UI dialog primitive a pending dialog belongs to. */
export type ExtensionDialogKind = "confirm" | "select" | "input";

/**
 * The value a user gave in an extension dialog: a boolean for `confirm`, the
 * chosen option for `select`, the typed text for `input`. Absent when the
 * dialog closed without an answer.
 */
export type ExtensionDialogAnswer = boolean | string;

/**
 * Why a dialog stopped being open. `"answered"` carries an
 * {@link ExtensionDialogAnswer}; every other reason is a close without one.
 */
export type ExtensionDialogCloseReason = "answered" | "cancelled" | "timeout" | "aborted" | "session-ended";

/**
 * One open extension dialog of a session, opened by `ctx.ui.confirm()`,
 * `ctx.ui.select()`, or `ctx.ui.input()`. Daemon-owned and reported in
 * {@link SessionStatus.pendingDialogs}, so a reconnecting or reloading browser
 * rehydrates it without depending on having seen the `dialog.opened` event.
 *
 * Unlike asks, several dialogs may be open per session at once: each dialog is
 * an independent blocking wait inside extension code, so opening never
 * supersedes an existing one.
 */
export interface PendingExtensionDialog {
  dialogId: string;
  kind: ExtensionDialogKind;
  title: string;
  /** Supporting line of a `confirm` dialog. */
  message?: string;
  /** Offered choices of a `select` dialog. */
  options?: string[];
  /** Placeholder text of an `input` dialog. */
  placeholder?: string;
  askedAt: string;
  /**
   * When the dialog auto-cancels, as ISO: the sooner of the extension's own
   * `timeout` and the daemon's `extensionDialogsTimeoutMs` default. Absent
   * when the dialog waits forever.
   */
  timeoutAt?: string;
  /** Opened while a run was in flight, so `agent_end` settles it as `"aborted"`. */
  runScoped: boolean;
}

/**
 * The complete result of a closed extension dialog. Unlike an ask outcome it
 * stays small — the dialog itself is not embedded, because a settled card is a
 * browser-local record that stays until the user dismisses it; reloads
 * rehydrate open dialogs from {@link SessionStatus.pendingDialogs} alone.
 */
export interface ExtensionDialogOutcome {
  dialogId: string;
  reason: ExtensionDialogCloseReason;
  /** Present only when `reason` is `"answered"`. */
  answer?: ExtensionDialogAnswer;
  askedAt: string;
  closedAt: string;
}

/**
 * Browser request to answer an open extension dialog with the user's value.
 * `cwd` rides along as the standard session-lookup field, as on every other
 * session route; whether the value fits the dialog's kind is the store's call,
 * so an ill-fitting answer is a 400 that leaves the dialog open.
 */
export interface ExtensionDialogAnswerRequest {
  cwd?: string;
  dialogId: string;
  value: ExtensionDialogAnswer;
}

/** Browser request to dismiss an open extension dialog without an answer. */
export interface ExtensionDialogCancelRequest {
  cwd?: string;
  dialogId: string;
}

/**
 * Result of the browser answering or cancelling an extension dialog. Mirrors
 * {@link AskUserCloseResponse}: `"stale"` is an ordinary lost race — another
 * browser, a timeout, or a teardown closed the dialog first — not an error.
 * The browser drops its card and trusts `sessionStatus`, which is returned in
 * both cases so closing a dialog needs no follow-up status request.
 */
export interface ExtensionDialogCloseResponse {
  result: "closed" | "stale";
  /** Present only when this call is the one that closed the dialog. */
  outcome?: ExtensionDialogOutcome;
  sessionStatus: SessionStatus;
}

/**
 * Progress of the session startup window, where the daemon is still
 * constructing the agent session and no `PiAgentSession` exists yet, so
 * `activity.update` cannot be published for it.
 *
 * `startupToken` is the opaque label a create request supplied, echoed back so a
 * browser row still waiting for a session id recognises its own construction.
 * The daemon never interprets it and it never becomes the session id:
 * `activity.sessionId` always carries the real id, which is how an *open* of a
 * session the browser already knows is routed instead.
 *
 * `activity.phase === "idle"` means the startup window ended with nothing left
 * to report, so a browser that substituted its own text should restore it.
 */
export interface SessionStartupProgressEvent {
  type: "session.startup";
  startupToken?: string;
  activity: SessionActivity;
}

/**
 * A pi-native image attachment carried with a prompt. The wire format mirrors
 * pi's own `ImageContent` shape (`{ type: "image", data, mimeType }`) so these
 * attachments are compatible with native multimodal delivery after validation.
 */
export interface PromptImageAttachment {
  kind: "image";
  /** Supported image MIME type (image/png, image/jpeg, image/gif, or image/webp). */
  mimeType: string;
  /** Base64-encoded binary payload (no data: URL prefix). */
  data: string;
  /** Optional original filename, used for previews and folder-mode filenames. */
  name?: string;
}

/** A general file attachment that must be saved into the workspace before use. */
export interface PromptFileAttachment {
  kind: "file";
  /** Non-empty IANA MIME type (for example "application/pdf"). */
  mimeType: string;
  /** Base64-encoded binary payload (no data: URL prefix). Empty for zero-byte files. */
  data: string;
  /** Optional original filename, used for previews and folder-mode filenames. */
  name?: string;
}

export type PromptAttachment = PromptImageAttachment | PromptFileAttachment;

export interface SavedPromptAttachment {
  /** Workspace-relative path the attachment was written to. */
  path: string;
  mimeType: string;
  size: number;
}

export interface SessionModel {
  provider?: string;
  id?: string;
  name?: string;
  contextWindow?: number;
  reasoning?: unknown;
  /**
   * Set only on the models Pi's `enabledModels` scope holds. Model cycling
   * moves through exactly this set, so the picker can name it rather than
   * leaving it to look like the first few rows of the catalogue.
   */
  scoped?: boolean;
}

// Domain type is owned by pi and re-exported from the shared thinking-levels
// module. Wire/data fields below intentionally use `string` so an unknown level
// from a newer pi runtime parses and renders gracefully instead of failing.
export type { ThinkingLevel } from "./thinkingLevels.js";

export interface ModelSelectionResponse {
  models: SessionModel[];
}

/** Pi's effective choices for a session that will start in one destination. */
export interface NewSessionModelSelectionResponse extends ModelSelectionResponse {
  model?: SessionModel;
  thinkingLevel: string;
}

export type SessionWarningSeverity = "info" | "warning" | "error";

/**
 * A live, runtime-scoped warning surfaced to the browser (skill/resource
 * diagnostics, extension load errors, subscription-auth billing notice, etc.).
 *
 * Warnings are recomputed whenever the runtime is (re)built inside sessiond and
 * are not persisted chat messages. `source` is an optional short origin label
 * (e.g. `"skill"`, `"extension"`, `"anthropic"`); `path` carries a related file
 * path when the warning came from a resource diagnostic.
 *
 * `dismiss` is present only when the warning has a durable, first-class
 * off-switch in the underlying `pi` agent (not a UI-only hide). Its `id` is the
 * opaque token the server maps back to that suppression; the client renders a
 * dismiss control for any warning carrying it, without knowing what it means.
 */
export interface SessionWarning {
  severity: SessionWarningSeverity;
  message: string;
  source?: string;
  path?: string;
  dismiss?: { id: string };
}

export interface SessionAskCatalogEntry extends SessionRef {
  pendingAsk?: PendingAskUser;
  response?: SessionResponse;
  pendingDialogs?: PendingExtensionDialog[];
}

/**
 * Daemon-lifetime catalog of sessions blocked on user input.
 *
 * A sessiond restart clears the underlying in-memory asks and dialogs. Clients
 * reconcile that reset by replacing their catalog from a fresh snapshot.
 */
export interface SessionAskCatalogSnapshot {
  sessions: SessionAskCatalogEntry[];
}

export interface SessionStatus {
  sessionId: string;
  watchingPullRequest?: boolean;
  /** Completed worktrees return an inert status without starting Pi in a removed cwd. */
  readOnly?: boolean;
  worktree?: SessionWorktreeInfo;
  /** True when the server has verified a backing session file exists; false when known transient. */
  persisted?: boolean;
  model?: SessionModel;
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  /** Delegated agents this session has working now; omitted when none. */
  workingAgents?: number;
  /** Managed processes this session has running now; omitted when none. */
  runningProcesses?: number;
  /** Child agent questions and workflow stops that wait for the user; omitted when none. */
  waitingOnYou?: number;
  /** Flagged standing decisions; non-blocking and omitted when none. */
  flaggedDecisions?: number;
  pendingMessageCount: number;
  queuedMessages: QueuedSessionMessage[];
  /** Pi's configured action for two Escape presses with an empty idle editor. */
  doubleEscapeAction?: DoubleEscapeAction;
  messageCount?: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  /**
   * Live, runtime-scoped warnings for this session (skill/resource diagnostics,
   * extension load errors, Anthropic subscription-auth billing notice, etc.).
   * Recomputed on each status read from the current runtime; absent/empty when
   * there are none. See {@link SessionWarning}.
   */
  warnings?: SessionWarning[];
  /**
   * The session's open `ask_user` question set, when one is waiting for the
   * user. Daemon-owned, so it survives browser reload and web/API restarts.
   */
  pendingAsk?: PendingAskUser;
  response?: SessionResponse;
  /**
   * The session's open extension dialogs, oldest first, when any are waiting
   * for the user. Daemon-owned, so they survive browser reload and web/API
   * restarts. Several may be open at once; the UI presents them as a queue.
   */
  pendingDialogs?: PendingExtensionDialog[];
}

export interface WorkspaceActivity {
  cwd: string;
  hasSessionActivity: boolean;
  hasTerminalActivity: boolean;
  updatedAt: string;
}

export interface WorkspaceActivityResponse {
  workspaces: WorkspaceActivity[];
  generatedAt: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
}

export type { PromptResourceCatalogResponse, PromptResourceCommandDescriptor, PromptResourceCommandIdentity } from "./promptResourceCommand.js";

export interface FileSuggestion {
  path: string;
  kind: "tracked" | "untracked" | "other";
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  modifiedAt?: string;
}

export interface FileTreeResponse {
  path: string;
  entries: FileTreeEntry[];
  scannedAt: string;
  truncated: boolean;
}

export type FileContentMediaType = "image";

export interface FileContentResponse {
  path: string;
  language?: string;
  mediaType?: FileContentMediaType;
  mimeType?: string;
  encoding: "utf8";
  size: number;
  modifiedAt: string;
  content: string;
  truncated: boolean;
  binary: boolean;
  /**
   * The file's bytes as a SHA-256 hex digest. Present only when `content` is
   * the whole file as exact UTF-8 text, so a client can edit it and write it
   * back with `expectedVersion`.
   */
  version?: string;
}

export interface WriteWorkspaceFileOptions {
  createDirs?: boolean;     // default: true — mkdir -p equivalent
  overwrite?: boolean;      // default: true — throw if false and file exists
  /** Write only if the file on disk still has this `version`; otherwise the write fails with a conflict. */
  expectedVersion?: string;
}

export interface WriteWorkspaceFileResponse {
  path: string;
  size: number;
  modifiedAt: string;
  created: boolean;  // true if file was created, false if overwritten
  /** The written bytes' `version`. */
  version: string;
}

/** The body of a 409 from a file write whose `expectedVersion` no longer matches the disk. */
export interface WorkspaceFileConflictResponse {
  error: string;
  code: "conflict";
  /** The file's version on disk now, or absent when the file is gone. */
  version?: string;
}

export interface DeleteWorkspaceFileResponse {
  path: string;
  existed: boolean;  // true if file existed and was deleted, false if file did not exist
}

export interface MoveWorkspaceFileOptions {
  createDirs?: boolean;   // default: true — mkdir -p equivalent for target parent directory
  overwrite?: boolean;    // default: false — throw if target exists (safer default than writeFile)
}

export interface MoveWorkspaceFileResponse {
  fromPath: string;
  toPath: string;
  size: number;
  modifiedAt: string;
}

export type GitFileState = "unmodified" | "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";

export interface GitStatusFile {
  path: string;
  oldPath?: string;
  index: GitFileState;
  workingTree: GitFileState;
  // Set only on a submodule commit-pointer entry (path equals the submodule's
  // superproject-relative path). Short SHAs of the recorded and current commit.
  submoduleFromCommit?: string;
  submoduleToCommit?: string;
}

export interface GitStatusResponse {
  isGitRepo: boolean;
  hash: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  files: GitStatusFile[];
  // Superproject-relative paths of submodules that carry a change. Files inside
  // a submodule appear in `files` under `<submodule>/<inner path>`; the client
  // uses this list to group and label them and to distinguish a submodule root
  // from an ordinary directory with the same name.
  submodules: string[];
}

export interface GitDiffResponse {
  path?: string;
  staged: boolean;
  hash: string;
  diff: string;
  truncated: boolean;
}

export type PiWebServiceComponent = "web" | "sessiond";

export interface PiWebComponentStatus {
  component: PiWebServiceComponent;
  label: string;
  runtimeVersion?: string;
  installedVersion?: string;
  stale: boolean;
  available: boolean;
  error?: string;
}

/** Secret-free identity of the Pi-compatible CLI/state profile fixed for one sessiond lifetime. */
export interface ActiveAgentProfileDescriptor {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly command: string;
  readonly dir: string;
  readonly sessionDirEnvKeys: readonly string[];
}

export interface PiWebRuntimeComponent {
  component: PiWebServiceComponent;
  label: string;
  runtimeVersion?: string;
  available: boolean;
  capabilities: PiWebCapability[];
  /** Present only for a session daemon that supports active-profile reporting. */
  activeAgentProfile?: ActiveAgentProfileDescriptor;
  error?: string;
}

export interface PiWebVersionResponse {
  packageName: string;
  generatedAt: string;
  components: {
    web: PiWebComponentStatus;
    sessiond: PiWebComponentStatus;
  };
}

export interface PiWebRuntimeResponse {
  packageName: string;
  generatedAt: string;
  components: {
    web: PiWebRuntimeComponent;
    sessiond: PiWebRuntimeComponent;
  };
  capabilities: PiWebCapability[];
}

export interface WorkspaceActivityUiEvent {
  type: "workspace.activity";
  activity: WorkspaceActivity;
}

export interface CommandOption {
  value: string;
  label: string;
  description?: string;
}

export type SessionTreeNodeKind =
  | "user"
  | "assistant"
  | "tool-result"
  | "bash"
  | "custom-message"
  | "compaction"
  | "branch-summary"
  | "model-change"
  | "thinking-level-change"
  | "session-info"
  | "label"
  | "custom"
  | "other";

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  kind: SessionTreeNodeKind;
  summary: string;
  timestamp?: string;
  label?: string;
}

export interface SessionTreeSnapshot {
  /** Pre-order, parent-linked projection of all retained roots and descendants. */
  nodes: SessionTreeNode[];
  activeLeafId: string | null;
  /** Root-to-leaf IDs for explicit, non-color-only active-path rendering. */
  activePathIds: string[];
}

/** Read-only session-tree snapshot, including for completed worktree sessions. */
export interface SessionTreeResponse {
  tree: SessionTreeSnapshot;
}

export const SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 10_000;

/**
 * Prefix the tree projection gives an assistant turn that only called tools and
 * produced no prose. Clients filter on it, so server and client share the one
 * literal instead of sniffing each other's wording.
 */
export const SESSION_TREE_TOOL_CALL_SUMMARY_PREFIX = "Tool call: ";

export type SessionTreeSummaryChoice =
  | { mode: "none" }
  | { mode: "default" }
  | { mode: "custom"; instructions: string };

export interface SessionTreeNavigateRequest {
  targetId: string;
  /** Leaf shown when the navigator opened; null is valid for an empty/root position. */
  expectedLeafId: string | null;
  summary: SessionTreeSummaryChoice;
}

export type SessionTreeNavigateResult =
  | { cancelled: false; editorText?: string }
  | { cancelled: true; aborted?: boolean };

export interface SessionTreeForkRequest {
  entryId: string;
  /** Leaf shown when the navigator opened; null is valid for an empty/root position. */
  expectedLeafId: string | null;
}

/**
 * Fork-from-entry creates a new session file up to the selected entry and
 * switches the runtime to it, leaving the original session untouched. User
 * entries fork from "before" so their text returns as a `promptDraft` for the
 * forked session; every other entry forks "at".
 */
export type SessionTreeForkResult =
  | { cancelled: false; session: SessionInfo; promptDraft?: string }
  | { cancelled: true };

export interface MessagePage {
  messages: unknown[];
  start: number;
  total: number;
}

/**
 * Join-time snapshot of a session's in-flight assistant stream. `seq` is the
 * `SessionEventHub` watermark captured together with `partial` in a single tick,
 * so a joining client can seed `partial` and then apply only buffered live events
 * with `seq > snapshot.seq` (exactly-once). `partial` is a browser-projected
 * in-flight `AssistantMessage` (thinking signatures stripped), or `null` when the
 * session is not mid assistant-message stream.
 */
export interface SessionStreamSnapshot {
  seq: number;
  /** Browser-projected in-flight `AssistantMessage`, or `null` when idle. */
  partial: unknown;
}

export type CommandResult =
  | { type: "done"; message?: string; presentation?: "toast"; session?: SessionInfo; promptDraft?: string }
  | { type: "select"; requestId: string; title: string; options: CommandOption[] }
  | { type: "tree"; tree: SessionTreeSnapshot }
  | { type: "unsupported"; message: string };

export type ManagedProcessStatus = "running" | "terminating" | "terminate_timeout" | "exited" | "killed";
export type ManagedProcessEndReason = "exit" | "signal" | "spawn_error" | "missing_pid" | "kill_timeout" | "lost";

export interface ManagedProcessSignal {
  name: string;
  number: number | null;
  description: string;
}

export interface ManagedProcessLogLine {
  type: "stdout" | "stderr";
  text: string;
}

/** Browser-safe pi-processes state; daemon log-file paths stay private. */
export interface ManagedProcessInfo {
  id: string;
  name: string;
  pid: number;
  command: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  status: ManagedProcessStatus;
  exitCode: number | null;
  success: boolean | null;
  endReason: ManagedProcessEndReason | null;
  signal: ManagedProcessSignal | null;
  errorMessage: string | null;
}

export interface ManagedProcessesSnapshot {
  available: boolean;
  writeSupported: boolean;
  processes: ManagedProcessInfo[];
}

export type ManagedProcessOutputResult =
  | { ok: true; lines: ManagedProcessLogLine[] }
  | { ok: false; reason: "unavailable" | "not_found" | "invalid_response" };

export type ManagedProcessKillResult =
  | { ok: true; process: ManagedProcessInfo }
  | { ok: false; reason: "unavailable" | "not_found" | "timeout" | "error"; process?: ManagedProcessInfo };

export type ManagedProcessWriteResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "unsupported" | "not_found" | "process_exited" | "stdin_closed" | "write_error" };

/**
 * Transport-level per-session sequence stamp. `SessionEventHub.publish` assigns a
 * monotonic `seq` to every per-session event as it is serialized to the socket.
 * Clients use it as a watermark against the join-time stream snapshot so buffered
 * live events are applied exactly once. Existing consumers may ignore it.
 */
export type SessionUiEvent = SessionUiEventBody & { seq?: number };

type SessionUiEventBody =
  | { type: "message.append"; message: unknown }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.thinking.delta"; text: string }
  | { type: "tool.start"; toolName: string; toolCallId: string; summary: string; args?: unknown }
  | { type: "tool.update"; toolName: string; toolCallId: string; text: string; content?: unknown; details?: unknown }
  | { type: "tool.end"; toolName: string; toolCallId: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "shell.start"; command: string; excludeFromContext?: boolean }
  | { type: "shell.chunk"; chunk: string }
  | { type: "shell.end"; output?: string; exitCode?: number | null; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string; isError?: boolean }
  | { type: "agent.start" }
  | { type: "agent.end" }
  | { type: "message.end"; message?: unknown }
  | { type: "status.update"; status: SessionStatus }
  | { type: "activity.update"; activity: SessionActivity }
  | { type: "command.output"; level: "info" | "success" | "error"; message: string }
  | SessionNotificationInboxEvent
  | { type: "session.error"; message: string }
  | { type: "ask.opened"; ask: PendingAskUser }
  | { type: "ask.closed"; askId: string; reason: AskUserCloseReason }
  | { type: "dialog.opened"; dialog: PendingExtensionDialog }
  | { type: "dialog.closed"; dialogId: string; reason: ExtensionDialogCloseReason; answer?: ExtensionDialogAnswer }
  | { type: "session.name"; sessionId: string; name?: string }
  | { type: "session.pinned"; sessionId: string; cwd: string; pinned: boolean }
  | { type: "session.tabs"; sessionId: string; cwd: string; tabs: string[] }
  | { type: "session.created"; session: SessionInfo }
  | WorktreeSessionEvent
  | { type: "session.pull-request"; link: PullLink }
  | { type: "session.pull-request.unlinked"; link: PullLink }
  | { type: "pi.event"; eventType: string }
  | { type: "processes.update"; snapshot: ManagedProcessesSnapshot }
  | { type: "processes.output"; id: string; lines: ManagedProcessLogLine[]; droppedLines: number };

export type GlobalSessionEvent =
  | TriggersChangedEvent
  | Extract<SessionUiEventBody, { type: "status.update" | "activity.update" | "session.name" | "session.pinned" | "session.tabs" | "session.created" | "session.pull-request" | "session.pull-request.unlinked" }>
  | SessionNotificationSummaryEvent
  | SessionUnreadEvent
  | SessionStartupProgressEvent
  | WorktreeSessionEvent
  | WorkspaceServicesEvent;
export type RealtimeEvent = GlobalSessionEvent | WorkspaceActivityUiEvent;
