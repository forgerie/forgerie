import type { TaskActivity } from "../../shared/durableTaskActivity.js";
import { durableBrowserMessageSchema } from "../../shared/durableBrowserSnapshot.js";
import { z } from "zod";
import { assertHistoryIdentity, PresentationHistoryIdentity, SessionOpenError, type SessionOpenPageRequest, type SessionOpenResult, type SessionOpenMessage, type SessionOpenHistoryPage } from "./sessionOpen.js";
import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import { appendAttentionHint, readAttentionHint } from "./durableAttentionHints.js";
import { AttentionHints, ATTENTION_HINT_CUSTOM_TYPE, type AttentionSession } from "../decisions/attentionHints.js";
import { DECISION_HINT_ERROR_EVENT, type DecisionHints } from "../decisions/decisionHints.js";
import type { WorkflowAutonomy } from "./workflowAutonomy.js";
import type { ManagedProcessTools } from "../processes/processTool.js";
import { ManagedProcessRegistry, type ManagedProcessRegistryOptions } from "../processes/managedProcessRegistry.js";
import type { ManagedProcesses } from "../processes/managedProcesses.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import type { ChildRun } from "../../shared/childRuns.js";
import type { StackLatencyContext, StackLatencySpan } from "../../shared/stackLatency.js";
import { createWorkflowScheduleTool } from "../triggers/triggerTool.js";
import type { TriggerService } from "../triggers/triggerService.js";
import type { TriggerAction } from "../../shared/triggers.js";
import { createAzurePrTools, type AzurePrToolDeps } from "./azurePrTools.js";
import type { SessionSearchService } from "./sessionSearchService.js";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { readSessionFileStats, type SessionFileStats } from "./sessionFileStats.js";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { clampThinkingLevel, type ImageContent } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionServices,
  createEditToolDefinition,
  defineTool,
  readStoredCredential,
  resolveModelScopeWithDiagnostics,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type EditToolDetails,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ModelRuntime,
  type PromptOptions,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import type { ClientArchiveSessionsResponse, ClientCommand, ClientCommandResult, ClientMessagePage, ClientNewSessionModelSelection, ClientSession, ClientSessionCleanupExecuteResponse, ClientSessionCleanupPreviewResponse, ClientSessionModel, ClientSessionStatus, ClientSessionTreeForkRequest, ClientSessionTreeForkResult, ClientSessionTreeNavigateRequest, ClientSessionTreeNavigateResult, ClientThinkingLevel, SessionStreamSnapshot, SessionUiEvent } from "../types.js";
import type { DurableSessionAddress } from "./durableSessionAddress.js";
import type { DurableSessionReader } from "./durableSessionReader.js";
import { withImageReferences, type SessionImage } from "./sessionImages.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { listStoredChildren, storedChildMessages } from "./durableChildAgents.js";
import { readSavedChild } from "./durableChildSavedReads.js";
import { BACKGROUND_CONTEXT as childReadContext } from "@earendil-works/chord/context";
import type { DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import type { DurableBrowserAttachment, DurableHostState } from "./durableParentReadModel.js";
import { ParentAsks, ParentAsksSchema } from "./durableParentDocuments.js";
import { Check } from "typebox/value";
import { BACKGROUND_CONTEXT as durableContext } from "@earendil-works/chord/context";
import { durableJson } from "./durableJson.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { readSessionBindings } from "./durableSessionBindings.js";
import type { Harness, ConversationId } from "@earendil-works/pi-durable";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import type { DurableChildHost } from "./durableChildHost.js";
import { recoverDurableSessions, type DurableRecoveryReport } from "./durableSessionRecovery.js";
import { DurableSessionRuntime, type DurableRuntimeFactory, type DurableRuntimeResult } from "./durableSessionRuntime.js";
import { projectBrowserMessage, projectBrowserMessageResponse } from "../browserMessageProjection.js";
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { runningAgentCount, spawnedSessionFiles } from "./delegationProgress.js";
import { markAgentSpawned } from "./agentSpawnedMarks.js";
import { repairAgentSpawnedMarks, type AgentSpawnedRepairMemo, type AgentSpawnedRepairReport } from "./agentSpawnedRepair.js";
import { hideChildrenOfDelegatingSessions } from "./inFlightSpawnedSessions.js";
import { BUILTIN_COMMANDS } from "./builtinCommands.js";
import { buildActiveCommandCatalog, buildActiveCommandList, expandPromptResourceCommand, resolvePromptResourceIdentity, type ActiveCommandCatalog } from "./commandCatalog.js";
import { canonicalPromptResourceOrigin } from "./promptResourceOrigin.js";
import { SessionCommandService } from "./sessionCommandService.js";
import { SessionCompactionQueue, type QueuedCompactionHandle, type QueuedPrompt, type QueuedPromptKind } from "./sessionCompactionQueue.js";
import { projectSessionTree, type ProjectableSessionTreeNode } from "./sessionTreeProjection.js";
import { SessionArchiveStore, type ArchivedSessionRecord, type ArchiveSessionInput } from "./sessionArchiveStore.js";
import { SessionPinStore, type PinnedSessionRecord, type PinSessionInput } from "./sessionPinStore.js";
import { SessionTabsStore, type SessionTabsRecord } from "./sessionTabsStore.js";
import { findArchiveCandidateByIdOrPrefix, planSessionArchiveTree, type SessionArchiveTreeCandidate } from "./sessionArchiveTree.js";
import type { ActiveSession } from "./sessionRuntimeStore.js";
import { deterministicSessionName, fallbackSessionName, generateShortSessionName } from "./sessionNameGenerator.js";
import type { SessionWorktrees, WorktreeSessionFile } from "../workspaces/sessionWorktrees.js";
import { pathInside, worktreeRecordForSession } from "../workspaces/sessionWorktreeStore.js";
import { computeEditPreview, type EditPreviewResult } from "./editPreview.js";
import { attachmentsToInlineImages, saveAttachmentsToWorkspace } from "./attachmentService.js";
import { parsePromptAttachments } from "../../shared/promptAttachments.js";
import { fingerprintPromptResourceDeliveryText, parseLeadingSlashCommand, type PromptResourceCommandIdentity } from "../../shared/promptResourceCommand.js";
import { AgentDirPromptLibrary } from "../resources/promptLibrary.js";
import { WorkflowError, WorkflowLibrary } from "../resources/workflowLibrary.js";
import type { WorkflowModels, WorkflowInputs, WorkflowOutcome, WorkflowStopDecision } from "../../shared/workflowRuns.js";
import { PROMPT_RESOURCE_CATALOG_LIMITS } from "../resources/promptResourceCatalog.js";
import { assertBoundedPromptResourceContent, readBoundedPromptResourceFile } from "../resources/promptResourceContent.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, SESSION_UNREAD_LIMIT } from "../../shared/apiTypes.js";
import type {
  AskUserCloseResponse,
  AskUserOutcome,
  AskUserSubmission,
  ExtensionDialogAnswer,
  ExtensionDialogCloseResponse,
  ExtensionDialogKind,
  ExtensionDialogOutcome,
  MachineSessionListingSnapshot,
  SavedPromptAttachment,
  SessionAbortResult,
  SessionAskCatalogSnapshot,
  SessionBulkArchiveResponse,
  SessionBulkDeleteArchivedResponse,
  SessionBulkFailure,
  SessionBulkMutationRef,
  SessionNotificationCatalogSnapshot,
  SessionNotificationClearReason,
  SessionNotificationDismissAllRequest,
  SessionNotificationDismissRequest,
  SessionNotificationInboxSnapshot,
  QueuedSessionMessage,
  SessionUnreadAcknowledgeRequest,
  SessionUnreadCatalogSnapshot,
  SessionTreeResponse,
  SessionWarning,
  ManagedProcessKillResult,
  ManagedProcessOutputResult,
  ManagedProcessesSnapshot,
  ManagedProcessWriteResult,
} from "../../shared/apiTypes.js";
import { promptRequestOptionsSchema, type PromptRequestOptions } from "../../shared/promptRequest.js";
import type { SessionRouteRef, SessionRouteService } from "./sessionService.js";
import { CODEMODE_TOOL_NAME, codemodeScriptSummary } from "../../shared/codemodeScript.js";
import { codemodeDefaultTools, hostedCodemodeExtension, isNestedToolEvent } from "./codemode.js";
import { hostedMcpExtension } from "./mcp.js";
import { ManagedProcessPanel } from "./managedProcessPanel.js";
import { createSessionTitleBridgeExtension, createSessionTitleBridgeSlot, type SessionTitleBridgeEvent, type SessionTitleBridgeSlot } from "./sessionTitleBridge.js";
import { bundledForgerieSkillsPackagePath, preferBundledForgerieSkills } from "./bundledForgerieSkills.js";
import { withReplyFormatGuide } from "../../shared/replyFormatGuide.js";
import { bundledCliproxyProviderPackagePath, bundledCliproxyProviderResources } from "./bundledCliproxyProvider.js";
import { preferBundledExtensions } from "./bundledExtensions.js";
import { bundledWebAccessPackagePath } from "./bundledWebAccess.js";
import { canonicalizeStoredCwd, cwdPathsEqual } from "../workingDirectory.js";
import { readSessionHeaderSummary, type SessionHeaderSummary } from "./sessionFileHeader.js";
import { countOutOfListingChildren, locateOutOfListingParents, type SessionHeaderReader } from "./parentSessionLocator.js";
import { siblingWorkspaceCwds, type ProjectWorkspaceCwds } from "../workspaces/projectWorkspaceCwds.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { createAskUserToolDefinition, type AskUserInvocation, type AskUserToolDeps } from "./askUserTool.js";
import { logDecision } from "./durableDecisions.js";
import { createGitHubActionsToolDefinitions, createGitHubToolDefinitions, type GitHubToolDeps } from "./githubTools.js";
import { createProjectTools, type ProjectToolDeps } from "./projectTools.js";
import type { WorkspaceServices } from "../workspaces/workspaceServices.js";
import { createWorkspaceServicesTool, createWorkspaceServicesObserver, type WorkspaceServicesObserver } from "./workspaceServicesTool.js";
import type { PullNote, PullSessionGateway, PullSessionState } from "../github/pullRequestService.js";
import type { PullSessionRef } from "../../shared/pullRequests.js";
import { undeliveredAskAnswers } from "./askAnswerDelivery.js";
import { createEndTurnToolDefinition, type EndTurnToolDeps } from "./endTurnTool.js";
import { responseFromBranch, SESSION_RESPONSE_CUSTOM_TYPE, type ResponseProjection, type SessionResponseEvent } from "./sessionResponse.js";
import { writeResponseCheckpoint } from "./sessionResponseCheckpoint.js";
import type { PendingAskUser } from "../../shared/apiTypes.js";
import type { SessionResponse } from "../../shared/sessionResponse.js";
import { SessionAsks, renderAskUserAnswersText, type PendingAskCloseResult, type PendingAskOpenResult } from "./sessionAsks.js";
import { PendingExtensionDialogStore, type ExtensionDialogCancelReason } from "./pendingExtensionDialogStore.js";
import { ExtensionDialogWaiters, effectiveExtensionDialogTimeoutMs, extensionDialogCancelValue } from "./extensionDialogWaiters.js";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS } from "../../config.js";
import { createSpawnSessionToolDefinition, type SpawnSessionInvocation, type SpawnSessionResult } from "./spawnSessionTool.js";
import { createHandoffSessionToolDefinition, type HandoffSessionInvocation, type HandoffSessionResult, type HandoffState } from "./handoffSessionTool.js";
import { HANDOFF_LIFECYCLE_CUSTOM_TYPE, HANDOFF_STATUS_CUSTOM_TYPE, handoffContinuationPrompt, handoffDocumentPath, handoffPreparationPrompt, handoffStatusContent, handoffTransition, type HandoffLifecycleContext, type HandoffPreparationContext } from "./handoffSession.js";
import { planSessionCleanup, summarizeSessionCleanupExecution, type NormalizedSessionCleanupRequest, type SessionCleanupPlan } from "./sessionCleanup.js";
import type { SpawnTargetDecision, SpawnTargetResolver } from "./spawnTargetResolver.js";
import {
  SessionNotificationStore,
  type SessionNotificationGeneration,
  type SessionNotificationMutation,
} from "./sessionNotificationStore.js";
import { plainTextTheme } from "./plainTextTheme.js";
import { boundSessionCatalogFirstMessage } from "./sessionCatalogMetadata.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "./sessionUnreadStore.js";

/**
 * Minimal structured-logging seam, shaped like Fastify's logger so sessiond can
 * pass `app.log` directly. Defaults to a no-op so the service stays usable
 * without booting a server (e.g. in tests).
 */
export interface PiSessionLogger {
  info(details: Record<string, unknown>, message: string): void;
}

const noopLogger: PiSessionLogger = { info() { /* no-op */ } };
const DEFAULT_UNREAD_PUBLICATION_RETRY_MS = 1_000;
const DEFAULT_PROMPT_PREFLIGHT_TIMEOUT_MS = 30_000;
/**
 * User-facing names for the two phases of session startup Forgerie can prove it
 * is inside: it awaits exactly one call for each, so the phase is a fact rather
 * than a guess. Deliberately free of internal symbol names and file paths.
 */
const STARTUP_PHASE_RUNTIME = "Starting the Pi session";
const STARTUP_PHASE_EXTENSIONS = "Loading session extensions";
/**
 * Appended to whichever phase is running when a background provider catalog
 * refresh happens to be in flight. It is stated as a concurrent fact, never as
 * the cause: Forgerie can verify that a refresh is running, but not that this
 * particular startup is waiting on it.
 */
const STARTUP_CONCURRENT_CATALOG_REFRESH = "provider model lists are refreshing";
const MAX_UNREAD_PUBLICATION_RETRY_MS = 30_000;
const MAX_PENDING_UNREAD_MUTATIONS = SESSION_UNREAD_LIMIT + 1;
/**
 * Why a terminal-drawing UI surface cannot run in a daemon session, and which
 * browser-backed surface to use instead. The model reads these as tool errors,
 * so each names the alternative rather than only the refusal — an extension
 * author reading the transcript must be able to act on it without opening
 * Forgerie's source.
 */
const TERMINAL_ONLY_UI_REFUSAL = {
  custom: "ui.custom is not available: a Forgerie session runs headless and has no terminal to draw a component in. Ask through ui.select, ui.confirm, or ui.input, which Forgerie renders as browser dialogs.",
  editor: "ui.editor is not available: a Forgerie session runs headless and has no terminal to draw an editor in. Collect the text with ui.input, which Forgerie renders as a browser dialog.",
} as const;

function noop(): void {
  // Intentionally empty default unsubscribe callback.
}

function spawnTargetError(decision: Extract<SpawnTargetDecision, { allowed: false }>): Error {
  if (decision.reason === "not-registered") return new Error("Spawning session is not in a registered project");
  return new Error(`cwd must be a workspace of this project. Allowed: ${decision.allowedCwds.join(", ")}`);
}

function modelSpecOf(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function handoffPreparationCompletion(event: unknown): PromptCompletion | undefined {
  if (getString(event, "type") !== "message_end") return undefined;
  const message = getProperty(event, "message");
  if (getString(message, "role") !== "assistant") return undefined;
  const stopReason = getString(message, "stopReason");
  if (stopReason === "stop") return { accepted: true };
  if (stopReason === "toolUse") return undefined;
  const detail = getString(message, "errorMessage");
  return {
    accepted: false,
    error: detail === undefined
      ? `Preparation run ended with stop reason ${stopReason ?? "unknown"}.`
      : `Preparation run ended with stop reason ${stopReason ?? "unknown"}: ${detail}`,
  };
}

/**
 * Parse a strict `provider/model-id` spec: split on the first `/` (model ids
 * may themselves contain `/`) and require both parts to be non-empty.
 */
function parseModelSpec(spec: string): { provider: string; modelId: string } | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/**
 * Error for a spawn-tool model spec that matched nothing. States the facts —
 * the bad spec and the required format — with deliberately no model list
 * (a list would invite guesses). The agent loop turns the throw into an
 * error tool result; how to recover is the agent's call.
 */
function unknownSpawnModelError(modelSpec: string): Error {
  return new Error(`Unknown model "${modelSpec}". Pass an exact "provider/model-id".`);
}

function refMatchesActiveSession(ref: PiSessionRef, active: ActiveSession<PiSessionRuntime>): boolean {
  return cwdPathsEqual(active.runtime.cwd, ref.cwd);
}

function refMatchesStartupSession(ref: PiSessionRef, session: PiAgentSession): boolean {
  return cwdPathsEqual(session.sessionManager.getCwd(), ref.cwd);
}

interface CompactionStartGate {
  promise: Promise<void>;
  resolve: () => void;
}

interface TreeExclusiveOperationTarget {
  sessionId: string;
  session?: PiAgentSession;
  runtime?: PiSessionRuntime;
}

type PiTreeNavigationOptions =
  | { summarize: false }
  | { summarize: true; customInstructions?: string };

function sessionTreeNavigationOptions(request: ClientSessionTreeNavigateRequest): PiTreeNavigationOptions {
  switch (request.summary.mode) {
    case "none":
      return { summarize: false };
    case "default":
      return { summarize: true };
    case "custom": {
      const customInstructions = request.summary.instructions.trim();
      if (customInstructions === "") throw new Error("Custom branch-summary instructions are required");
      if (customInstructions.length > SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
        throw new Error(`Custom branch-summary instructions must be at most ${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} characters`);
      }
      return { summarize: true, customInstructions };
    }
  }
}

function decrementWeakCount<Key extends object>(counts: WeakMap<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

function decrementMapCount<Key>(counts: Map<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

interface TrackedSubsessionLink {
  parentSessionId: string;
  childSessionId: string;
  childSessionFile?: string;
  parentSessionFile?: string;
  cwd?: string;
}

interface PersistedParentSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
  spawnedSessionFile?: string;
  cwd?: string;
}

interface PersistedChildSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
}

type SessionCreationProvenance = "detached-handoff";

interface StartSessionOptions {
  parentSession?: string;
  initialModel?: AgentModel;
  /** Strict `provider/model-id` chosen before the session existed. */
  initialModelSpec?: string;
  /**
   * Thinking level for the brand new session; omit to resolve from settings
   * and pi defaults. Pi clamps it to the initial model's capabilities.
   */
  initialThinkingLevel?: ClientThinkingLevel;
  /**
   * Opaque label, echoed on this construction's startup progress so a browser
   * row with no session id yet can recognise its own.
   */
  startupToken?: string;
}

interface InternalStartSessionOptions extends StartSessionOptions {
  creationProvenance?: SessionCreationProvenance;
  sessionId?: string;
}

function requirePromptText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Prompt text is required");
  return value;
}

function parseStreamingBehavior(value: unknown): QueuedPromptKind | undefined {
  if (value === undefined) return undefined;
  if (value === "steer" || value === "followUp") return value;
  throw new Error('streamingBehavior must be "steer" or "followUp"');
}

type SessionArchiveRepository = Pick<SessionArchiveStore, "list" | "get" | "archive" | "restore" | "isArchived"> & {
  archiveMany?: (sessions: readonly ArchiveSessionInput[]) => Promise<ArchivedSessionRecord[]>;
  deleteArchived?: (sessionId: string) => Promise<void>;
  deleteArchivedMany?: (sessionIds: readonly string[]) => Promise<string[]>;
};

export type SessionPinRepository = Pick<SessionPinStore, "list" | "get" | "pin" | "unpin" | "reconcileCwd">;

export type SessionTabsRepository = Pick<SessionTabsStore, "list" | "get" | "set" | "reconcileCwd">;

export type PiSessionRef = SessionRouteRef;

export interface PiSessionListEntry {
  id: string;
  path: string;
  cwd: string;
  created: Date;
  modified: Date;
  /**
   * Number of `message` entries in the transcript. The streaming summary
   * scanner counts message lines by their leading bytes and a trailing `}`
   * without validating the JSON, so a final write read mid-flight can add a
   * transient +1; the count self-heals on the next listing once the line
   * completes.
   */
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
  name?: string;
  parentSessionPath?: string;
  agentSpawned?: boolean;
  response?: SessionResponse;
  pendingAsk?: PendingAskUser;
}

/** A session file located by id without parsing its transcript. */
export interface ResolvedSessionFile {
  id: string;
  cwd: string;
  path: string;
}

interface WorkspaceArchiveCandidate extends SessionArchiveTreeCandidate {
  cwd: string;
  listEntry?: PiSessionListEntry;
  activeSession?: PiAgentSession;
}

interface BulkSessionRefContext {
  sessionsByCwd: Map<string, PiSessionListEntry[]>;
}

interface BulkArchivePlanItem {
  input: ArchiveSessionInput;
}

interface BulkDeletePlanItem {
  record: ArchivedSessionRecord;
}

type AgentModel = NonNullable<SpawnSessionInvocation["model"]>;

export interface PiSessionManager {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getBranch(): unknown[];
  getEntries?(): readonly unknown[];
  getTree?(): readonly ProjectableSessionTreeNode[];
  getLeafId(): string | null;
  getHeader?(): { parentSession?: string } | null | undefined;
  appendCustomEntry?(customType: string, data?: unknown): string;
}

export interface PiSessionManagerGateway {
  list(cwd: string): Promise<PiSessionListEntry[]>;
  /**
   * The `parentSessionPath` values recorded in the session files of `cwd`'s
   * session directory, read from each file's header line only — no transcript
   * parsing. `readHeader` is injected so the caller's per-path header cache is
   * reused.
   */
  listParentSessionPaths(cwd: string, readHeader: SessionHeaderReader): Promise<string[]>;
  /**
   * Locate a session file by id (exact match or id prefix, the same semantics
   * as finding it in `list`) without parsing transcripts. `readHeader` is
   * injected so the caller's per-path header cache is reused.
   */
  resolveSessionFile(cwd: string, sessionId: string, readHeader: SessionHeaderReader): Promise<ResolvedSessionFile | undefined>;
  /**
   * Drop any cached listing summary for a session file that was rewritten in
   * place (detach clears the header while keeping the inode): file identity
   * and size checks cannot detect such rewrites, so the scanner memo must be
   * told explicitly.
   */
  invalidateSessionFile(sessionFile: string): void;
  create(cwd: string, options?: { parentSession?: string; sessionId?: string }): PiSessionManager;
  /**
   * Cross-project listing of Pi's session stores (the default store plus any
   * env-configured session dir). Session cleanup scans every project at once;
   * per-session lookups use the cwd-scoped `list` instead.
   */
  listAll(): Promise<PiSessionListEntry[]>;
  /**
   * Bounded metadata listing for machine-wide navigation. Unlike `listAll`,
   * this must never parse entire transcripts: machines can retain tens of
   * gigabytes of history. Optional only for test/custom gateways; production
   * provides it and machine listing falls back to `listAll` for compatibility.
   */
  listCatalog?(): Promise<PiSessionListEntry[]>;
  rememberSessionName?(sessionFile: string, name: string | undefined): Promise<void>;
  flushSessionNames?(): Promise<void>;
  /**
   * The directory Pi stores sessions in. Used to confine a path-keyed write to
   * the session store. Optional so existing fakes still satisfy the interface;
   * a caller that needs confinement must refuse when it is absent.
   */
  defaultSessionsRoot?(): string;
  open(path: string): PiSessionManager;
  /** Non-persistent SDK view; never repairs or migrates the source file. */
  openReadOnly?(path: string): Promise<PiSessionManager>;
}

interface PiExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

interface PiExtensionBindings {
  uiContext?: ExtensionUIContext;
  mode?: "rpc";
  onError?: (error: PiExtensionError) => void;
}

export interface PiAgentSession {
  modelRuntime: ModelRuntime;
  /**
   * Narrow read/write of the SDK `SettingsManager`, exposing only the warning
   * suppression flags consumed here (e.g. `anthropicExtraUsage`). Used to gate
   * the Anthropic subscription-auth billing warning the same way the TUI does,
   * and to durably suppress it when the user dismisses the warning.
   */
  settingsManager: {
    getWarnings(): { anthropicExtraUsage?: boolean };
    setWarnings(warnings: { anthropicExtraUsage?: boolean }): void;
    getDoubleEscapeAction?(): "fork" | "tree" | "none";
  };
  sessionManager: PiSessionManager;
  scopedModels: readonly { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[];
  sessionId: string;
  sessionFile: string | undefined;
  sessionName: string | undefined;
  messages: readonly unknown[];
  /**
   * Narrow read of the SDK `AgentState`. Only the in-flight partial is consumed
   * here: `state.streamingMessage` is the current streamed assistant message
   * (an `AssistantMessage`) while a turn is mid-stream, and `undefined`
   * otherwise (idle, or during post-message tool execution). Used by
   * {@link PiSessionService.streamSnapshot} to seed a joining client.
   */
  readonly state: { readonly streamingMessage?: unknown };
  model: AgentModel | undefined;
  thinkingLevel: ClientThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  extensionRunner: {
    getRegisteredCommands(): readonly { invocationName: string; description?: string }[];
    getUIContext(): ExtensionUIContext;
    setUIContext(uiContext?: ExtensionUIContext, mode?: "rpc"): void;
  };
  promptTemplates: readonly { name: string; description?: string; content?: string; filePath?: string; sourceInfo?: { source: string; scope: string; origin: string } }[];
  resourceLoader: { getSkills(): { skills: readonly { name: string; description?: string; filePath?: string; baseDir?: string; sourceInfo?: { source: string; scope: string; origin: string } }[] } };
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: PiExtensionBindings): Promise<void>;
  compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }>;
  getUserMessagesForForking(): readonly { entryId: string; text: string }[];
  getSessionStats(): { sessionId: string; totalMessages: number; userMessages: number; assistantMessages: number; toolCalls: number; tokens: ClientSessionStatus["tokens"]; cost: number };
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  getContextUsage(): ClientSessionStatus["contextUsage"] | undefined;
  hasPromptRequest?(requestId: string): Promise<boolean>;
  prompt(text: string, options?: PromptRequestOptions & { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; expandPromptTemplates?: boolean; preflightResult?: PromptOptions["preflightResult"] }): Promise<void>;
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }): Promise<{ output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
  navigateTree?(targetId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: unknown }>;
  abortCompaction(): void;
  abortBranchSummary?(): void;
  abort(): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  setModel(model: AgentModel): Promise<void>;
  cycleModel(direction?: "forward" | "backward"): Promise<{ model: AgentModel } | undefined>;
  getAvailableThinkingLevels(): ClientThinkingLevel[];
  setThinkingLevel(level: ClientThinkingLevel): void;
  cycleThinkingLevel(): ClientThinkingLevel | undefined;
  setSessionName(name: string): void;
  /**
   * Narrow re-expression of `AgentSession.agent` (an `@earendil-works/pi-agent-core`
   * `Agent`), exposing only `streamFunction` — the resolved-auth/headers/retry "call
   * this model" function pi's own compaction/branch-summarization code uses
   * internally. Lets callers (e.g. session title generation) issue one-off model
   * calls without depending on pi-ai's deprecated `/compat` provider registry or
   * leaking the full `Agent`/`AgentSession` surface.
   */
  agent: { streamFunction: StreamFn };
}

type RuntimeResourceWarnings = NonNullable<RuntimeWarningSources["services"]>;
type PiWebRuntimeServices = RuntimeResourceWarnings & {
  sessionTitleBridgeSlot?: SessionTitleBridgeSlot;
  workspaceServicesObserver?: WorkspaceServicesObserver;
};
type PiWebAgentSessionServices = AgentSessionServices & PiWebRuntimeServices;

export interface PiSessionRuntime {
  readonly cwd: string;
  readonly session: PiAgentSession;
  /**
   * Live, runtime-scoped diagnostics/services used to compute session warnings.
   *
   * These mirror the SDK runtime and are recomputed whenever the runtime is
   * (re)built. `undefined` on lightweight/test runtimes that do not carry SDK
   * services; callers must treat missing sources as "no warnings".
   */
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: PiWebRuntimeServices;
  setRebindSession(rebindSession?: (session: PiAgentSession) => Promise<void>): void;
  fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }>;
  dispose(): Promise<void>;
}

interface PendingSessionOpen {
  sessionId: string;
  promise: Promise<ActiveSession<PiSessionRuntime>>;
}

interface CreateSessionRuntimeOptions extends Pick<InternalStartSessionOptions, "initialModel" | "initialThinkingLevel" | "creationProvenance" | "startupToken"> {
  notificationGeneration?: SessionNotificationGeneration;
  notifications?: "enabled" | "disabled";
  /**
   * What the user asked for, so startup progress can say "Creating" instead of
   * "Opening". Only `startSession()` creates a brand new session; every other
   * caller opens an existing one, so "open" is the default.
   */
  startupIntent?: "create" | "open";
}

/**
 * Read-only view of the background catalog refresher, so session startup can
 * state what it is concurrent with without being able to influence it.
 */
export interface CatalogRefreshStatus {
  isRefreshInFlight(): boolean;
}

/**
 * Publishes what a session startup is waiting on while it waits. Every call is
 * synchronous and event-only, so reporting never adds an await to session
 * creation and leaves no per-session state to unwind if creation fails.
 */
interface SessionStartupProgressReporter {
  report(phase: string): void;
  end(): void;
}

type NotificationClosePolicy =
  | { kind: "clear"; reason: SessionNotificationClearReason }
  | { kind: "defer" };

const CLEAR_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "clear", reason: "runtime-close" };
const DEFER_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "defer" };

function resourceDiagnosticToWarning(diagnostic: ResourceDiagnostic, source: string): SessionWarning {
  return {
    severity: diagnostic.type === "error" ? "error" : "warning",
    message: diagnostic.message,
    source,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
  };
}

function runtimeDiagnosticToWarning(diagnostic: AgentSessionRuntimeDiagnostic): SessionWarning {
  return { severity: diagnostic.type, message: diagnostic.message, source: "runtime" };
}

/**
 * Minimal structural view of a runtime's warning sources: the runtime setup
 * diagnostics plus the resource loader's per-collection diagnostics and
 * extension load errors. Narrowed to just what {@link collectRuntimeWarnings}
 * reads so the real SDK runtime and lightweight test doubles both satisfy it.
 */
export interface RuntimeWarningSources {
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: {
    resourceLoader: {
      getSkills(): { diagnostics: readonly ResourceDiagnostic[] };
      getPrompts(): { diagnostics: readonly ResourceDiagnostic[] };
      getThemes(): { diagnostics: readonly ResourceDiagnostic[] };
      getExtensions(): { errors: readonly { path: string; error: string }[] };
    };
  };
}

/**
 * Compute the live warnings for a runtime by re-reading its current resource
 * loader diagnostics, extension load errors, and runtime setup diagnostics.
 *
 * This mimics the TUI recomputing warnings on every (re)bind: it reads the
 * runtime's current state rather than a cached snapshot, so a rebuilt runtime
 * yields fresh warnings. Runtimes without SDK services (e.g. test fakes)
 * contribute no warnings.
 */
export function collectRuntimeWarnings(runtime: RuntimeWarningSources): SessionWarning[] {
  const warnings: SessionWarning[] = [];
  for (const diagnostic of runtime.diagnostics ?? []) warnings.push(runtimeDiagnosticToWarning(diagnostic));
  const resourceLoader = runtime.services?.resourceLoader;
  if (resourceLoader !== undefined) {
    for (const diagnostic of resourceLoader.getSkills().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "skill"));
    for (const diagnostic of resourceLoader.getPrompts().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "prompt"));
    for (const diagnostic of resourceLoader.getThemes().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "theme"));
    for (const error of resourceLoader.getExtensions().errors) {
      warnings.push({ severity: "error", message: `${error.path}: ${error.error}`, source: "extension", path: error.path });
    }
  }
  return warnings;
}

/**
 * Verbatim TUI wording for the Anthropic subscription-auth billing notice. Kept
 * character-for-character in sync with `ANTHROPIC_SUBSCRIPTION_AUTH_WARNING` in
 * the SDK's interactive mode so the browser shows the same message the TUI does.
 */
const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
  "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

/** Mirror of the SDK TUI `isAnthropicSubscriptionAuthKey` (subscription API keys start with `sk-ant-oat`). */
function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

/**
 * Dismiss id for the Anthropic subscription-auth billing notice. This is `pi`'s
 * own `WarningSettings` key verbatim (`anthropicExtraUsage`): we carry the
 * coupling `pi` already defines rather than inventing a parallel vocabulary, and
 * {@link dismissSessionWarning} maps it back to `setWarnings`.
 */
const ANTHROPIC_EXTRA_USAGE_DISMISS_ID = "anthropicExtraUsage";

/**
 * Port of the TUI `maybeWarnAboutAnthropicSubscriptionAuth` gate/trigger, computed
 * live from the session's current model, stored Anthropic credential, and warning
 * settings. Returns the billing warning when the active provider is `anthropic`
 * and auth is a subscription credential (stored `oauth`, or an `sk-ant-oat` API
 * key), unless suppressed via `getWarnings().anthropicExtraUsage === false`.
 *
 * The stored credential is read synchronously (matching the TUI's `oauth` branch
 * and the documented `sk-ant-oat` key trigger) so warnings stay part of the
 * synchronous live status computation.
 */
export function anthropicSubscriptionWarning(
  session: Pick<PiAgentSession, "model" | "settingsManager">,
  authPath?: string,
): SessionWarning | undefined {
  if (session.settingsManager.getWarnings().anthropicExtraUsage === false) return undefined;
  if (session.model?.provider !== "anthropic") return undefined;
  const credential = readStoredCredential("anthropic", authPath);
  if (credential === undefined) return undefined;
  const isSubscriptionAuth = credential.type === "oauth"
    ? true
    : isAnthropicSubscriptionAuthKey(credential.key);
  if (!isSubscriptionAuth) return undefined;
  return {
    severity: "warning",
    message: ANTHROPIC_SUBSCRIPTION_AUTH_WARNING,
    source: "anthropic",
    dismiss: { id: ANTHROPIC_EXTRA_USAGE_DISMISS_ID },
  };
}

/**
 * Durably suppress a dismissable session warning by mapping its opaque dismiss
 * id back to the concrete `pi` suppression it represents. Only known ids are
 * honored; unknown ids throw so a stale/forged client cannot silently no-op.
 *
 * This is the single place provider-specific suppression lives: the wire type,
 * parser, and UI stay agnostic. Adding a future dismissable warning is a
 * server-only change here plus a `dismiss` id on its producer.
 */
export function dismissSessionWarning(
  session: Pick<PiAgentSession, "settingsManager">,
  dismissId: string,
): void {
  if (dismissId !== ANTHROPIC_EXTRA_USAGE_DISMISS_ID) {
    throw new Error(`Unknown session warning dismiss id: ${dismissId}`);
  }
  session.settingsManager.setWarnings({ ...session.settingsManager.getWarnings(), anthropicExtraUsage: false });
}

interface CreateAgentRuntimeOptions {
  cwd: string;
  agentDir: string;
  sessionManager: PiSessionManager;
  delegationToolsEnabled: boolean;
  scopedModels: readonly ScopedAgentModel[];
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
}

type PiWebRuntimeFactoryOptions = Parameters<CreateAgentSessionRuntimeFactory>[0] & {
  handle?: DurableSessionHandle;
  delegationToolsEnabled?: boolean;
  scopedModels?: readonly ScopedAgentModel[];
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
};

type PiWebCreateAgentSessionRuntimeFactory = (
  options: PiWebRuntimeFactoryOptions
) => Promise<DurableRuntimeResult>;

type CreateAgentRuntime = (createRuntime: PiWebCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions) => Promise<PiSessionRuntime>;

function defaultCreateAgentRuntime(createRuntime: PiWebCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions): Promise<PiSessionRuntime> {
  if (!(options.sessionManager instanceof SessionManager)) throw new Error("Default runtime creation requires an SDK SessionManager");
  const runtimeFactory = createRuntimeWithOneShotSessionOptions(createRuntime, options.initialModel, options.initialThinkingLevel, options.delegationToolsEnabled, options.scopedModels);
  return DurableSessionRuntime.open(runtimeFactory, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
    nativeForks: true,
  });
}

function createRuntimeWithOneShotSessionOptions(
  createRuntime: PiWebCreateAgentSessionRuntimeFactory,
  initialModel: AgentModel | undefined,
  initialThinkingLevel: ClientThinkingLevel | undefined,
  delegationToolsEnabled: boolean,
  scopedModels: readonly ScopedAgentModel[],
): DurableRuntimeFactory {
  // These inputs belong only to the session being opened. A later runtime
  // replacement resolves its own model and delegation capability, and restores
  // the thinking level from the existing session file.
  let pendingInitialModel = initialModel;
  let pendingInitialThinkingLevel = initialThinkingLevel;
  let pendingDelegationToolsEnabled: boolean | undefined = delegationToolsEnabled;
  return async (options) => {
    const model = pendingInitialModel;
    const thinkingLevel = pendingInitialThinkingLevel;
    const toolsEnabled = pendingDelegationToolsEnabled;
    pendingInitialModel = undefined;
    pendingInitialThinkingLevel = undefined;
    pendingDelegationToolsEnabled = undefined;
    return createRuntime({
      ...options,
      ...(model === undefined ? {} : { initialModel: model }),
      ...(thinkingLevel === undefined ? {} : { initialThinkingLevel: thinkingLevel }),
      ...(toolsEnabled === undefined ? {} : { delegationToolsEnabled: toolsEnabled }),
      scopedModels,
    });
  };
}

type SpawnSessionFn = (input: SpawnSessionInvocation) => Promise<SpawnSessionResult>;
type HandoffSessionFn = (input: HandoffSessionInvocation) => Promise<HandoffSessionResult>;
type PromptCompletion = { accepted: true } | { accepted: false; error: string };

export function createPiWebCustomToolDefinitions(
  cwd: string,
  delegationEnabled: boolean,
  spawn?: SpawnSessionFn,
  askUser?: AskUserToolDeps,
  handoff?: HandoffSessionFn,
  github?: GitHubToolDeps,
  endTurn?: EndTurnToolDeps,
  projectTools?: ProjectToolDeps,
  workspaceServices?: WorkspaceServices,
  triggers?: () => TriggerService,
) {
  return [
    createPiWebEditToolDefinition(cwd),
    ...(triggers === undefined ? [] : [createWorkflowScheduleTool(cwd, triggers)]),
    ...(projectTools === undefined ? [] : createProjectTools(cwd, projectTools)),
    ...(workspaceServices === undefined ? [] : [createWorkspaceServicesTool(cwd, workspaceServices)]),
    ...(endTurn === undefined ? [] : [createEndTurnToolDefinition(endTurn)]),
    ...(delegationEnabled && spawn !== undefined ? [createSpawnSessionToolDefinition(cwd, { spawn })] : []),
    ...(delegationEnabled && handoff !== undefined ? [createHandoffSessionToolDefinition(cwd, { handoff })] : []),
    // Asking the user is not delegation: the questions land in the session the
    // user is already watching, so tracked children may ask too.
    ...(askUser === undefined ? [] : [createAskUserToolDefinition(askUser)]),
    // Not delegation either: the tools act on the session's own repo, as Forgerie's GitHub App.
    ...(github === undefined ? [] : [...createGitHubToolDefinitions(cwd, github), ...createGitHubActionsToolDefinitions(cwd, github)]),
  ];
}

function createDefaultRuntimeFactory(
  modelRuntime: ModelRuntime,
  sessionManagers: Pick<PiSessionManagerGateway, "open">,
  codemodeEnabled: boolean,
  spawn?: SpawnSessionFn,
  askUser?: AskUserToolDeps,
  handoff?: HandoffSessionFn,
  github?: GitHubToolDeps,
  projectTools?: ProjectToolDeps,
  durableChildAgents?: DurableChildHost,
  workspaceServices?: WorkspaceServices,
  beforeResume?: (session: DurableAgentSession) => Promise<boolean>,
  triggers?: () => TriggerService,
  azurePr?: AzurePrToolDeps,
  processTools?: (ref: PiSessionRef, sessionDir: string) => Promise<ManagedProcessTools | undefined>,
  decisionHints?: DecisionHints,
  workflowAutonomy?: () => WorkflowAutonomy,
): PiWebCreateAgentSessionRuntimeFactory {
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, initialModel, initialThinkingLevel, delegationToolsEnabled, scopedModels, handle }) => {
    const sessionTitleBridgeSlot = createSessionTitleBridgeSlot();
    const workspaceServicesObserver = workspaceServices === undefined ? undefined : createWorkspaceServicesObserver(cwd, workspaceServices);
    const providerResources = bundledCliproxyProviderResources(cwd, agentDir);
    const baseServices = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager: providerResources.settingsManager,
      resourceLoaderOptions: {
        additionalExtensionPaths: [
          bundledWebAccessPackagePath(),
          bundledForgerieSkillsPackagePath(),
          bundledCliproxyProviderPackagePath(),
        ],
        extensionsOverride: (result) => providerResources.extensionsOverride(preferBundledExtensions(result)),
        skillsOverride: preferBundledForgerieSkills,
        // Tells the agent which rich blocks the browser app renders.
        appendSystemPromptOverride: withReplyFormatGuide,
        extensionFactories: [
          createSessionTitleBridgeExtension(sessionTitleBridgeSlot),
          hostedCodemodeExtension(),
          hostedMcpExtension(),
          ...(workspaceServicesObserver === undefined ? [] : [workspaceServicesObserver.extension]),
        ],
      },
    });
    // After the resource loader's reload, which re-reads settings and would
    // drop an override applied any earlier.
    baseServices.settingsManager.applyOverrides({ defaultTools: codemodeDefaultTools(codemodeEnabled) });
    const services: PiWebAgentSessionServices = Object.assign(baseServices, { sessionTitleBridgeSlot, ...(workspaceServicesObserver === undefined ? {} : { workspaceServicesObserver }) });
    const resolvedDelegationToolsEnabled = delegationToolsEnabled
      ?? await sessionAllowsDelegationTools(sessionManager, sessionManagers);
    const customTools = createPiWebCustomToolDefinitions(cwd, resolvedDelegationToolsEnabled, spawn, askUser, handoff, github, {
      declare: async (awaiting, reply) => {
        await session.parentState.declareResponse(awaiting, durableContext, reply);
        await session.refreshParentAppState();
      },
    }, projectTools, workspaceServices, triggers);
    if (azurePr !== undefined) customTools.push(...await createAzurePrTools(cwd, azurePr));
    const managedTools = await processTools?.({ id: sessionManager.getSessionId(), cwd }, sessionManager.getSessionDir());
    const session = await DurableAgentSession.open({
      ...(decisionHints === undefined ? {} : {decisionHints}),
      ...(workflowAutonomy === undefined ? {} : {workflowAutonomy}),
      ...(managedTools === undefined ? {} : { processTools: managedTools }),
      ...(handle === undefined ? {} : { handle }),
      ...(beforeResume === undefined ? {} : { beforeResume }),
      services,
      sessionManager,
      customTools,
      ...(github?.gateIssueLabels === undefined ? {} : { gatedIssueLabels: async (targetCwd: string, issue: string | number, slug?: string, worktreeId?: string) => {
        let number = typeof issue === "number" ? issue : Number(issue);
        if (typeof issue === "string" && issue.startsWith("https://")) {
          const url = new URL(issue); const target = /^\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/u.exec(url.pathname);
          if (url.hostname !== "github.com" || target?.[1] === undefined || target[2] === undefined) throw new Error("Issue URL cannot be confirmed");
          slug = target[1]; number = Number(target[2]);
        }
        const resolved = worktreeId === undefined ? targetCwd : await github.target?.({id: sessionManager.getSessionId(), cwd}, worktreeId);
        if (resolved === undefined || github.gateIssueLabels === undefined) throw new Error("Issue target unavailable");
        return github.gateIssueLabels(resolved, number, slug);
      } }),
      // The adapter excludes question on initial registration and reload.
      ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
      ...(initialModel === undefined ? {} : { initialModel }),
      ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
      ...(scopedModels === undefined || scopedModels.length === 0 ? {} : { scopedModels }),
      ...(durableChildAgents === undefined ? {} : { childAgents: durableChildAgents }),
    }).catch((error: unknown) => { workspaceServicesObserver?.dispose(); throw error; });
    return { session, services, diagnostics: services.diagnostics };
  };
}

type PiWebEditToolDetails = EditToolDetails | { preview: EditPreviewResult } | undefined;

function createPiWebEditToolDefinition(cwd: string) {
  const editTool = createEditToolDefinition(cwd);
  return defineTool<typeof editTool.parameters, PiWebEditToolDetails>({
    name: editTool.name,
    label: editTool.label,
    description: editTool.description,
    ...(editTool.promptSnippet === undefined ? {} : { promptSnippet: editTool.promptSnippet }),
    ...(editTool.promptGuidelines === undefined ? {} : { promptGuidelines: editTool.promptGuidelines }),
    parameters: editTool.parameters,
    ...(editTool.renderShell === undefined ? {} : { renderShell: editTool.renderShell }),
    ...(editTool.prepareArguments === undefined ? {} : { prepareArguments: editTool.prepareArguments }),
    ...(editTool.executionMode === undefined ? {} : { executionMode: editTool.executionMode }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const preview = await computeEditPreview(params.path, params.edits, cwd);
      if (signal?.aborted !== true) {
        onUpdate?.({ content: [{ type: "text", text: "Edit preview computed." }], details: { preview } });
      }
      return editTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export interface PiSessionServiceDependencies {
  /** Optional background-only hint client and live settings; never used for authorization. */
  decisionHints?: DecisionHints;
  /** Reads Settings > Plugins > Workflow autonomy at each workflow decision. Omitted: every stop waits for the user. */
  workflowAutonomy?: () => WorkflowAutonomy;
  managedProcesses?: Omit<ManagedProcessRegistryOptions, "onError">;
  durableReader?: DurableSessionReader;
  agentDir: string;
  sessionSearch?: Pick<SessionSearchService, "refreshFile" | "scan">;
  sessionManager: PiSessionManagerGateway;
  sessionWorktrees?: SessionWorktrees;
  projectTools?: ProjectToolDeps;
  workspaceServices?: WorkspaceServices;
  triggers?: () => TriggerService;
  archiveStore?: SessionArchiveRepository;
  /** Pinned-session catalog; defaults to an in-memory store in tests. Production wiring injects the durable store. */
  pinStore?: SessionPinRepository;
  /** Per-session promoted-tab catalog; defaults to an in-memory store in tests. Production wiring injects the durable store. */
  tabsStore?: SessionTabsRepository;
  createRuntime?: PiWebCreateAgentSessionRuntimeFactory;
  createAgentRuntime?: CreateAgentRuntime;
  /** Durable-native child agents (the child_agent tool) for every session the default factory opens. */
  durableChildAgents?: DurableChildHost;
  modelRuntime: ModelRuntime;
  heartbeatIntervalMs?: number;
  workspaceActivity?: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity">;
  /**
   * When provided, `spawn_session` is available to sessions whose creation
   * provenance permits delegation, scoped to the project's workspaces.
   * Omit to keep the capability disabled.
   */
  spawnTargets?: SpawnTargetResolver;
  /**
   * When provided, session listings report related sessions living in sibling
   * workspaces of the same project: where an out-of-workspace parent is, and how
   * many children a listed session has elsewhere. Omit to list each workspace in
   * isolation.
   */
  projectWorkspaces?: ProjectWorkspaceCwds;
  /**
   * When true, `ask_user` is available to every session, so an agent can post a
   * question set to the browser. Independent of the delegation capabilities: the
   * questions reach the user of the asking session, not another session.
   */
  askUserEnabled?: boolean;
  /**
   * When provided, every session gets `github_read`, `github_write`, and `file_issue` for its
   * project's GitHub repo, acting as Forgerie's GitHub App.
   */
  github?: GitHubToolDeps;
  azurePr?: AzurePrToolDeps;
  pullRequestWatches?: { isWatching(id: string): boolean; stop(id: string, reason?: string): Promise<unknown> };
  actionRunWatches?: { isWatching(id: string): boolean; stop(id: string, reason?: string): Promise<unknown> };
  /**
   * When true, hosted sessions start with Pi's `codemode` tool active, so an
   * agent can run a script that calls the other tools. Off when omitted.
   */
  codemodeEnabled?: boolean;
  /**
   * `provider/model-id` of the model that writes session titles. A title is a
   * one-shot label, so a small fast model does it as well as the session's own
   * model for a fraction of the cost. Read once per title, so a change in
   * Settings applies to the next new session without a restart. Omit, or
   * return `undefined`, to use the session's model.
   */
  sessionTitleModel?: () => string | undefined;
  /** Optional transcript-backed question adapter for deterministic test fixtures. */
  sessionAsks?: SessionAsks;
  /** Daemon-lifetime open-dialog state; defaults to an in-memory store in tests. */
  pendingExtensionDialogStore?: PendingExtensionDialogStore;
  /**
   * How long an extension dialog with no extension-set `timeout` waits for an
   * answer before the daemon auto-cancels it; `0` waits forever. A tuning
   * knob, not a gate: extension dialogs are always on.
   */
  extensionDialogsTimeoutMs?: number;
  /** Structured logger for notable runtime events (e.g. spawns). */
  logger?: PiSessionLogger;
  /** Clock seam for cleanup planning tests. */
  now?: () => Date;
  /** Daemon-lifetime notification state, injected by sessiond in production. */
  notificationStore?: SessionNotificationStore;
  /** Durable daemon-owned unread state; defaults to an in-memory store in tests. */
  unreadStore?: SessionUnreadStore;
  /** Initial retry delay for durable unread publication failures. */
  unreadPublicationRetryDelayMs?: number;
  /** Maximum wait for Pi to accept or reject a prompt before delivery becomes ambiguous. */
  promptPreflightTimeoutMs?: number;
  /**
   * Lets session startup report that provider model lists are refreshing while
   * a session is being constructed. Omit to report the startup phase alone.
   */
  catalogRefreshStatus?: CatalogRefreshStatus;
}

/** A cached session header plus the identity of the file it was read from. */
interface CachedSessionHeader {
  header: SessionHeaderSummary;
  dev: string;
  ino: string;
}

export class PiSessionService implements SessionRouteService {
  private readonly active = new Map<string, ActiveSession<PiSessionRuntime>>();
  private readonly pendingSessionOpens = new Map<string, PendingSessionOpen>();
  private stopping = false;
  /**
   * Sessions whose extension binding is still in flight. A `session_start`
   * dialog parks that window before the session ever becomes active, so this
   * is the only way the dialog answer/cancel and status paths can reach it;
   * {@link getOrOpen} never consults it, keeping every other operation gated
   * on full readiness.
   */
  private readonly startupSessions = new Map<string, PiAgentSession>();
  private readonly constructingSessions = new Set<PiSessionRef>();
  /** Handoff destinations whose extension binding must auto-cancel startup dialogs instead of parking creation. */
  private readonly detachedHandoffStartupSessions = new WeakSet<PiAgentSession>();
  private readonly activities = new Map<string, {
    phase: "active" | "idle" | "error";
    label: string;
    detail?: string;
    activeSince?: string;
    at: string;
  }>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly commandService: SessionCommandService<PiAgentSession>;
  /** Runtime-identity gate held while Pi may await abandoned-branch summarization. */
  private readonly treeNavigations = new WeakSet<PiAgentSession>();
  /** Counts async operations that may append an entry before they settle. */
  private readonly sessionEntryMutationCounts = new WeakMap<PiAgentSession, number>();
  /** Runtime/session-identity reservations for operations that must not overlap tree navigation. */
  private readonly treeExclusiveRuntimeOperationCounts = new WeakMap<PiSessionRuntime, number>();
  private readonly treeExclusiveSessionOperationCounts = new Map<string, number>();
  private readonly deferredGeneratedSessionNames = new WeakMap<PiAgentSession, string>();
  private readonly claimedSessionTitleIntents = new WeakSet<PiAgentSession>();
  private readonly sessionTitleGenerationControllers = new WeakMap<PiAgentSession, AbortController>();
  private readonly compactionQueue = new SessionCompactionQueue();
  /** Last SDK status context estimate. Native hints must not rescan SDK history. */
  private readonly contextUsageBySession = new WeakMap<PiAgentSession, NonNullable<ClientSessionStatus["contextUsage"]>>();
  private readonly pendingPromptRequests = new WeakMap<PiAgentSession, Map<string, Promise<void>>>();
  private readonly compactionDrains = new WeakSet<PiAgentSession>();
  private readonly compactionDrainTimers = new Map<string, NodeJS.Timeout>();
  private readonly queuedCompactionTimers = new Map<string, NodeJS.Timeout>();
  private readonly compactionStartGates = new Map<string, CompactionStartGate>();
  /** Handoffs whose preparation reached ready or failed; prevents late prompt callbacks from changing the terminal result. */
  private readonly completedHandoffs = new Set<string>();
  /** Destination session ids that must reject user prompts until automatic continuation is accepted. */
  private readonly preparingHandoffDestinations = new Set<string>();
  /**
   * Session file path -> its parsed header and the file identity at read
   * time. Headers are written once, so identity-verified reads are cached.
   */
  private readonly sessionHeaderCache = new Map<string, CachedSessionHeader>();
  /** Carried across repair sweeps so an unchanged transcript is read once. */
  private readonly agentSpawnedRepairMemo: AgentSpawnedRepairMemo = new Map();
  /**
   * Agents each session currently has working, keyed by session id.
   *
   * Runtime-only: it describes what is happening right now, so it is rebuilt
   * from the event stream after a restart rather than persisted. Delegation
   * progress rides `tool_execution_update`, which the daemon already sees for
   * every hosted session, so the inbox can report a session's fan-out without
   * opening it.
   */
  private readonly workingAgentsBySession = new Map<string, number>();
  /** Session file path -> its in-flight header read, so concurrent scans share one read per file. */
  private readonly pendingSessionHeaderReads = new Map<string, Promise<SessionHeaderSummary | undefined>>();
  private readonly managedProcesses: ManagedProcessRegistry | undefined;
  private readonly archiveStore: SessionArchiveRepository;
  private readonly pinStore: SessionPinRepository;
  private readonly tabsStore: SessionTabsRepository;
  private readonly agentDir: string;
  private readonly sessionSearch: PiSessionServiceDependencies["sessionSearch"];
  private readonly actionRunWatches: PiSessionServiceDependencies["actionRunWatches"];
  private readonly pullRequestWatches: PiSessionServiceDependencies["pullRequestWatches"];
  private readonly sessionManager: PiSessionManagerGateway;
  private readonly durableReader: DurableSessionReader | undefined;
  private readonly childReadWorktrees: SessionWorktrees | undefined;
  private readonly presentationHistory = new PresentationHistoryIdentity();
  private readonly preparingFamilies = new WeakMap<Harness, Promise<void>>();
  private readonly sessionWorktrees: SessionWorktrees | undefined;
  private readonly createRuntime: PiWebCreateAgentSessionRuntimeFactory;
  private readonly createAgentRuntime: CreateAgentRuntime;
  private readonly modelRuntime: ModelRuntime;
  private readonly workspaceActivity: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity"> | undefined;
  private readonly spawnTargets: SpawnTargetResolver | undefined;
  private readonly projectWorkspaces: ProjectWorkspaceCwds | undefined;
  private readonly logger: PiSessionLogger;
  private readonly sessionTitleModel: (() => string | undefined) | undefined;
  private readonly now: () => Date;
  private readonly notificationStore: SessionNotificationStore;
  private readonly notificationGenerationBySession = new WeakMap<PiAgentSession, SessionNotificationGeneration>();
  private readonly unreadStore: SessionUnreadStore;
  private readonly sessionAsks: SessionAsks;
  private readonly attentionHints: AttentionHints;
  private readonly attentionSessions = new WeakMap<PiAgentSession, AttentionSession>();
  private readonly responseMemo = new WeakMap<PiSessionManager, { leafId: string | null; projection: ResponseProjection }>();
  private readonly pendingExtensionDialogStore: PendingExtensionDialogStore;
  private readonly extensionDialogsTimeoutMs: number;
  private readonly promptPreflightTimeoutMs: number;
  /** The parked extension Promise resolvers behind the store's open dialogs. */
  private readonly dialogWaiters = new ExtensionDialogWaiters();
  private readonly catalogRefreshStatus: CatalogRefreshStatus | undefined;
  private readonly unreadPublicationRetryInitialMs: number;
  private readonly pendingUnreadMutations: SessionUnreadMutation[] = [];
  private unreadPublication: Promise<void> | undefined;
  private unreadPublicationFailure: unknown;
  private unreadPublicationFlushRequested = false;
  private unreadPublicationRetryTimer: NodeJS.Timeout | undefined;
  private unreadPublicationRetryDelayMs: number;
  private unreadPublicationStopped = false;

  constructor(private readonly events: SessionEventHub, deps: PiSessionServiceDependencies) {
    this.durableReader = deps.durableReader;
    this.childReadWorktrees = deps.durableChildAgents?.worktrees ?? deps.sessionWorktrees;
    this.archiveStore = deps.archiveStore ?? new SessionArchiveStore();
    this.pinStore = deps.pinStore ?? new SessionPinStore();
    this.tabsStore = deps.tabsStore ?? new SessionTabsStore();
    this.agentDir = deps.agentDir;
    this.pullRequestWatches = deps.pullRequestWatches;
    this.actionRunWatches = deps.actionRunWatches;
    this.sessionManager = deps.sessionManager;
    this.sessionWorktrees = deps.sessionWorktrees;
    this.modelRuntime = deps.modelRuntime;
    this.spawnTargets = deps.spawnTargets;
    this.sessionSearch = deps.sessionSearch;
    this.projectWorkspaces = deps.projectWorkspaces;
    this.logger = deps.logger ?? noopLogger;
    this.attentionHints = new AttentionHints(deps.decisionHints, (err) => { this.logger.info({ err }, "attention hint persistence failed"); }, deps.now ?? (() => new Date()));
    this.managedProcesses = deps.managedProcesses === undefined ? undefined : new ManagedProcessRegistry({ ...deps.managedProcesses,
      resolveSession: async (id) => {
        if (await this.archiveStore.isArchived(id)) return undefined;
        const entry = await this.managedProcessSession(id);
        if (await this.sessionWorktrees?.store.readOnly(entry) !== undefined) return undefined;
        return { cwd: entry.cwd, stateFile: join(dirname(entry.path), `${id}.process-watches.json`) };
      },
      onTurn: async (id) => {
        if (this.stopping || await this.archiveStore.isArchived(id)) return;
        const entry = await this.managedProcessSession(id);
        if (await this.sessionWorktrees?.store.readOnly(entry) !== undefined) return;
        await this.getOrOpen(entry);
      },
      onError: (error, sessionId) => { this.logger.info({ err: error, sessionId }, "managed process maintenance failed"); } });
    this.sessionTitleModel = deps.sessionTitleModel;
    this.now = deps.now ?? (() => new Date());
    this.notificationStore = deps.notificationStore ?? new SessionNotificationStore();
    this.unreadStore = deps.unreadStore ?? new SessionUnreadStore();
    this.sessionAsks = deps.sessionAsks ?? new SessionAsks({
      readResponse: (id) => {
        const session = this.active.get(id)?.runtime.session ?? this.startupSessions.get(id);
        return session === undefined ? { response: { kind: "none" } } : this.responseProjection(session);
      },
      appendEvent: (id, event) => { this.appendResponseEvent(this.responseSession(id), event); },
    });
    this.pendingExtensionDialogStore = deps.pendingExtensionDialogStore ?? new PendingExtensionDialogStore();
    this.extensionDialogsTimeoutMs = deps.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS;
    this.promptPreflightTimeoutMs = Math.max(1, deps.promptPreflightTimeoutMs ?? DEFAULT_PROMPT_PREFLIGHT_TIMEOUT_MS);
    this.catalogRefreshStatus = deps.catalogRefreshStatus;
    this.unreadPublicationRetryInitialMs = Math.max(
      0,
      deps.unreadPublicationRetryDelayMs ?? DEFAULT_UNREAD_PUBLICATION_RETRY_MS,
    );
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
    this.createRuntime = deps.createRuntime ?? createDefaultRuntimeFactory(
      this.modelRuntime,
      this.sessionManager,
      deps.codemodeEnabled === true,
      this.spawnTargets === undefined ? undefined : (input) => this.spawnSession(input),
      deps.askUserEnabled === true ? { open: (input) => this.openAsk(input) } : undefined,
      this.spawnTargets === undefined ? undefined : (input) => this.handoffSession(input),
      deps.github === undefined ? undefined : { ...deps.github, fileIssue: async (targetCwd, id, input) => {
        const file = deps.github?.fileIssue;
        if (file === undefined) throw new Error("Issue filing is unavailable.");
        const session = await this.getOrOpen(this.activeSessionRef(id));
        if (!(session instanceof DurableAgentSession)) throw new Error("Issue filing requires a Durable parent session.");
        const result = await file(targetCwd, id, input);
        if (result.state === "created") {
          // Record the known issue even when the tool will report a label attachment error.
          try {
            await session.journal.conversation.commit(tx => logDecision(tx, session.journal.conversation.id, {
              id: `issue:${result.repo.toLowerCase()}:${String(result.number)}`, kind: "issue", by: "parent",
              question: input.title, choice: `#${String(result.number)} ${result.url}`,
              reason: `Searches run: ${input.duplicates.join("; ")}`, flagged: false,
            }), durableContext);
          } catch (error) {
            throw new Error(`Filed #${String(result.number)} ${result.url}, but decision logging failed: ${error instanceof Error ? error.message : String(error)}. Do not file it again.`, { cause: error });
          }
        }
        return result;
      } },
      deps.projectTools,
      deps.durableChildAgents,
      deps.workspaceServices,
      (session) => this.prepareDurableFamily(session),
      deps.triggers,
      deps.azurePr,
      this.managedProcesses === undefined ? undefined : async (ref, sessionDir) => {
        if (await this.archiveStore.isArchived(ref.id) || await this.sessionWorktrees?.store.readOnly(ref) !== undefined) return undefined;
        if (this.managedProcesses === undefined) throw new Error("Managed processes are not configured");
        return this.managedProcesses.tools(ref.id, { cwd: ref.cwd, stateFile: join(sessionDir, `${ref.id}.process-watches.json`) });
      },
      deps.decisionHints,
      deps.workflowAutonomy,
    );
    this.createAgentRuntime = deps.createAgentRuntime ?? defaultCreateAgentRuntime;
    this.workspaceActivity = deps.workspaceActivity;
    this.heartbeat = setInterval(() => { this.publishHeartbeats(); }, deps.heartbeatIntervalMs ?? 2000);
    this.commandService = new SessionCommandService(
      (sessionId) => this.getActive(this.activeSessionRef(sessionId)),
      (sessionId, text) => this.prompt(this.activeSessionRef(sessionId), text, undefined, undefined, { echoUserMessage: false }),
      events,
      {
        onCompactionStart: (session) => {
          this.armCompactionStartGate(session.sessionId);
          this.beginSessionEntryMutation(session, "compact the session");
          this.publishActivity(session, "compacting", "active");
          this.publishStatus(session);
        },
        onCompactionEnd: (session, result, detail) => {
          this.resolveCompactionStartGate(session.sessionId);
          this.endSessionEntryMutation(session);
          this.compactionQueue.finishCompaction(session.sessionId);
          if (result === "success") this.publishActivity(session, "compaction complete", "idle");
          else if (result === "cancelled") this.publishActivity(session, "compaction cancelled", "idle");
          else this.publishActivity(session, "compaction failed", "error", detail);
          this.publishStatus(session);
          this.scheduleCompactionQueueDrain(session.sessionId);
        },
        reloadSession: (session) => this.reloadSessionRuntime(session),
        getSessionTree: (session) => {
          if (session instanceof DurableAgentSession) return session.getDurableTree();
          if (typeof session.sessionManager.getTree !== "function" || typeof session.navigateTree !== "function") return undefined;
          return projectSessionTree(session.sessionManager.getTree(), session.sessionManager.getLeafId());
        },
        hasActiveWork: (session) => this.hasActiveWork(session),
        isTreeNavigationActive: (session) => this.treeNavigations.has(session),
        runSessionReplacement: (session, operation) => this.runTreeExclusiveOperation(
          [{ sessionId: session.sessionId, session }],
          "Stop current session activity before replacing the session",
          operation,
        ),
        onUserFork: (session) => this.detachForkedSession(session),
        runWorkflow: (session, name, inputs, requestId) => this.runWorkflow(this.activeSessionRef(session.sessionId), name, inputs, requestId),
        workflowRuns: (session) => this.workflowRuns(this.activeSessionRef(session.sessionId)),
        copyWorkflow: (session, name, destination) => this.copyWorkflow(this.activeSessionRef(session.sessionId), name, destination),
      },
      { listSessionNames: (cwd) => this.listSessionNames(cwd) },
      new AgentDirPromptLibrary(this.agentDir),
    );
  }

  activeCount(): number {
    return this.active.size;
  }

  notificationCatalog(): SessionNotificationCatalogSnapshot {
    return this.notificationStore.catalogSnapshot();
  }

  asksCatalog(): SessionAskCatalogSnapshot {
    const reachableSessions = new Map<string, PiAgentSession>();
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      reachableSessions.set(sessionCatalogIdentity(session), session);
    }
    for (const session of this.startupSessions.values()) {
      reachableSessions.set(sessionCatalogIdentity(session), session);
    }

    const sessions = [...reachableSessions.values()].flatMap((session) => {
      const pendingAsk = session instanceof DurableAgentSession ? session.parentResponseProjection.pendingAsk : this.sessionAsks.pendingAsk(session.sessionId);
      const pendingDialogs = this.pendingExtensionDialogStore.pendingDialogs(session.sessionId);
      if (pendingAsk === undefined && pendingDialogs.length === 0) return [];
      return [{
        id: session.sessionId,
        cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
        ...(pendingAsk === undefined ? {} : { pendingAsk }),
        ...(pendingDialogs.length === 0 ? {} : { pendingDialogs }),
      }];
    });
    return { sessions };
  }

  async unreadCatalog(): Promise<SessionUnreadCatalogSnapshot> {
    await this.publishUnreadMutations([]);
    return this.unreadStore.durableCatalogSnapshot();
  }

  async acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest): Promise<SessionUnreadCatalogSnapshot> {
    const result = this.unreadStore.acknowledge(sessionId, {
      ...request,
      cwd: canonicalizeStoredCwd(request.cwd),
    });
    await this.publishUnreadMutations(result.mutations);
    return this.unreadStore.durableCatalogSnapshot();
  }

  notificationInbox(ref: PiSessionRef): SessionNotificationInboxSnapshot {
    return this.notificationStore.inboxSnapshot(ref.id, canonicalizeStoredCwd(ref.cwd));
  }

  dismissNotification(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissRequest, "cwd">,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationStore.dismissNotification(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.notificationId,
    );
    this.publishNotificationMutations(result.mutations);
    return result.snapshot;
  }

  dismissAllNotifications(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissAllRequest, "cwd">,
  ): SessionNotificationInboxSnapshot {
    const result = this.notificationStore.dismissAll(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.throughOrder,
      request.throughOverflowWatermark,
    );
    this.publishNotificationMutations(result.mutations);
    return result.snapshot;
  }

  async cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupPreviewResponse> {
    return previewResponseFromPlan(await this.cleanupPlan(request));
  }

  async cleanup(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupExecuteResponse> {
    const plan = await this.cleanupPlan(request);
    if (plan.deleteRecords.length > 0 && this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const archiveInputs: ArchiveSessionInput[] = [];
    const readyArchiveInputs: ArchiveSessionInput[] = [];
    const deleteRecords: ArchivedSessionRecord[] = [];
    const readyDeleteRecords: ArchivedSessionRecord[] = [];
    const skippedBusySessionIds = new Set(plan.skippedBusySessionIds);

    for (const input of plan.archiveInputs) {
      if (this.activeSessionHasWork(input.sessionId)) {
        skippedBusySessionIds.add(input.sessionId);
        continue;
      }
      await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" });
      readyArchiveInputs.push(input);
    }
    await this.archiveStoreArchiveMany(readyArchiveInputs);
    archiveInputs.push(...readyArchiveInputs);
    await this.forgetUnreadSessions(readyArchiveInputs);

    for (const record of plan.deleteRecords) {
      if (this.activeSessionHasWork(record.sessionId)) {
        skippedBusySessionIds.add(record.sessionId);
        continue;
      }
      await this.closeActive(record.sessionId, { kind: "clear", reason: "delete" });
      readyDeleteRecords.push(record);
    }
    const deletedSessionIds = new Set(await this.archiveStoreDeleteArchivedMany(readyDeleteRecords.map((record) => record.sessionId)));
    deleteRecords.push(...readyDeleteRecords.filter((record) => deletedSessionIds.has(record.sessionId)));
    await this.forgetUnreadSessions(deleteRecords);
    await this.sessionWorktrees?.store.forgetTranscripts(deleteRecords.map((record) => record.sessionId));

    return summarizeSessionCleanupExecution({
      archiveInputs,
      deleteRecords,
      thresholds: plan.thresholds,
      generatedAt: plan.generatedAt,
      skippedBusySessionIds: [...skippedBusySessionIds],
    });
  }

  async dispose(): Promise<void> {
    this.attentionHints.dispose();
    this.stopping = true;
    await this.durableReader?.close();
    this.unreadPublicationStopped = true;
    this.clearUnreadPublicationRetry();
    clearInterval(this.heartbeat);
    clearSessionTimers(this.compactionDrainTimers);
    clearSessionTimers(this.queuedCompactionTimers);
    // Same startup-park hazard as closeActive(): settle `session_start` dialogs
    // of sessions still binding extensions before awaiting their pending opens.
    for (const sessionId of this.startupSessions.keys()) this.endSessionExtensionDialogs(sessionId);
    const pendingOpens = this.pendingSessionOpenPromises();
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const activeSessions = Array.from(new Set(this.active.values()));
    for (const active of activeSessions) {
      this.retireAttentionSession(active.runtime.session);
      this.forgetUnreadActivity(active.runtime.session);
      this.endSessionExtensionDialogs(active.runtime.session.sessionId);
    }
    this.active.clear();
    this.pendingSessionOpens.clear();
    this.startupSessions.clear();
    this.activities.clear();
    this.compactionQueue.clearAll();
    this.sessionHeaderCache.clear();
    this.pendingSessionHeaderReads.clear();
    this.notificationStore.clearAll("service-dispose");
    try {
      await Promise.all(activeSessions.map(async (active) => {
        active.unsubscribe();
        active.runtime.setRebindSession(undefined);
        this.workspaceActivity?.removeSession(active.runtime.session.sessionId, active.runtime.session.sessionManager.getCwd());
        // Daemon shutdown closes journals and leaves unfinished work resumable. Stop remains an explicit abort operation.
        await active.runtime.dispose();
      }));
    } finally { await this.managedProcesses?.dispose(); }
    await this.sessionManager.flushSessionNames?.();
    await this.publishUnreadMutations([]);
  }

  async machineListing(): Promise<MachineSessionListingSnapshot> {
    const [catalogSessions, archivedRecords, pinnedRecords, tabsRecords] = await Promise.all([
      this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll(),
      this.archiveStore.list(),
      this.pinStore.list(),
      this.tabsStore.list(),
    ]);
    const activeSessions = [...new Set(this.active.values())];
    const activeNamesByPath = new Map(activeSessions.flatMap((active) => {
      const session = active.runtime.session;
      return session.sessionFile === undefined || session.sessionFile === ""
        ? []
        : [[session.sessionFile, session.sessionName] as const];
    }));
    const listedSessions = catalogSessions.map((session) => {
      if (!activeNamesByPath.has(session.path)) return session;
      const next = { ...session };
      delete next.name;
      const activeName = activeNamesByPath.get(session.path);
      if (activeName !== undefined) next.name = activeName;
      return next;
    });
    const listedById = new Map(listedSessions.map((session) => [session.id, session]));
    const archivedById = new Map(archivedRecords.map((record) => [record.sessionId, record]));

    for (const record of archivedRecords) {
      this.publishNotificationMutations(this.notificationStore.clearSession(record.sessionId, "archive-reconcile"));
    }

    const unarchivedSessions = withPinnedFlags(
      listedSessions
        .filter((session) => !archivedById.has(session.id))
        .map(clientSessionFromListEntry),
      pinnedSessionIdSet(pinnedRecords),
    );
    const archivedSessions = [...archivedRecords]
      .sort(compareArchivedRecords)
      .map((record) => clientSessionFromArchivedRecord(record, listedById.get(record.sessionId)))
      .filter(isDefined);
    const sessions = hideChildrenOfDelegatingSessions(
      withMachineSessionRelationships(withSessionTabs([...unarchivedSessions, ...archivedSessions], tabsBySessionId(tabsRecords))),
      this.delegatingSessionFiles(),
    );

    const ownedSessions = (await this.withSessionWorktrees(sessions)).map((session) => ({ ...session, ...(this.pullRequestWatches?.isWatching(session.id) === true ? { watchingPullRequest: true } : {}), ...(this.actionRunWatches?.isWatching(session.id) === true ? { watchingActionRun: true } : {}) }));
    const cwds = new Set([
      ...ownedSessions.map((session) => session.cwd),
      ...listedSessions.map((session) => session.cwd),
      ...archivedRecords.map((record) => record.cwd),
    ]);
    for (const cwd of cwds) {
      const archivedForCwd = new Map(
        archivedRecords
          .filter((record) => cwdPathsEqual(record.cwd, cwd))
          .map((record) => [record.sessionId, record]),
      );
      const listedSessionIds = ownedSessions
        .filter((session) => !archivedById.has(session.id) && cwdPathsEqual(session.cwd, cwd))
        .map((session) => session.id);
      const reconcilableSessionIds = this.reconcilableSessionIds(cwd, listedSessionIds, archivedForCwd);
      this.workspaceActivity?.reconcileSessionActivity(cwd, reconcilableSessionIds);
      await this.publishUnreadMutations(this.unreadStore.reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds));
      // Tabs survive archiving, so archived ids stay in the tabs reconcile set.
      await this.tabsStore.reconcileCwd(canonicalizeStoredCwd(cwd), [...reconcilableSessionIds, ...archivedForCwd.keys()]);
    }

    const statuses = activeSessions.map((active) => this.statusFromSession(active.runtime.session));
    const activities = activeSessions.flatMap((active) => {
      const sessionId = active.runtime.session.sessionId;
      const activity = this.activities.get(sessionId);
      return activity === undefined ? [] : [{ sessionId, ...activity }];
    });
    return { sessions: withSessionTabs(withPinnedFlags(ownedSessions, pinnedSessionIdSet(pinnedRecords)), tabsBySessionId(tabsRecords)), statuses, activities };
  }

  async list(cwd: string): Promise<ClientSession[]> {
    const [sessions, archivedRecords, pinnedRecords, tabsRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list(), this.pinStore.list(), this.tabsStore.list()]);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const archivedForCwd = archivedRecords.filter((record) => record.cwd === cwd);
    const archivedById = new Map(archivedForCwd.map((record) => [record.sessionId, record]));
    for (const record of archivedForCwd) {
      this.publishNotificationMutations(this.notificationStore.clearSession(record.sessionId, "archive-reconcile"));
    }
    const unarchivedSessions = withPinnedFlags(
      sessions.filter((session) => !archivedById.has(session.id)).map(clientSessionFromListEntry),
      pinnedSessionIdSet(pinnedRecords),
    );
    const savedSessions = await this.withSessionWorktrees([], cwd);
    const listedIds = [...unarchivedSessions, ...savedSessions.filter((session) => !archivedById.has(session.id))].map((session) => session.id);
    const reconcilableSessionIds = this.reconcilableSessionIds(cwd, listedIds, archivedById);
    this.workspaceActivity?.reconcileSessionActivity(cwd, reconcilableSessionIds);
    await this.publishUnreadMutations(this.unreadStore.reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds));
    await this.pinStore.reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds);
    // Tabs survive archiving, so archived ids stay in the tabs reconcile set.
    await this.tabsStore.reconcileCwd(canonicalizeStoredCwd(cwd), [...reconcilableSessionIds, ...archivedById.keys()]);
    const archivedSessions = archivedForCwd
      .sort(compareArchivedRecords)
      .map((record) => clientSessionFromArchivedRecord(record, sessionsById.get(record.sessionId)))
      .filter(isDefined);
    const ownedSessions = (await this.withSessionWorktrees(await this.withRelatedSessionsElsewhere(withSessionTabs([...unarchivedSessions, ...archivedSessions], tabsBySessionId(tabsRecords)), cwd), cwd)).map((session) => ({ ...session, ...(this.pullRequestWatches?.isWatching(session.id) === true ? { watchingPullRequest: true } : {}), ...(this.actionRunWatches?.isWatching(session.id) === true ? { watchingActionRun: true } : {}) }));
    return withSessionTabs(withPinnedFlags(ownedSessions, pinnedSessionIdSet(pinnedRecords)), tabsBySessionId(tabsRecords));
  }

  private async managedProcessSession(id: string): Promise<{ id: string; cwd: string; path: string }> {
    const entry = (await (this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll())).find(session => session.id === id);
    if (entry === undefined) throw new Error(`Cannot resolve managed process session ${id}; its events were retained`);
    return { id: entry.id, cwd: entry.cwd, path: entry.path };
  }

  async initializeManagedProcesses(): Promise<void> {
    await this.managedProcesses?.initialize(async (id) => {
      if (await this.archiveStore.isArchived(id)) await this.closeSessionManagedProcesses(id);
    });
  }

  private async closeSessionManagedProcesses(sessionId: string, transcriptPath?: string): Promise<void> {
    if (this.managedProcesses === undefined) return;
    // The gateway opens transcripts with dirname(path) as getSessionDir(). Capture
    // the original path before archive/delete, never the relocated archive copy.
    const path = transcriptPath ?? (await this.archiveStore.get(sessionId))?.originalPath
      ?? (await (this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll())).find((session) => session.id === sessionId)?.path;
    await this.managedProcesses.closeSession(sessionId);
    if (path !== undefined) await rm(join(dirname(path), `${sessionId}.process-watches.json`), { force: true });
  }

  async getManagedProcesses(sessionId: string): Promise<ManagedProcesses> {
    if (this.managedProcesses === undefined) throw new Error("Managed processes are not configured");
    if (await this.archiveStore.isArchived(sessionId)) throw new Error("Archived sessions cannot start managed processes");
    return this.managedProcesses.get(sessionId);
  }

  async childRunFinished(run: ChildRun): Promise<void> {
    if (run.state.kind !== "finished") return;
    await this.managedProcesses?.childFinished(run.session.id, { name: run.child.name, runId: run.id });
  }

  /** Called at the shared destruction seam, also on Land/Discard cleanup retries. */
  async closeWorktreeManagedProcesses(record: SessionWorktreeRecord): Promise<void> {
    const sessions = await this.worktreeSessionInventory(record.path);
    const ids = new Set([...sessions.map((session) => session.id), ...record.transcripts.map((session) => session.id),
      ...(record.sessionId === undefined ? [] : [record.sessionId])]);
    for (const id of ids) {
      const path = sessions.find((session) => session.id === id)?.path ?? record.transcripts.find((session) => session.id === id)?.session.path
        ?? (record.sessionId === id ? record.ownerSession?.path : undefined);
      await this.closeSessionManagedProcesses(id, path);
    }
  }

  /** Cleanup keeps even idle, unarchived sessions. Hidden delegated sessions are part of the catalog. */
  async worktreeHasLiveSession(cwd: string, ownerId?: string): Promise<boolean> {
    await Promise.all(this.pendingSessionOpenPromises());
    const matches = (id: string, directory: string) => pathInside(cwd, directory) || (ownerId !== undefined && id.startsWith(ownerId));
    const hasRuntime = () => [...this.constructingSessions].some((ref) => matches(ref.id, ref.cwd))
      || [...this.startupSessions.values()].some((item) => matches(item.sessionManager.getSessionId(), item.sessionManager.getCwd()))
      || [...this.active.values()].some((item) => matches(item.runtime.session.sessionId, item.runtime.cwd));
    if (hasRuntime()) return true;
    const [catalog, archived] = await Promise.all([this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll(), this.archiveStore.list()]);
    const archives = new Set(archived.map((item) => item.sessionId));
    return hasRuntime() || catalog.some((item) => !archives.has(item.id) && matches(item.id, item.cwd));
  }

  /** Close only idle sessions. The worktree service has already persisted its input gate. */
  async prepareWorktreeRemoval(cwd: string): Promise<(ClientSession & WorktreeSessionFile)[]> {
    await Promise.all(this.pendingSessionOpenPromises());
    if ([...this.startupSessions.values()].some((session) => pathInside(cwd, session.sessionManager.getCwd()))) {
      throw new Error("Wait for session startup to finish before removing its worktree");
    }
    const active = [...this.active.values()].filter((item) => pathInside(cwd, item.runtime.cwd));
    for (const item of active) {
      const counts = this.liveWorkCounts(item.runtime.session);
      if (this.hasActiveWork(item.runtime.session) || (counts.workingAgents ?? 0) > 0) {
        throw new Error("Stop agents in this worktree before Land or Discard");
      }
      if (!sessionFileExists(item.runtime.session.sessionFile)) throw new Error("Send the first message before removing an owned session worktree");
    }
    const sessions = await this.worktreeSessionInventory(cwd);
    for (const item of active) await this.closeActive(item.runtime.session.sessionId);
    return sessions;
  }

  private async worktreeSessionInventory(cwd: string): Promise<(ClientSession & WorktreeSessionFile)[]> {
    const [catalog, snapshot] = await Promise.all([this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll(), this.machineListing()]);
    // Include delegated children hidden by inbox policy. Cleanup must consider every session, not only visible rows.
    const inventory = new Map(catalog.map((entry) => [entry.id, clientSessionFromListEntry(entry)]));
    for (const session of snapshot.sessions) inventory.set(session.id, session);
    const archives = new Map((await this.archiveStore.list()).map((record) => [record.sessionId, record]));
    return [...inventory.values()].filter((session) => pathInside(cwd, session.cwd)).map((session) => {
      const archive = archives.get(session.id);
      return archive?.archivePath === undefined ? session : { ...session, transcriptSourcePath: archive.archivePath };
    });
  }

  private async withSessionWorktrees(sessions: readonly ClientSession[], cwd?: string): Promise<ClientSession[]> {
    const worktrees = this.sessionWorktrees;
    if (worktrees === undefined) return [...sessions];
    const records = await worktrees.store.list();
    const all = [...sessions];
    const known = new Set(all.map((session) => session.id));
    for (const record of records) {
      if (record.state.kind === "active") continue;
      for (const transcript of record.transcripts) {
        if (known.has(transcript.id) || (cwd !== undefined && !cwdPathsEqual(cwd, transcript.cwd)) || !sessionFileExists(transcript.transcriptPath)) continue;
        all.push({ ...transcript.session, persisted: true });
        known.add(transcript.id);
      }
    }
    return Promise.all(all.map(async (session) => {
      const record = worktreeRecordForSession(records, session);
      return record === undefined ? session : { ...session, worktree: await worktrees.info(record, session.id) };
    }));
  }

  /**
   * Annotate a listing with the session relationships that cross workspace
   * boundaries: where an out-of-listing parent lives, and how many children a
   * listed session has in sibling workspaces.
   *
   * Both directions are best-effort. An unreadable parent header or a sibling
   * workspace that cannot be listed leaves the session unannotated rather than
   * failing the listing, and the browser falls back to its generic states.
   */
  private async withRelatedSessionsElsewhere(sessions: readonly ClientSession[], cwd: string): Promise<ClientSession[]> {
    const [parentLocations, childCounts] = await Promise.all([
      locateOutOfListingParents(sessions, cwd, this.readCachedSessionHeader),
      this.countChildrenInSiblingWorkspaces(sessions, cwd),
    ]);
    return sessions.map((session) => {
      const parent = session.parentSessionPath === undefined ? undefined : parentLocations.get(session.parentSessionPath);
      const childrenElsewhere = childCounts.get(session.path);
      if (parent === undefined && childrenElsewhere === undefined) return session;
      const annotated = { ...session };
      if (parent !== undefined) {
        annotated.parentSessionId = parent.parentSessionId;
        annotated.parentSessionCwd = parent.parentSessionCwd;
      }
      if (childrenElsewhere !== undefined) annotated.childSessionsElsewhere = childrenElsewhere;
      return annotated;
    });
  }

  /**
   * Count children of the listed sessions that live in other workspaces of the
   * same project.
   *
   * Only sibling workspaces are scanned: agents may only spawn into workspaces
   * of the spawning session's own project, so that bounds where a child can be.
   * Each sibling scan reads only the header line of every session file (the
   * only place `parentSessionPath` is recorded), never the transcripts. Listing
   * is skipped entirely when no project-workspace locator is configured or the
   * cwd belongs to no registered project.
   */
  private async countChildrenInSiblingWorkspaces(sessions: readonly ClientSession[], cwd: string): Promise<Map<string, number>> {
    if (this.projectWorkspaces === undefined || sessions.length === 0) return new Map();
    try {
      const siblingCwds = await siblingWorkspaceCwds(this.projectWorkspaces, cwd);
      if (siblingCwds.length === 0) return new Map();
      const listings = await Promise.all(siblingCwds.map((siblingCwd) => this.sessionManager.listParentSessionPaths(siblingCwd, this.readCachedSessionHeader)));
      return countOutOfListingChildren(sessions, listings.flat());
    } catch (error: unknown) {
      this.logger.info(
        { cwd, error: error instanceof Error ? error.message : String(error) },
        "failed to count child sessions in sibling workspaces",
      );
      return new Map();
    }
  }

  /**
   * Read a session file header, memoized per path, with one in-flight read
   * per path: concurrent scans of a shared session directory share the read
   * instead of each opening the file. Pi writes the header once at session
   * creation, so a successful read stays valid as long as the path still
   * holds the same file: every hit re-checks the file's identity (dev/ino),
   * and a replacement landed at a cached path is re-read instead of serving
   * the previous file's header — the summary scanner detects such
   * replacements, so the listing and the header reads must agree. The one
   * thing identity cannot detect is an in-place rewrite that keeps the
   * inode; detach, the only such writer, deletes the entry itself. Failures
   * are not cached so a session file that appears later is picked up.
   */
  private readonly readCachedSessionHeader: SessionHeaderReader = (sessionFile) => {
    const pending = this.pendingSessionHeaderReads.get(sessionFile);
    if (pending !== undefined) return pending;
    const read = this.loadSessionHeader(sessionFile).finally(() => {
      this.pendingSessionHeaderReads.delete(sessionFile);
    });
    this.pendingSessionHeaderReads.set(sessionFile, read);
    return read;
  };

  private async loadSessionHeader(sessionFile: string): Promise<SessionHeaderSummary | undefined> {
    let stats: SessionFileStats;
    try {
      stats = await readSessionFileStats(sessionFile);
    } catch {
      // Gone or unreadable: report no header and forget any cached entry.
      this.sessionHeaderCache.delete(sessionFile);
      return undefined;
    }
    const cached = this.sessionHeaderCache.get(sessionFile);
    if (cached?.dev === stats.dev && cached.ino === stats.ino) return cached.header;
    const header = await readSessionHeaderSummary(sessionFile);
    if (header === undefined) {
      this.sessionHeaderCache.delete(sessionFile);
      return undefined;
    }
    this.sessionHeaderCache.set(sessionFile, { header, dev: stats.dev, ino: stats.ino });
    return header;
  }

  async start(cwd: string, options: StartSessionOptions = {}): Promise<ClientSession> {
    const modelSpec = options.initialModelSpec;
    if (modelSpec === undefined) return this.startSession(cwd, options);
    const initialModel = await this.resolveNewSessionModel(modelSpec);
    return this.startSession(cwd, { ...options, initialModel });
  }

  private async startSession(cwd: string, options: InternalStartSessionOptions): Promise<ClientSession> {
    if (this.sessionWorktrees !== undefined) {
      const blocking = (await this.sessionWorktrees.store.list()).find((record) => pathInside(record.path, cwd) && (record.operation !== undefined || record.state.kind !== "active"));
      if (blocking !== undefined) throw new Error("This workspace is closed or a worktree lifecycle action is running");
    }
    const active = await this.create(
      this.sessionManager.create(cwd, {
        ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      }),
      cwd,
      {
        startupIntent: "create",
        ...(options.startupToken === undefined ? {} : { startupToken: options.startupToken }),
        ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
        ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
        ...(options.creationProvenance === undefined ? {} : { creationProvenance: options.creationProvenance }),
      },
    );
    const { session } = active.runtime;
    const created: ClientSession = {
      id: session.sessionId,
      path: session.sessionFile ?? "",
      cwd,
      persisted: sessionFileExists(session.sessionFile),
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: session.messages.length,
      firstMessage: "",
      // Include the parent so listeners can nest the new session in the tree
      // immediately, instead of showing it flat until the next reload.
      ...(options.parentSession === undefined ? {} : { parentSessionPath: options.parentSession }),
    };
    // Broadcast so other clients (and the spawning agent's UI) can add the new
    // session to their list without a manual reload.
    this.events.publishGlobal({ type: "session.created", session: created });
    return created;
  }

  /** Internal receipt-keyed session creation. The public start options do not contain sessionId. */
  async ensureTriggerSession(ref: PiSessionRef, action: Pick<TriggerAction, "model" | "thinkingLevel">): Promise<void> {
    const existing = await this.triggerSessionExists(ref) ? await this.historySessionManager(ref) : undefined;
    const branch = existing?.getBranch() ?? [];
    const hasModel = branch.some((entry) => isRecord(entry) && entry["type"] === "model_change");
    const hasThinking = branch.some((entry) => isRecord(entry) && entry["type"] === "thinking_level_change");
    if (existing !== undefined && hasModel && hasThinking) return;
    const initialModel = hasModel || action.model === undefined ? undefined : await this.resolveNewSessionModel(action.model);
    const options = {
      ...(initialModel === undefined ? {} : { initialModel }),
      ...(hasThinking || action.thinkingLevel === undefined ? {} : { initialThinkingLevel: action.thinkingLevel }),
    };
    if (existing === undefined) { await this.startSession(ref.cwd, { ...options, sessionId: ref.id }); return; }
    const active = this.activeForRef(ref);
    if (active !== undefined) {
      if (initialModel !== undefined) await active.runtime.session.setModel(initialModel);
      if (options.initialThinkingLevel !== undefined) active.runtime.session.setThinkingLevel(options.initialThinkingLevel);
      return;
    }
    // A header-only creation has no saved choice. Seed both choices together before opening its journal.
    // Existing native agent state remains authoritative if a crash only delayed its JSONL projection.
    await this.openExistingSession(ref.id, ref.cwd, () => existing, options);
  }

  async triggerSessionExists(ref: PiSessionRef): Promise<boolean> {
    return this.activeForRef(ref) !== undefined || await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader) !== undefined;
  }

  async nameTriggerSession(ref: PiSessionRef, name: string): Promise<void> {
    const session = await this.getOrOpen(ref);
    this.cancelSessionTitleGeneration(session);
    session.setSessionName(name);
    this.rememberSessionName(session);
  }

  async noteTriggerFailure(ref: PiSessionRef, requestId: string, text: string): Promise<void> {
    const session = await this.getOrOpen(ref);
    const delivered = session.sessionManager.getBranch().some((entry) => isRecord(entry) && entry["type"] === "custom_message" && entry["customType"] === "forgerie:trigger" && getString(entry["details"], "requestId") === requestId);
    if (delivered) return;
    await this.runSessionEntryMutation(session, "record trigger failure", () => session.sendCustomMessage(
      { customType: "forgerie:trigger", content: text, display: true, details: { requestId } }, { triggerTurn: false },
    ));
    this.unreadStore.observeActivityState(ref.id, ref.cwd, true);
    await this.publishUnreadMutations(this.unreadStore.observeActivityState(ref.id, ref.cwd, false));
    this.publishStatus(session);
  }

  /**
   * Start a new session on behalf of a LLM and deliver an initial prompt to it.
   * The target cwd is constrained to a workspace of the same registered project
   * as the spawning session so the new session is visible in the web UI.
   */
  async spawnSession(input: SpawnSessionInvocation): Promise<SpawnSessionResult> {
    if (this.spawnTargets === undefined) throw new Error("Spawning sessions is disabled");
    const decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, input.cwd);
    if (!decision.allowed) throw spawnTargetError(decision);
    // A model spec overrides the inherited model. Only a spec resolves
    // against the spawning session; the default path must not depend on it.
    const model = input.modelSpec === undefined
      ? input.model
      : await this.resolveSpawnModel({ id: input.spawningSessionId, cwd: input.spawningCwd }, input.modelSpec);
    const created = await this.start(decision.cwd, {
      ...(model === undefined ? {} : { initialModel: model }),
      ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
    });
    const modelUsed = this.active.get(created.id)?.runtime.session.model;
    await this.prompt(created, input.prompt);
    this.logger.info(
      { spawningCwd: input.spawningCwd, sessionId: created.id, cwd: decision.cwd, promptLength: input.prompt.length },
      "spawn_session started a new session",
    );
    return {
      sessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
    };
  }

  /**
   * Create a continuation session immediately, then prepare its context in the
   * destination while the source turn terminates.
   */
  async handoffSession(input: HandoffSessionInvocation): Promise<HandoffSessionResult> {
    if (this.spawnTargets === undefined) throw new Error("Spawning sessions is disabled");
    const source = await this.getOrOpen({ id: input.sourceSessionId, cwd: input.spawningCwd });
    if (source.sessionFile !== input.sourceSessionFile) throw new Error("Source session transcript changed before handoff");
    const sourceBranch = [...source.sessionManager.getBranch()];

    const handoffId = randomUUID();
    const requestedAt = this.now().toISOString();
    const requestedContext: HandoffLifecycleContext = {
      handoffId,
      sourceSessionId: input.sourceSessionId,
      ...(input.sourceLeafId === undefined ? {} : { sourceLeafId: input.sourceLeafId }),
      ...(input.focus === undefined ? {} : { focus: input.focus }),
      requestedAt,
    };
    this.requireHandoffTransition(source, requestedContext, "requested");
    this.logHandoffTransition(handoffId, "requested", {
      sourceSessionId: input.sourceSessionId,
      spawningCwd: input.spawningCwd,
    });

    let decision: SpawnTargetDecision;
    let created: ClientSession;
    try {
      decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, input.cwd);
      if (!decision.allowed) throw spawnTargetError(decision);
      const model = input.modelSpec === undefined
        ? input.model
        : await this.resolveSpawnModel({ id: input.sourceSessionId, cwd: input.spawningCwd }, input.modelSpec);
      created = await this.startSession(decision.cwd, {
        ...(model === undefined ? {} : { initialModel: model }),
        ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
        creationProvenance: "detached-handoff",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordHandoffTransition(source, requestedContext, "failed", message);
      this.logHandoffTransition(handoffId, "failed", { sourceSessionId: input.sourceSessionId, error: message });
      throw error;
    }

    const destination = this.active.get(created.id)?.runtime.session;
    if (destination === undefined) {
      const message = "Handoff destination did not become active";
      this.recordHandoffTransition(source, requestedContext, "failed", message);
      this.logHandoffTransition(handoffId, "failed", { sourceSessionId: input.sourceSessionId, destinationSessionId: created.id, error: message });
      throw new Error(message);
    }
    const lifecycleContext: HandoffLifecycleContext = {
      ...requestedContext,
      destinationSessionId: created.id,
      cwd: decision.cwd,
    };

    this.preparingHandoffDestinations.add(created.id);
    try {
      this.requireHandoffTransition(source, lifecycleContext, "destination-created");
      this.requireHandoffTransition(destination, lifecycleContext, "destination-created");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.preparingHandoffDestinations.delete(created.id);
      this.recordHandoffTransition(source, lifecycleContext, "failed", message);
      this.logHandoffTransition(handoffId, "failed", { sourceSessionId: input.sourceSessionId, destinationSessionId: created.id, error: message });
      await destination.abort();
      throw error;
    }
    this.logHandoffTransition(handoffId, "destination-created", {
      sourceSessionId: input.sourceSessionId,
      destinationSessionId: created.id,
      cwd: decision.cwd,
    });
    await this.publishHandoffStatus(destination, lifecycleContext, "preparing");

    void this.detachSourceAndPrepare(source, destination, lifecycleContext, sourceBranch);
    const modelUsed = destination.model;
    return {
      handoffId,
      sourceSessionId: input.sourceSessionId,
      destinationSessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
      state: "preparing",
    };
  }

  private async detachSourceAndPrepare(source: PiAgentSession, destination: PiAgentSession, lifecycleContext: HandoffLifecycleContext, sourceBranch: readonly unknown[]): Promise<void> {
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
    try {
      await source.abort();
    } catch (error: unknown) {
      const message = `Source termination failed: ${error instanceof Error ? error.message : String(error)}`;
      await this.failDetachedHandoff(source, destination, lifecycleContext, message);
      await destination.abort();
      return;
    }

    try {
      this.requireHandoffTransition(source, lifecycleContext, "source-detached");
      this.requireHandoffTransition(destination, lifecycleContext, "source-detached");
      this.logHandoffTransition(lifecycleContext.handoffId, "source-detached", {
        sourceSessionId: lifecycleContext.sourceSessionId,
        destinationSessionId: lifecycleContext.destinationSessionId,
      });
      this.requireHandoffTransition(source, lifecycleContext, "preparing");
      this.requireHandoffTransition(destination, lifecycleContext, "preparing");
      this.logHandoffTransition(lifecycleContext.handoffId, "preparing", {
        sourceSessionId: lifecycleContext.sourceSessionId,
        destinationSessionId: lifecycleContext.destinationSessionId,
        cwd: lifecycleContext.cwd,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failDetachedHandoff(source, destination, lifecycleContext, message);
      await destination.abort();
      return;
    }

    const destinationSessionId = lifecycleContext.destinationSessionId;
    const cwd = lifecycleContext.cwd;
    if (destinationSessionId === undefined || cwd === undefined) {
      await this.failDetachedHandoff(source, destination, lifecycleContext, "Handoff destination context is incomplete.");
      return;
    }
    const sourceSnapshotFile = join(tmpdir(), `forgerie-handoff-${lifecycleContext.handoffId}.json`);
    const context: HandoffPreparationContext = {
      ...lifecycleContext,
      destinationSessionId,
      cwd,
      sourceSnapshotFile,
    };
    try {
      await writeFile(sourceSnapshotFile, `${JSON.stringify({
        version: 1,
        handoffId: context.handoffId,
        sourceSessionId: context.sourceSessionId,
        sourceLeafId: context.sourceLeafId,
        branch: sourceBranch,
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      let transportCompletion: PromptCompletion | undefined;
      let runCompletion: PromptCompletion | undefined;
      const unsubscribe = destination.subscribe((event) => {
        const observed = handoffPreparationCompletion(event);
        if (observed !== undefined) runCompletion = observed;
      });
      const accepted = await this.submitPrompt(
        destination,
        handoffPreparationPrompt(context),
        undefined,
        [],
        false,
        true,
        undefined,
        (result) => { transportCompletion = result; },
      );
      unsubscribe();
      const completion = transportCompletion?.accepted === false
        ? transportCompletion
        : runCompletion ?? (accepted
          ? { accepted: false, error: "Preparation run ended without a successful final assistant message." }
          : { accepted: false, error: "Preparation prompt failed." });
      await this.finishDetachedHandoff(source, destination, context, completion);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finishDetachedHandoff(source, destination, context, { accepted: false, error: message });
    }
  }

  private async finishDetachedHandoff(source: PiAgentSession, destination: PiAgentSession, context: HandoffPreparationContext, completion: PromptCompletion): Promise<void> {
    if (this.completedHandoffs.has(context.handoffId)) return;
    let result = completion;
    if (result.accepted) {
      const documentError = await this.handoffDocumentError(context);
      if (documentError !== undefined) result = { accepted: false, error: documentError };
    }
    if (this.completedHandoffs.has(context.handoffId)) return;
    this.completedHandoffs.add(context.handoffId);

    try {
      if (!result.accepted) {
        await this.failDetachedHandoff(source, destination, context, result.error);
        return;
      }

      try {
        this.requireHandoffTransition(source, context, "ready");
        this.requireHandoffTransition(destination, context, "ready");
      } catch (error: unknown) {
        await this.failDetachedHandoff(source, destination, context, error instanceof Error ? error.message : String(error));
        return;
      }
      this.logHandoffTransition(context.handoffId, "ready", {
        sourceSessionId: context.sourceSessionId,
        destinationSessionId: context.destinationSessionId,
        cwd: context.cwd,
      });
      await this.publishHandoffStatus(destination, context, "ready");
      try {
        await this.prompt(
          { id: context.destinationSessionId, cwd: context.cwd },
          handoffContinuationPrompt(context),
          undefined,
          undefined,
          { echoUserMessage: false, handoffContinuation: true },
        );
        this.preparingHandoffDestinations.delete(context.destinationSessionId);
      } catch (error: unknown) {
        this.preparingHandoffDestinations.delete(context.destinationSessionId);
        const message = `Continuation delivery failed: ${error instanceof Error ? error.message : String(error)}`;
        this.recordHandoffTransition(source, context, "continuation-failed", message);
        this.recordHandoffTransition(destination, context, "continuation-failed", message);
        this.logHandoffTransition(context.handoffId, "continuation-failed", {
          sourceSessionId: context.sourceSessionId,
          destinationSessionId: context.destinationSessionId,
          error: message,
        });
        await this.publishHandoffStatus(destination, context, "continuation-failed", message);
      }
    } finally {
      await rm(context.sourceSnapshotFile, { force: true });
    }
  }

  private async failDetachedHandoff(source: PiAgentSession, destination: PiAgentSession, context: HandoffLifecycleContext, error: string): Promise<void> {
    this.completedHandoffs.add(context.handoffId);
    if (context.destinationSessionId !== undefined) this.preparingHandoffDestinations.delete(context.destinationSessionId);
    this.recordHandoffTransition(source, context, "failed", error);
    this.recordHandoffTransition(destination, context, "failed", error);
    this.logHandoffTransition(context.handoffId, "failed", {
      sourceSessionId: context.sourceSessionId,
      ...(context.destinationSessionId === undefined ? {} : { destinationSessionId: context.destinationSessionId }),
      error,
    });
    await this.publishHandoffStatus(destination, context, "failed", error);
  }

  private async handoffDocumentError(context: HandoffPreparationContext): Promise<string | undefined> {
    const path = join(context.cwd, handoffDocumentPath(context));
    try {
      const document = await stat(path);
      if (!document.isFile()) return `Handoff preparation did not create a regular file at ${handoffDocumentPath(context)}.`;
      if (document.size === 0) return `Handoff preparation created an empty file at ${handoffDocumentPath(context)}.`;
      return undefined;
    } catch (error: unknown) {
      return `Handoff preparation did not create ${handoffDocumentPath(context)}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async publishHandoffStatus(destination: PiAgentSession, context: HandoffLifecycleContext, state: "preparing" | "ready" | "failed" | "continuation-failed", error?: string): Promise<void> {
    try {
      await destination.sendCustomMessage({
        customType: HANDOFF_STATUS_CUSTOM_TYPE,
        content: handoffStatusContent(state, error),
        display: true,
        details: handoffTransition(context, state, this.now().toISOString(), error),
      }, { triggerTurn: false });
    } catch (publicationError: unknown) {
      this.logger.info({
        handoffId: context.handoffId,
        state,
        destinationSessionId: context.destinationSessionId,
        error: publicationError instanceof Error ? publicationError.message : String(publicationError),
      }, "handoff_session status publication failed");
    }
  }

  private requireHandoffTransition(session: PiAgentSession, context: HandoffLifecycleContext, state: HandoffState): void {
    if (!this.recordHandoffTransition(session, context, state)) {
      throw new Error(`Could not persist handoff state ${state} for session ${session.sessionId}`);
    }
  }

  private recordHandoffTransition(session: PiAgentSession, context: HandoffLifecycleContext, state: HandoffState, error?: string): boolean {
    if (session.sessionManager.appendCustomEntry === undefined) {
      this.logger.info({ handoffId: context.handoffId, state, sessionId: session.sessionId }, "handoff_session lifecycle persistence unavailable");
      return false;
    }
    try {
      session.sessionManager.appendCustomEntry(
        HANDOFF_LIFECYCLE_CUSTOM_TYPE,
        handoffTransition(context, state, this.now().toISOString(), error),
      );
      return true;
    } catch (persistenceError: unknown) {
      this.logger.info({
        handoffId: context.handoffId,
        state,
        sessionId: session.sessionId,
        error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
      }, "handoff_session lifecycle persistence failed");
      return false;
    }
  }

  private logHandoffTransition(handoffId: string, state: HandoffState, details: Record<string, unknown>): void {
    this.logger.info({ handoffId, state, ...details }, "handoff_session lifecycle transition");
  }

  /**
   * The models a session may pick from: scoped models first, then the remaining
   * runtime catalogue. Refreshes first so callers see newly configured models.
   */
  private async sessionModelCandidates(session: PiAgentSession): Promise<readonly AgentModel[]> {
    await session.modelRuntime.refresh();
    return modelsWithScopeFirst(session.modelRuntime.getAvailableSnapshot(), session.scopedModels);
  }

  /**
   * Resolve a strict `provider/model-id` spec from a spawn tool against the
   * *spawning* session's model runtime, using the same candidates
   * {@link setModel} offers plus a direct runtime lookup as fallback. Unknown
   * or malformed specs throw; the agent loop turns that into an error tool
   * result the spawning agent can retry from.
   */
  /** Resolve `provider/model-id` against the shared runtime, with no session. */
  private async resolveNewSessionModel(modelSpec: string): Promise<AgentModel> {
    await this.modelRuntime.refresh();
    const parsed = parseModelSpec(modelSpec);
    const model = parsed === undefined
      ? undefined
      : this.modelRuntime.getAvailableSnapshot().find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.modelId)
        ?? this.modelRuntime.getModel(parsed.provider, parsed.modelId);
    if (model === undefined) throw unknownSpawnModelError(modelSpec);
    return model;
  }

  private async resolveSpawnModel(spawningRef: PiSessionRef, modelSpec: string): Promise<AgentModel> {
    const session = await this.getOrOpen(spawningRef);
    const parsed = parseModelSpec(modelSpec);
    const candidates = await this.sessionModelCandidates(session);
    const model = parsed === undefined
      ? undefined
      : candidates.find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.modelId)
        ?? session.modelRuntime.getModel(parsed.provider, parsed.modelId);
    if (model === undefined) throw unknownSpawnModelError(modelSpec);
    return model;
  }

  private async prepareDurableFamily(session: DurableAgentSession): Promise<boolean> {
    const harness = session.journal.harness;
    const pending = this.preparingFamilies.get(harness);
    if (pending !== undefined) {
      // A sibling bind is nested under the first parent's preparation. It must return without
      // resuming; the outer bind waits for every sibling, then resumes the family once.
      if (this.startupSessions.get(session.sessionId) === session) return false;
      await pending;
      return true;
    }
    const preparation = Promise.resolve().then(async () => {
      const inspection = await harness.inspect(durableContext);
      const bindings = await readSessionBindings(harness, durableContext);
      const required = new Set<number>();
      const ids = [...inspection.tasks.map((task) => task.record.conversationId), ...inspection.submissions.map((submission) => submission.conversationId)];
      await harness.commit(async (tx) => {
        for (const id of ids) {
          let current = id;
          const seen = new Set<ConversationId>();
          while (!seen.has(current)) {
            seen.add(current);
            const record = await tx.conversation(current);
            if (record === undefined) throw new Error("Pending work has no conversation");
            if (record.owner === undefined) { required.add(current); break; }
            current = record.owner.conversationId;
          }
        }
      }, durableContext);
      for (const [id, binding] of Object.entries(bindings.sessions)) {
        if (id === session.sessionId || !binding.retained.some((conversationId) => required.has(conversationId))) continue;
        await this.getOrOpen({ id, cwd: session.sessionManager.getCwd() });
      }
    });
    this.preparingFamilies.set(harness, preparation);
    try { await preparation; return true; }
    finally { this.preparingFamilies.delete(harness); }
  }

  private responseSession(sessionId: string): PiAgentSession {
    const session = this.active.get(sessionId)?.runtime.session ?? this.startupSessions.get(sessionId);
    if (session === undefined) throw new Error(`Session ${sessionId} has no runtime for a transcript mutation`);
    return session;
  }

  private appendResponseEvent(session: PiAgentSession, event: SessionResponseEvent): void {
    if (session instanceof DurableAgentSession) {
      void session.parentState.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, durableJson(event), durableContext)
        .then(async () => { await session.refreshParentAppState(); this.checkpointResponse(session); this.publishStatus(session); })
        .catch((error: unknown) => { this.logger.info({ sessionId: session.sessionId, error }, "Could not commit the parent response event"); });
      return;
    }
    if (session.sessionManager.appendCustomEntry === undefined) throw new Error("Session runtime cannot persist response declarations");
    session.sessionManager.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, event);
    this.checkpointResponse(session);
    this.sessionManager.invalidateSessionFile(session.sessionFile ?? "");
  }

  private responseProjection(session: PiAgentSession): ResponseProjection {
    if (session instanceof DurableAgentSession) return session.parentResponseProjection;
    const manager = session.sessionManager;
    const leafId = manager.getLeafId();
    const cached = this.responseMemo.get(manager);
    if (cached?.leafId === leafId) return cached.projection;
    const projection = responseFromBranch(manager.getBranch());
    this.responseMemo.set(manager, { leafId, projection });
    return projection;
  }

  private checkpointResponse(session: PiAgentSession): void {
    // The JSONL checkpoint is a catalog cache of committed native state, never delivery evidence.
    writeResponseCheckpoint(
      (type, data) => { session.sessionManager.appendCustomEntry?.(type, data); },
      this.responseProjection(session).response,
      (error) => { this.logger.info({ sessionId: session.sessionId, error }, "Could not persist the derived response checkpoint"); },
    );
    this.sessionManager.invalidateSessionFile(session.sessionFile ?? "");
  }

  /** Persist a validated question set before publishing it. The tool then ends the run. */
  async openAsk(input: AskUserInvocation): Promise<PendingAskOpenResult> {
    if (this.preparingHandoffDestinations.has(input.sessionId)) {
      throw new Error("Handoff destination cannot ask questions while preparing context.");
    }
    const session = this.active.get(input.sessionId)?.runtime.session ?? this.startupSessions.get(input.sessionId);
    const result = session instanceof DurableAgentSession ? await session.parentState.openAsk(input.questions, durableContext) : this.sessionAsks.open(input);
    if (session instanceof DurableAgentSession) await session.refreshParentAppState();
    if (session !== undefined) this.checkpointResponse(session);
    // A supersede closes the earlier ask, so the browsers watching it must hear
    // that before they hear about its replacement.
    if (result.superseded !== undefined) this.publishAskClosed(input.sessionId, result.superseded);
    this.events.publish(input.sessionId, { type: "ask.opened", ask: result.ask });
    this.publishStatusForSessionId(input.sessionId);
    return result;
  }

  /**
   * Record the user's answers to the session's open ask and hand them to the
   * model. The answers travel as a system-authored custom message rather than a
   * user message, so they are not attributed to the human in the transcript;
   * they still wake an idle session (`triggerTurn`) and queue behind in-flight
   * work (`deliverAs: "followUp"`), which is how the run that `ask_user`
   * terminated continues.
   */
  async submitAsk(ref: PiSessionRef, askId: string, submission: AskUserSubmission): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    // Checked before the store closes the ask so a refused delivery cannot
    // discard answers the user already submitted.
    this.assertTreeNavigationInactive(session, "answer questions");
    if (session instanceof DurableAgentSession) await this.prepareDurableFamily(session);
    const result = session instanceof DurableAgentSession ? await session.parentState.submitAsk(askId, submission, durableContext)
      : this.sessionAsks.submit(session.sessionId, askId, submission);
    if (session instanceof DurableAgentSession) await session.refreshParentAppState();
    return this.closeAsk(session, result);
  }

  /**
   * Close the open ask without answers. The model is still told, naming every
   * question as unanswered: it was promised a follow-up message and would
   * otherwise wait for one that never comes.
   */
  async cancelAsk(ref: PiSessionRef, askId: string): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    this.assertTreeNavigationInactive(session, "dismiss questions");
    if (session instanceof DurableAgentSession) await this.prepareDurableFamily(session);
    const result = session instanceof DurableAgentSession ? await session.parentState.cancelAsk(askId, durableContext)
      : this.sessionAsks.cancel(session.sessionId, askId);
    if (session instanceof DurableAgentSession) await session.refreshParentAppState();
    return this.closeAsk(session, result);
  }

  /**
   * Publish and deliver a closed ask. A stale close is reported rather than
   * thrown: losing the race against a supersede, another browser, or a session
   * that went away is ordinary, and the returned status tells the browser what
   * the session's open ask is now.
   */
  private async closeAsk(session: PiAgentSession, result: PendingAskCloseResult): Promise<AskUserCloseResponse> {
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishAskClosed(session.sessionId, outcome);
    // Durable commits the receipt and its Delivery task together. Only legacy runtimes need a notification.
    if (!(session instanceof DurableAgentSession)) await this.runSessionEntryMutation(session, "deliver answers to your questions", () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      { triggerTurn: true, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  private recoverAskAnswerDelivery(session: PiAgentSession): void {
    const outcomes = undeliveredAskAnswers(session.sessionManager.getBranch());
    if (outcomes.length === 0) return;
    void this.runSessionEntryMutation(session, "recover accepted question answers", async () => {
      if (session instanceof DurableAgentSession) {
        // Accepted SDK-only decisions are a compatibility import, not a second delivery path.
        // Native receipt/tasks own delivery once the parent documents exist. Never emit the
        // old triggerTurn notification as well as the deterministic Durable submission.
        const asks = await session.journal.harness.snapshot(ParentAsks, session.journal.conversation.id, durableContext);
        if (!Check(ParentAsksSchema, asks)) throw new Error("Invalid native accepted-answer receipts");
        for (const outcome of outcomes) {
          if (asks.closed[outcome.askId] !== undefined) continue;
          await session.parentState.appendCustomEntry(SESSION_RESPONSE_CUSTOM_TYPE, durableJson({ version: 1, kind: "answered", outcome }), durableContext);
        }
        await session.flushDurableMutations();
        await this.prepareDurableFamily(session);
        session.journal.harness.resume();
        return;
      }
      for (const outcome of outcomes) {
        await session.sendCustomMessage(
          { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }
    }).catch((error: unknown) => {
      this.logger.info({ sessionId: session.sessionId, error }, "accepted question answers could not be recovered");
    });
  }

  private publishAskClosed(sessionId: string, outcome: AskUserOutcome): void {
    this.events.publish(sessionId, { type: "ask.closed", askId: outcome.askId, reason: outcome.reason });
  }

  /**
   * Void the session's open ask because the user sent a chat message instead of
   * answering it. Every browser closes the card as answered in chat — not as a
   * cancel, which the user never performed — and the model is told without being
   * woken, so the notice rides into the turn the message itself triggers rather
   * than becoming a turn of its own.
   */
  private async voidOpenAskForUserMessage(session: PiAgentSession): Promise<void> {
    const outcome = session instanceof DurableAgentSession ? await session.parentState.voidForChatReply(durableContext)
      : this.sessionAsks.voidForChatReply(session.sessionId);
    if (session instanceof DurableAgentSession) await session.refreshParentAppState();
    if (outcome === undefined) return;
    this.publishAskClosed(session.sessionId, outcome);
    if (!(session instanceof DurableAgentSession)) await this.runSessionEntryMutation(session, "void the open questions", () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      { triggerTurn: false, deliverAs: "followUp" },
    ));
    this.publishStatus(session);
  }

  /**
   * Record the user's answer to an open extension dialog and resolve the
   * extension's parked Promise with it. Unlike an ask, nothing is delivered to
   * the model: the waiter is extension code inside an already in-flight run
   * (or an idle handler), so no custom message and no turn are triggered.
   */
  async answerDialog(ref: PiSessionRef, dialogId: string, value: ExtensionDialogAnswer): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    const result = this.pendingExtensionDialogStore.answer(session.sessionId, dialogId, value);
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishDialogClosed(session.sessionId, outcome);
    // `value` is what the store validated and recorded as the outcome's answer.
    this.dialogWaiters.settleWithAnswer(dialogId, value);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /** Close an open extension dialog without an answer; the extension's wait settles with its kind's cancel value. */
  async cancelDialog(ref: PiSessionRef, dialogId: string): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    const result = this.pendingExtensionDialogStore.cancel(session.sessionId, dialogId, "cancelled");
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishDialogClosed(session.sessionId, outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /**
   * Implement one `ctx.ui.select()`/`confirm()`/`input()` call from extension
   * code: open the store record, tell the browsers, and park a Promise that
   * settles when the browser answers or cancels, the extension's own
   * `signal`/`timeout` dismisses the dialog, the daemon default timeout
   * elapses, or the runtime goes away. `store.open` validates the dialog, so a
   * malformed one rejects the extension's call rather than rendering garbage.
   * `async` so a rejected dialog becomes a rejection rather than a synchronous
   * throw from a promise-returning method.
   */
  private async openExtensionDialog(
    session: PiAgentSession,
    request: { kind: ExtensionDialogKind; title: string; message?: string | undefined; options?: string[] | undefined; placeholder?: string | undefined },
    opts: ExtensionUIDialogOptions | undefined,
  ): Promise<boolean | string | undefined> {
    if (this.detachedHandoffStartupSessions.has(session)) return extensionDialogCancelValue(request.kind);
    this.assertHandoffDestinationAcceptsInput(session);
    const signal = opts?.signal;
    // A pre-aborted signal dismisses the dialog before it ever opens.
    if (signal?.aborted === true) return extensionDialogCancelValue(request.kind);
    const timeoutMs = effectiveExtensionDialogTimeoutMs(opts?.timeout, this.extensionDialogsTimeoutMs);
    const dialog = this.pendingExtensionDialogStore.open({
      sessionId: session.sessionId,
      kind: request.kind,
      title: request.title,
      ...(request.message === undefined ? {} : { message: request.message }),
      ...(request.options === undefined ? {} : { options: request.options }),
      ...(request.placeholder === undefined ? {} : { placeholder: request.placeholder }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      runScoped: session.isStreaming,
    });
    this.events.publish(session.sessionId, { type: "dialog.opened", dialog });
    this.publishStatus(session);
    return this.dialogWaiters.park(dialog, {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(signal === undefined ? {} : { signal }),
      onTrigger: (reason) => {
        if (this.closeExtensionDialogFromTrigger(session.sessionId, dialog.dialogId, reason)) this.publishStatusForSessionId(session.sessionId);
      },
    });
  }

  /**
   * Close a dialog whose wait ended without the browser (timeout, signal
   * abort, run end, runtime teardown) and settle its parked Promise. Returns
   * whether this call closed the dialog; a stale close means a browser answer
   * or an earlier trigger already settled everything.
   */
  private closeExtensionDialogFromTrigger(sessionId: string, dialogId: string, reason: ExtensionDialogCancelReason): boolean {
    const result = this.pendingExtensionDialogStore.cancel(sessionId, dialogId, reason);
    if (result.status !== "closed") return false;
    this.publishDialogClosed(sessionId, result.outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    return true;
  }

  /**
   * Settle the session's run-scoped dialogs as `"aborted"`. Runs at
   * abort-request time (a user abort parks the agent loop behind the dialog
   * handler, so `agent_end` would never arrive on its own) and again from
   * the `agent_end` observer as the run-crash backstop — the store makes the
   * second settlement a stale no-op. Idle-opened dialogs (a `session_start`
   * probe, say) are not run-scoped and survive, because their waiter
   * outlives the run.
   */
  private abortRunScopedExtensionDialogs(sessionId: string): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(sessionId)) {
      if (dialog.runScoped) closedAny = this.closeExtensionDialogFromTrigger(sessionId, dialog.dialogId, "aborted") || closedAny;
    }
    if (closedAny) this.publishStatusForSessionId(sessionId);
  }

  /**
   * Settle every dialog of the session as `"session-ended"`: the runtime
   * whose extension code is parked on them is being closed, replaced, or
   * disposed, so those Promises would otherwise never settle.
   */
  private endSessionExtensionDialogs(sessionId: string): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(sessionId)) {
      closedAny = this.closeExtensionDialogFromTrigger(sessionId, dialog.dialogId, "session-ended") || closedAny;
    }
    // Publishes only while the session is still (or already re-)registered as
    // active, so teardown paths stay silent and runtime replacement refreshes.
    if (closedAny) this.publishStatusForSessionId(sessionId);
  }

  private publishDialogClosed(sessionId: string, outcome: ExtensionDialogOutcome): void {
    this.events.publish(sessionId, {
      type: "dialog.closed",
      dialogId: outcome.dialogId,
      reason: outcome.reason,
      ...(outcome.answer === undefined ? {} : { answer: outcome.answer }),
    });
  }

  /**
   * Publish status for a session known only by id, as the ask tools are: they
   * run inside the session's own runtime, so the active entry is the session.
   */
  private publishStatusForSessionId(sessionId: string): void {
    const session = this.active.get(sessionId)?.runtime.session;
    if (session !== undefined) this.publishStatus(session);
  }

  private async parentLinkHasValidChildTarget(parentSessionFile: string, link: PersistedParentSubsessionLink): Promise<boolean> {
    return link.spawnedSessionFile !== undefined
      && await sessionFileHeaderMatches(link.spawnedSessionFile, { sessionId: link.spawnedSessionId, parentSessionFile });
  }

  private async excludeVerifiedHistoricalChildFromUnread(session: PiAgentSession): Promise<void> {
    // Old transcripts retain their exact parent link and unread exclusion, but
    // reopening one never starts a worker or sends completion notices.
    const link = await verifiedTrackedSubsessionLink(this.sessionManager, {
      sessionId: session.sessionId, sessionFile: session.sessionFile,
      sessionManager: session.sessionManager, cwd: session.sessionManager.getCwd(),
    });
    if (link !== undefined) await this.publishUnreadMutations(this.unreadStore.excludeSession(
      session.sessionId, canonicalizeStoredCwd(session.sessionManager.getCwd()),
    ));
  }

  async inspectPullSession(ref: PullSessionRef): Promise<PullSessionState> {
    const target = await this.resolvePinTarget(ref);
    const archived = await this.getArchived(ref);
    if (target === undefined && archived === undefined) return { ref, exists: false, available: false, settled: false, leaf: null };
    const resolved = target !== undefined ? { id: target.sessionId, cwd: target.cwd } : archived !== undefined ? { id: archived.sessionId, cwd: archived.cwd } : ref;
    if (resolved.id !== ref.id || canonicalizeStoredCwd(resolved.cwd) !== canonicalizeStoredCwd(ref.cwd)) throw new Error("Use the full session id and its own workspace.");
    const manager = await this.historySessionManager(ref);
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    const response = responseFromBranch(manager.getBranch()).response;
    const active = this.activeForRef(ref)?.runtime.session;
    const settled = response.kind === "needs-response" && (response.reason !== "undeclared" || active === undefined || !this.hasActiveWork(active));
    return { ref: resolved, exists: true, available: archived === undefined && readonly === undefined, settled, leaf: manager.getLeafId() };
  }

  async wakePullSession(ref: PullSessionRef, notice: { id: string; text: string }, stillCurrent: () => boolean, customType: "forgerie:pull-request" | "forgerie:action-run" = "forgerie:pull-request"): ReturnType<PullSessionGateway["wake"]> {
    const state = await this.inspectPullSession(ref);
    if (!state.available || !stillCurrent()) return "busy";
    const session = await this.getOrOpen(ref);
    if (!(await this.inspectPullSession(ref)).available) return "busy";
    const alreadyDelivered = session.sessionManager.getBranch().some((entry) => isRecord(entry) && entry["type"] === "custom_message" && entry["customType"] === customType && getString(entry["details"], "noticeId") === notice.id);
    if (alreadyDelivered) return "delivered";
    // Do not put news in Pi's in-memory follow-up queue. The durable pending record survives restarts while busy.
    if (!stillCurrent() || this.hasActiveWork(session) || this.preparingHandoffDestinations.has(session.sessionId)) return "busy";
    // Pi's Promise lasts for the entire agent turn. Do not block other GitHub polls on that turn.
    // Keep the outbox record until the next poll observes this notice in the transcript.
    void this.runSessionEntryMutation(session, `deliver ${customType} activity`, () => session.sendCustomMessage(
      { customType, content: notice.text, display: true, details: { noticeId: notice.id } },
      { triggerTurn: true, deliverAs: "followUp" },
    )).then(
      () => { this.publishStatus(session); },
      (error: unknown) => { this.logger.info({ error, sessionId: session.sessionId, noticeId: notice.id }, "GitHub activity delivery failed"); this.publishStatus(session); },
    );
    this.publishStatus(session);
    return "busy";
  }

  /**
   * A user's pull request action from outside the chat, written into the transcript.
   * No turn starts. During a run Pi holds it until the turn ends, so it never lands
   * between a tool call and its result.
   */
  async notePullSession(ref: PullSessionRef, note: PullNote): Promise<void> {
    if (!(await this.inspectPullSession(ref)).available) return;
    const session = await this.getOrOpen(ref);
    await this.runSessionEntryMutation(session, "note PR action", () => session.sendCustomMessage(
      { customType: "forgerie:pull-request", content: note.text, display: true, details: note.details },
      { triggerTurn: false },
    ));
    this.publishStatus(session);
  }

  publishPullWatchStatus(id: string): void { this.publishStatusForSessionId(id); }

  async durableTasks(ref: PiSessionRef): Promise<TaskActivity> {
    const active = this.activeForRef(ref)?.runtime.session;
    if (active instanceof DurableAgentSession) return active.taskActivity();
    if (active !== undefined) return { kind: "unsupported" };
    const native = await this.durableReader?.tasks(ref);
    if (native?.kind === "ready") return native;
    // Establish existence without opening a runtime or reading/importing a legacy transcript.
    if (await this.getArchived(ref) === undefined && await this.sessionWorktrees?.store.readOnly(ref) === undefined
      && await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader) === undefined) throw new Error("Session not found");
    return { kind: "unsupported" };
  }

  /** The server half of "open a child". Each call reaches the child through the parent's Durable storage. */
  async durableChildren(ref: PiSessionRef) {
    const worktrees = this.childReadWorktrees === undefined ? undefined : new DurableChildWorktrees(this.childReadWorktrees, ref);
    const native = await this.durableReader?.children(ref, worktrees);
    if (native !== undefined) return native;
    const active = this.activeForRef(ref)?.runtime.session;
    if (active instanceof DurableAgentSession) return active.durableChildren();
    const saved = await this.savedChildSession(ref);
    return readSavedChild(saved.path, saved.id, (storage, parent) => listStoredChildren(storage, parent, childReadContext, worktrees));
  }
  async reviewDurableChildWorktree(ref: PiSessionRef, conversationId: number) { return (await this.durableSession(ref)).reviewDurableChildWorktree(conversationId); }
  async continueDurableChild(ref: PiSessionRef, conversationId: number, text: string, requestId: string) { return (await this.durableSession(ref)).continueDurableChild(conversationId, text, requestId); }
  async landDurableChildWorktree(ref: PiSessionRef, conversationId: number) { return (await this.durableSession(ref)).landDurableChildWorktree(conversationId); }
  async previewDurableChildWorktreeDiscard(ref: PiSessionRef, conversationId: number) { return (await this.durableSession(ref)).previewDurableChildWorktreeDiscard(conversationId); }
  async discardDurableChildWorktree(ref: PiSessionRef, conversationId: number, confirmationToken: string) { return (await this.durableSession(ref)).discardDurableChildWorktree(conversationId, confirmationToken); }
  async durableChildMessages(ref: PiSessionRef, conversationId: number) {
    const native = await this.durableReader?.childMessages(ref, conversationId);
    if (native !== undefined) return native;
    const active = this.activeForRef(ref)?.runtime.session;
    if (active instanceof DurableAgentSession) return active.durableChildMessages(conversationId);
    const saved = await this.savedChildSession(ref);
    return readSavedChild(saved.path, saved.id, (storage, parent) => storedChildMessages(storage, parent, conversationId, childReadContext));
  }
  private async savedChildSession(ref: PiSessionRef): Promise<{ id: string; path: string }> {
    // Native journals stay beside the original transcript path when its JSONL is moved or copied.
    const archived = await this.getArchived(ref);
    if (archived !== undefined) {
      if (archived.originalPath === undefined || archived.originalPath === "") throw new Error("Archived session is missing its original path for child reads");
      return { id: archived.sessionId, path: archived.originalPath };
    }
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) {
      if (readonly.session.path === "") throw new Error("Retained session is missing its original path for child reads");
      return { id: readonly.session.id, path: readonly.session.path };
    }
    const saved = await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader);
    if (saved === undefined) throw new Error("Session not found");
    return saved;
  }
  async messageDurableChild(ref: PiSessionRef, conversationId: number, text: string) { await (await this.durableSession(ref)).messageDurableChild(conversationId, text); }
  async stopDurableChild(ref: PiSessionRef, conversationId: number) { await (await this.durableSession(ref)).stopDurableChild(conversationId); }
  async answerDurableChildQuestion(ref: PiSessionRef, questionId: string, answer: string) { await (await this.durableSession(ref)).answerDurableChildQuestion(questionId, answer); }
  async gatedActions(ref: PiSessionRef) {
    const session = await this.getOrOpen(ref);
    return session instanceof DurableAgentSession ? session.gatedActions() : [];
  }
  async decideGatedAction(ref: PiSessionRef, id: string, choice: "approved" | "refused") {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    if (!(session instanceof DurableAgentSession)) throw new Error("This session does not host Durable gated actions");
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "decide a gated action", () => session.decideGatedAction(id, choice));
  }
  async decisions(ref: PiSessionRef) {
    const session = await this.getOrOpen(ref);
    return session instanceof DurableAgentSession ? session.decisions() : [];
  }
  async confirmDecision(ref: PiSessionRef, id: string) {
    await this.assertWritable(ref);
    this.assertSessionOpenAllowed(() => false);
    // Opening an inactive runtime resumes its family. Review alone must never do that.
    const session = this.activeForRef(ref)?.runtime.session;
    if (session === undefined) {
      const startup = this.startupSessionForRef(ref);
      if (startup !== undefined) this.assertHandoffDestinationAcceptsInput(startup);
      if (await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader) === undefined) throw new WorkflowError(404, "Session not found");
      throw new WorkflowError(409, "Open this session before confirming the guess.");
    }
    if (!(session instanceof DurableAgentSession) || !session.hostsDurableChildren) throw new WorkflowError(404, "This session does not host child agents");
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "confirm a decision", () => session.confirmDecision(id));
  }
  async overturnDecision(ref: PiSessionRef, id: string, note: string) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "overturn a decision", () => session.overturnDecision(id, note));
  }
  async workflowInventory(ref: PiSessionRef) { await this.getOrOpen(ref); return new WorkflowLibrary(this.agentDir).list(ref.cwd); }
  async workflowProposals(ref: PiSessionRef) {
    const session = await this.getOrOpen(ref);
    return session instanceof DurableAgentSession && session.hostsDurableChildren ? session.workflowProposals() : [];
  }
  async startWorkflowProposal(ref: PiSessionRef, id: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "start a workflow proposal", () => session.startWorkflowProposal(id, inputs, requestId, models));
  }
  async changeWorkflowProposal(ref: PiSessionRef, id: string, note: string) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "ask for workflow proposal changes", () => session.changeWorkflowProposal(id, note));
  }
  async dismissWorkflowProposal(ref: PiSessionRef, id: string) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    return this.runSessionEntryMutation(session, "dismiss a workflow proposal", () => session.dismissWorkflowProposal(id));
  }
  async doWorkflowProposalHere(ref: PiSessionRef, id: string, inputs: WorkflowInputs) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "do a workflow proposal here", () => session.doWorkflowProposalHere(id, inputs));
  }
  async workflowRuns(ref: PiSessionRef) { return (await this.durableSession(ref)).workflowRuns(); }
  async runWorkflow(ref: PiSessionRef, name: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    return this.runSessionEntryMutation(session, "launch a workflow", () => session.runWorkflow(name, inputs, requestId, models));
  }
  async cancelWorkflow(ref: PiSessionRef, runId: string) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    return this.runSessionEntryMutation(session, "stop a workflow", () => session.cancelWorkflow(runId));
  }
  async finishWorkflow(ref: PiSessionRef, runId: string, outcome: WorkflowOutcome, result: string) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    return this.runSessionEntryMutation(session, "finish a workflow", () => session.finishWorkflow(runId, outcome, result));
  }
  async setWorkflowWorkerModel(ref: PiSessionRef, runId: string, worker: string, model: string | null) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    return this.runSessionEntryMutation(session, "change a workflow worker model", () => session.setWorkflowWorkerModel(runId, worker, model));
  }
  async decideWorkflowStop(ref: PiSessionRef, runId: string, stage: string, decision: WorkflowStopDecision, note: string | undefined) {
    await this.assertWritable(ref);
    const session = await this.durableSession(ref);
    return this.runSessionEntryMutation(session, "decide at a workflow stop", () => session.decideWorkflowStop(runId, stage, decision, note));
  }
  async copyWorkflow(ref: PiSessionRef, name: string, destination: string) {
    await this.assertWritable(ref);
    const workflow = await new WorkflowLibrary(this.agentDir).read(ref.cwd, name);
    return new AgentDirPromptLibrary(this.agentDir).save({ name: destination, body: workflow.text });
  }
  private async durableSession(ref: PiSessionRef): Promise<DurableAgentSession> {
    const session = await this.getOrOpen(ref);
    if (!(session instanceof DurableAgentSession) || !session.hostsDurableChildren) throw new Error("This session does not host child agents");
    return session;
  }

  /** Reopen unfinished parent, child and workflow work from Durable state before cleanup, without browser requests. */
  resumeDurableSessions(repair: readonly PiSessionRef[] = [], stopped: () => boolean = () => false): Promise<DurableRecoveryReport> {
    return recoverDurableSessions({
      catalog: () => this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll(),
      repair,
      stopped: () => this.stopping || stopped(),
      available: async (ref) => this.activeForRef(ref) === undefined
        && await this.getArchived(ref) === undefined
        && await this.sessionWorktrees?.store.readOnly(ref) === undefined,
      reopen: async (ref) => {
        await this.assertWritable(ref);
        if (!this.stopping && !stopped()) await this.getActive(ref, {}, stopped);
      },
    });
  }

  async searchMessagePositions(ref: PiSessionRef): Promise<ReadonlyMap<string, number>> {
    const positions = new Map<string, number>();
    const entryIds = new Map<number, string>();
    const messages = historyMessages(await this.historySessionManager(ref), (entryId, rawPosition) => { entryIds.set(rawPosition, entryId); });
    // Use the unpaged browser projection itself: paging still uses raw offsets,
    // but search targets the indices in the array the browser actually receives.
    projectBrowserMessageResponse({ messages, start: 0, total: messages.length }, (rawPosition, projectedPosition) => {
      const entryId = entryIds.get(rawPosition);
      if (entryId !== undefined) positions.set(entryId, projectedPosition);
    });
    return positions;
  }

  /** Production native admission is active-only. A reader never chooses execution options. */
  activeDurableRead(ref: PiSessionRef): { address: DurableSessionAddress; sessionFile: string | undefined } | undefined {
    const session = this.activeForRef(ref)?.runtime.session;
    return session instanceof DurableAgentSession ? { address: session.durableAddress, sessionFile: session.sessionFile } : undefined;
  }

  async attachOpenBrowser(ref: PiSessionRef, send: (open: SessionOpenResult) => Promise<void>, onFailure: (error: Error) => void): Promise<DurableBrowserAttachment | undefined> {
    if (this.durableReader === undefined) throw new Error("Native Durable browser reads are not configured");
    return this.durableReader.attachOpen(ref, this.events, send, onFailure, () => {
      const session = this.activeForRef(ref)?.runtime.session;
      return this.nativeHostState(session);
    });
  }

  async sessionImage(ref: PiSessionRef, messageId: string, image: number): Promise<SessionImage | undefined> {
    return await this.durableReader?.image(ref, messageId, image) ?? undefined;
  }

  async attachDurableBrowser(ref: PiSessionRef, send: (snapshot: DurableBrowserSnapshot) => Promise<void>, onFailure: (error: Error) => void): Promise<DurableBrowserAttachment> {
    if (this.durableReader === undefined) throw new Error("Native Durable browser reads are not configured");
    return this.durableReader.attach(ref, send, onFailure);
  }

  /** Preparation may await. The active classic cut below must not. */
  async open(ref: PiSessionRef, page: SessionOpenPageRequest, trace?: StackLatencyContext): Promise<SessionOpenResult> {
    const phase = <T>(name: StackLatencySpan["phase"], run: (inner?: StackLatencyContext) => Promise<T>): Promise<T> => trace === undefined ? run() : trace.measure(name, run);
    const { active, nativeAddress, catalog, readonly, archived, worktreeInfo } = await phase("admission", async () => {
      // Freeze admission before preparation. A stopped native owner is an error, not a fallback.
      const active = this.activeForRef(ref)?.runtime.session;
      const nativeAddress = await this.durableReader?.locate(ref);
      if (active instanceof DurableAgentSession) await active.flushDurableMutations();
      const catalog = await this.unreadCatalog(); // Capture before any transcript acquisition.
      const readonly = await this.sessionWorktrees?.store.readOnly(ref);
      const archived = await this.getArchived(ref);
      const worktree = await this.sessionWorktrees?.store.forSession(ref);
      const worktreeInfo = worktree === undefined ? undefined : await this.sessionWorktrees?.info(worktree, ref.id);
      return { active, nativeAddress, catalog, readonly, archived, worktreeInfo };
    });
    const receiptFor = (id: string, cwd: string) => {
      const unread = catalog.sessions.find(item => item.sessionId === id && item.cwd === canonicalizeStoredCwd(cwd));
      return unread === undefined ? null : { catalogId: catalog.catalogId, throughCompletionOrder: unread.completionOrder };
    };
    const native = nativeAddress === undefined ? undefined : await phase("storage-read", async inner => await this.durableReader?.openAddress(ref, nativeAddress, page, this.events, () => {
      const session = this.activeForRef(ref)?.runtime.session;
      const host = this.nativeHostState(session);
      return { ...host, status: { ...host.status,
        ...(readonly === undefined && archived === undefined ? {} : { readOnly: true }),
        ...(worktreeInfo === undefined ? {} : { worktree: worktreeInfo }) } };
    }, inner));
    if (native !== undefined) {
      const projected = trace?.start("projection");
      const result = { ...native, page: { ...native.page, messages: withImageReferences(ref, native.page.messages) },
        receipt: receiptFor(native.session.id, native.session.cwd) };
      projected?.();
      return result;
    }
    const inactiveClassic = this.durableReader !== undefined && nativeAddress === undefined && active === undefined;
    if (readonly !== undefined || archived !== undefined || inactiveClassic) {
      const match = inactiveClassic && readonly === undefined && archived === undefined
        ? await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader) : undefined;
      const path = readonly?.transcriptPath ?? archived?.archivePath ?? match?.path;
      if (path === undefined) throw new SessionOpenError("Saved session history is unavailable", 503, "OPEN_UNAVAILABLE");
      for (let attempt = 0; attempt < 3; attempt++) {
        const { before, manager, after } = await phase("storage-read", async () => {
          const before = await stat(path);
          const manager = await (this.sessionManager.openReadOnly?.(path) ?? this.sessionManager.open(path));
          return { before, manager, after: await stat(path) };
        });
        if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
        const messages = this.openMessages(manager);
        const id = manager.getSessionId(), cwd = manager.getCwd();
        const status: ClientSessionStatus = { sessionId: id, ...(readonly === undefined && archived === undefined ? {} : { readOnly: true }), persisted: true, isStreaming: false, isCompacting: false,
          isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], messageCount: messages.length, ...savedTranscriptUsage(messages),
          ...(worktreeInfo === undefined ? {} : { worktree: worktreeInfo }) };
        // A file-only seed cannot cover the activated owner's partial, queues or dialogs.
        // Do not stamp its new event watermark onto an envelope that omits that state.
        if (inactiveClassic && this.activeForRef(ref) !== undefined) throw new SessionOpenError("Session activated during open; retry admission", 409, "READ_PATH_CHANGED");
        return this.classicOpenCut(id, cwd, messages, null, status, page, receiptFor(id, cwd));
      }
      throw new SessionOpenError("Saved history changed during open", 503, "OPEN_UNAVAILABLE");
    }
    const session = active ?? await this.getOrOpen(ref);
    if (session instanceof DurableAgentSession) {
      // This cohort still exports SDK callback state. It has no event-line drain seam, and
      // project() can advance its branch before applyEvent updates the partial and emits.
      // Preserve today's acquisition order and label it explicitly; never claim this is atomic.
      await session.flushDurableMutations();
      const messages = this.openMessages(session.sessionManager);
      const snapshot = await this.streamSnapshot(ref);
      const transientEvents = this.events.transientEvents(session.sessionId);
      const statusSeq = this.events.currentSeq(session.sessionId);
      const status = await this.status(ref);
      const partial = snapshot.partial === null ? null : openMessageSchema.parse(snapshot.partial);
      const result = this.classicOpenCut(session.sessionId, session.sessionManager.getCwd(), messages, partial, status, page,
        receiptFor(session.sessionId, session.sessionManager.getCwd()));
      return { ...result, cut: "sequential", statusSeq, seq: snapshot.seq, snapshot: { ...result.snapshot, seq: snapshot.seq, transientEvents } };
    }
    // Worktree/file/unread preparation is complete. All values below share one synchronous tick.
    const projected = trace?.start("projection");
    const messages = this.openMessages(session.sessionManager);
    const streaming = session.state.streamingMessage;
    const partial = streaming == null ? null : openMessageSchema.parse(annotateAssistantThinkingLevel(projectBrowserMessage(streaming), session.thinkingLevel));
    const status = { ...this.statusFromSession(session), ...(worktreeInfo === undefined ? {} : { worktree: worktreeInfo }) };
    const cut = this.classicOpenCut(session.sessionId, session.sessionManager.getCwd(), messages, partial, status, page, receiptFor(session.sessionId, session.sessionManager.getCwd()));
    projected?.();
    return cut;
  }

  private openMessages(manager: PiSessionManager): SessionOpenMessage[] {
    const ids: string[] = [];
    const raw = historyMessages(manager, (id, position) => { ids[position] = id; });
    const visible: SessionOpenMessage[] = [];
    projectBrowserMessageResponse({ messages: raw, start: 0, total: raw.length }, (position) => {
      visible.push(openMessageSchema.parse({ ...openMessageSchema.parse(projectBrowserMessage(raw[position])), ...(ids[position] === undefined ? {} : { id: ids[position] }) }));
    });
    return structuredClone(visible);
  }

  private classicOpenCut(id: string, cwd: string, messages: SessionOpenMessage[], partial: SessionOpenMessage | null, status: ClientSessionStatus,
    page: SessionOpenPageRequest, receipt: SessionOpenResult["receipt"]): SessionOpenResult {
    const historyId = this.presentationHistory.identify(JSON.stringify([cwd, id]), messages);
    assertHistoryIdentity(historyId, page.historyId);
    const seq = this.events.currentSeq(id);
    this.events.savedHostOutput(id, messages);
    return structuredClone({ session: { id, cwd }, readPath: "classic", cut: "classic", epoch: this.events.epoch, seq, historyId,
      page: pageMessagesAtSafeBoundary(messages, { ...page, completeTurns: true }),
      snapshot: { seq, partial, tools: [], transientEvents: this.events.transientEvents(id) }, status, receipt });
  }

  async earlier(ref: PiSessionRef, page: { before: number; limit: number; historyId: string }): Promise<SessionOpenHistoryPage> {
    const opened = await this.open(ref, page);
    return { ...opened.page, historyId: opened.historyId, epoch: opened.epoch, seq: opened.seq };
  }

  async messages(ref: PiSessionRef, page?: { before?: number; limit?: number }): Promise<ClientMessagePage> {
    const native = await this.durableReader?.messages(ref, page);
    if (native !== undefined) return { ...native, messages: withImageReferences(ref, native.messages) };
    const sessionManager = await this.historySessionManager(ref);
    return pageMessagesAtSafeBoundary(historyMessages(sessionManager), page);
  }

  async tree(ref: PiSessionRef): Promise<SessionTreeResponse> {
    const native = await this.durableReader?.tree(ref);
    if (native !== undefined) return { tree: native };
    const active = this.activeForRef(ref)?.runtime.session;
    if (active instanceof DurableAgentSession) return { tree: await active.getDurableTree() };
    const manager = await this.historySessionManager(ref, (path) => {
      if (this.sessionManager.openReadOnly === undefined) throw new Error("Read-only session loading is not available with this Pi runtime");
      return this.sessionManager.openReadOnly(path);
    });
    if (manager.getTree === undefined) throw new Error("Session tree is not available with this Pi runtime");
    return { tree: projectSessionTree(manager.getTree(), manager.getLeafId()) };
  }

  async status(ref: PiSessionRef): Promise<ClientSessionStatus> {
    const worktrees = this.sessionWorktrees;
    const readonly = await worktrees?.store.readOnly(ref);
    if (readonly !== undefined && worktrees !== undefined) {
      const messages = historyMessages(await this.historySessionManager(ref));
      const worktree = await this.sessionWorktrees?.store.forSession(ref);
      return {
        sessionId: readonly.session.id, readOnly: true, persisted: true,
        ...(worktree === undefined ? {} : { worktree: await worktrees.info(worktree, readonly.session.id) }),
        isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0,
        queuedMessages: [], messageCount: messages.length,
        ...savedTranscriptUsage(messages),
      };
    }
    const session = await this.sessionForStatusOrDialogClose(ref);
    if (session instanceof DurableAgentSession) { await session.refreshDurableReads(); await session.refreshParentAppState(); }
    const status = this.statusFromSession(session);
    const worktree = await this.sessionWorktrees?.store.forSession(ref);
    return worktree === undefined || worktrees === undefined ? status : { ...status, worktree: await worktrees.info(worktree, status.sessionId) };
  }

  async processes(ref: PiSessionRef): Promise<ManagedProcessesSnapshot> {
    const panel = this.processPanels.get((await this.getActive(ref)).runtime.session.sessionId);
    return panel?.snapshot() ?? { available: false, writeSupported: false, processes: [] };
  }

  async processOutput(ref: PiSessionRef, id: string, tailLines?: number): Promise<ManagedProcessOutputResult> {
    const panel = this.processPanels.get((await this.getActive(ref)).runtime.session.sessionId);
    return panel?.output(id, tailLines) ?? { ok: false, reason: "unavailable" };
  }

  async killProcess(ref: PiSessionRef, id: string): Promise<ManagedProcessKillResult> {
    const panel = this.processPanels.get((await this.getActive(ref)).runtime.session.sessionId);
    return panel?.kill(id) ?? { ok: false, reason: "unavailable" };
  }

  async writeProcess(ref: PiSessionRef, id: string, input: string, end?: boolean): Promise<ManagedProcessWriteResult> {
    const panel = this.processPanels.get((await this.getActive(ref)).runtime.session.sessionId);
    return panel?.write(id, input, end) ?? { ok: false, reason: "unavailable" };
  }

  /**
   * Join-time snapshot of the in-flight assistant stream. The `seq` watermark and
   * the partial are read together in one synchronous tick (no await between the
   * `currentSeq` read and the `state.streamingMessage` read) so a joining client
   * can seed the partial and then apply only buffered live events with
   * `seq > snapshot.seq`. The partial is browser-projected to strip thinking
   * signatures; it is `null` when no assistant message is mid-stream.
   */
  async streamSnapshot(ref: PiSessionRef): Promise<SessionStreamSnapshot> {
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) return { seq: this.events.currentSeq(readonly.session.id), partial: null };
    const session = await this.getOrOpen(ref);
    // Single consistent tick: capture the watermark and the partial together so
    // the seq matches the partial the client seeds against.
    const seq = this.events.currentSeq(session.sessionId);
    const streamingMessage = session.state.streamingMessage;
    const partial = streamingMessage === undefined || streamingMessage === null
      ? null
      : annotateAssistantThinkingLevel(projectBrowserMessage(streamingMessage), session.thinkingLevel);
    return { seq, partial };
  }

  /**
   * Models available before any session exists.
   *
   * The runtime is a service dependency, not a property of a session, so a
   * composer with no session yet can still offer a choice. A session narrows
   * this only when its workspace scopes the agent profile.
   */
  async availableModelsForNewSession(cwd: string): Promise<ClientNewSessionModelSelection> {
    await this.modelRuntime.refresh();
    const candidates = this.modelRuntime.getAvailableSnapshot();
    const settings = SettingsManager.create(cwd, this.agentDir);
    const scopedModels = await resolveEnabledModels(settings, this.modelRuntime);
    const orderedModels = modelsWithScopeFirst(candidates, scopedModels);
    const selected = resolveNewSessionDefaultModel(
      orderedModels,
      scopedModels,
      settings.getDefaultProvider(),
      settings.getDefaultModel(),
    );
    const requestedThinkingLevel = selected?.thinkingLevel ?? settings.getDefaultThinkingLevel() ?? "medium";
    const model = selected?.model;
    const thinkingLevel = model === undefined ? "off" : clampThinkingLevel(model, requestedThinkingLevel);
    return {
      models: clientModelsWithScope(orderedModels, scopedModels),
      ...(model === undefined ? {} : { model: modelToClientModel(model) }),
      thinkingLevel,
    };
  }

  async availableModels(ref: PiSessionRef): Promise<ClientSessionModel[]> {
    const session = await this.getOrOpen(ref);
    const models = await this.sessionModelCandidates(session);
    return clientModelsWithScope(models, session.scopedModels);
  }

  async setModel(ref: PiSessionRef, provider: string, modelId: string): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    this.assertTreeNavigationInactive(session, "change models");
    const candidates = await this.sessionModelCandidates(session);
    this.assertTreeNavigationInactive(session, "change models");
    const model = candidates.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      ?? session.modelRuntime.getModel(provider, modelId);
    if (model === undefined) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.runSessionEntryMutation(session, "change models", () => session.setModel(model));
    this.publishActivity(session, `model: ${model.id}`, "idle", model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleModel(ref: PiSessionRef, direction: "forward" | "backward"): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    const result = await this.runSessionEntryMutation(session, "change models", () => session.cycleModel(direction));
    if (result === undefined) throw new Error(session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available");
    this.publishActivity(session, `model: ${result.model.id}`, "idle", result.model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async availableThinkingLevels(ref: PiSessionRef): Promise<ClientThinkingLevel[]> {
    const session = await this.getOrOpen(ref);
    return session.getAvailableThinkingLevels();
  }

  async setThinkingLevel(ref: PiSessionRef, level: string): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    this.assertTreeNavigationInactive(session, "change the thinking level");
    // pi owns the valid set; validate against the session's live levels rather
    // than a hardcoded union so this stays correct if pi changes the set.
    const available = session.getAvailableThinkingLevels();
    const match = available.find((candidate) => candidate === level);
    if (match === undefined) throw new Error(`Invalid thinking level: ${level}`);
    session.setThinkingLevel(match);
    this.publishActivity(session, `thinking: ${session.thinkingLevel}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleThinkingLevel(ref: PiSessionRef): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    this.assertTreeNavigationInactive(session, "change the thinking level");
    const level = session.cycleThinkingLevel();
    if (level === undefined) throw new Error("Current model does not support thinking");
    this.publishActivity(session, `thinking: ${level}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  /** Resolve the editor's lens without opening a runtime or accepting a client-supplied cwd. */
  async resourceEditorSession(sessionId: string): Promise<{ cwd: string; readOnlyReason?: string } | undefined> {
    const active = this.active.get(sessionId);
    const archived = (await this.archiveStore.list()).find((record) => record.sessionId === sessionId);
    const listed = active === undefined && archived === undefined
      ? (await (this.sessionManager.listCatalog?.() ?? this.sessionManager.listAll())).find((record) => record.id === sessionId)
      : undefined;
    const cwd = active?.runtime.cwd ?? archived?.cwd ?? listed?.cwd;
    if (cwd === undefined) return undefined;
    const readonly = await this.sessionWorktrees?.store.readOnly({ id: sessionId, cwd });
    return { cwd, ...(archived !== undefined ? { readOnlyReason: "Archived sessions are read-only. Restore this session before editing resources." }
      : readonly === undefined ? {} : { readOnlyReason: "This session's worktree is no longer writable." }) };
  }

  async commands(ref: PiSessionRef): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(ref);
    return buildActiveCommandList({
      builtins: BUILTIN_COMMANDS.map((command) => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }), source: "builtin" as const })),
      extensions: session.extensionRunner.getRegisteredCommands().map((command) => ({ name: command.invocationName, ...(command.description === undefined ? {} : { description: command.description }), source: "extension" as const })),
      prompts: session.promptTemplates.map((template) => ({
        name: template.name,
        ...(template.description === undefined ? {} : { description: template.description }),
        origin: canonicalPromptResourceOrigin("prompt", template.filePath, template.sourceInfo),
      })),
      skills: session.resourceLoader.getSkills().skills.map((skill) => ({
        name: skill.name,
        ...(skill.description === undefined ? {} : { description: skill.description }),
        origin: canonicalPromptResourceOrigin("skill", skill.filePath, skill.sourceInfo),
      })),
    });
  }

  private async activeCommandCatalog(session: PiAgentSession): Promise<ActiveCommandCatalog> {
    return await buildActiveCommandCatalog({
      builtins: BUILTIN_COMMANDS.map((command) => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }), source: "builtin" as const })),
      extensions: session.extensionRunner.getRegisteredCommands().map((command) => ({ name: command.invocationName, ...(command.description === undefined ? {} : { description: command.description }), source: "extension" as const })),
      prompts: session.promptTemplates.map((template) => ({
        name: template.name,
        ...(template.description === undefined ? {} : { description: template.description }),
        content: boundedActivePromptContent(template.content ?? ""),
        origin: canonicalPromptResourceOrigin("prompt", template.filePath, template.sourceInfo),
      })),
      skills: await Promise.all(session.resourceLoader.getSkills().skills.map(async (skill) => ({
        name: skill.name,
        ...(skill.description === undefined ? {} : { description: skill.description }),
        content: await readActiveSkillContent(skill.filePath),
        origin: canonicalPromptResourceOrigin("skill", skill.filePath, skill.sourceInfo),
        baseDir: skill.baseDir ?? "",
        ...(skill.filePath === undefined ? {} : { filePath: skill.filePath }),
      }))),
    });
  }

  async prompt(ref: PiSessionRef, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: PromptRequestOptions & { echoUserMessage?: boolean; handoffContinuation?: boolean }): Promise<void> {
    const { requestId } = promptRequestOptionsSchema.parse(options ?? {});
    const promptText = requirePromptText(text);
    // Command-forwarded prompts (e.g. /skill:*) are expanded by the agent, which
    // streams the canonical message back. The client doesn't render the raw
    // command text, so the server must not echo it either, or it would show up
    // as a transient line that vanishes on reload.
    const echoUserMessage = options?.echoUserMessage !== false;
    const requestedBehavior = parseStreamingBehavior(streamingBehavior);
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session, options?.handoffContinuation === true);
    const parsedAttachments = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false });
    const images = (await attachmentsToInlineImages(parsedAttachments)).map((entry) => entry.image);
    this.assertTreeNavigationInactive(session, "send a prompt");
    await this.withPromptRequest(session, requestId, async () => {
      // A new chat message answers the open ask. A retry must not void an ask
      // created after the original input, so check its identity first.
      const hadAttentionHint = this.attentionHints.read(this.attentionSession(session)) !== undefined;
      this.attentionHints.invalidate(this.attentionSession(session));
      if (hadAttentionHint) this.publishDecisionHintStatus(session);
      await this.voidOpenAskForUserMessage(session);
      const waitsForCompaction = session.isCompacting || this.compactionQueue.hasCompactionBoundary(session.sessionId);
      const behavior = session.isStreaming || waitsForCompaction ? requestedBehavior ?? "followUp" : undefined;
      if (waitsForCompaction) {
        this.enqueuePromptBehindCompaction(session, promptText, behavior ?? "followUp", images, echoUserMessage, true, requestId);
        return;
      }
      const accepted = await this.submitPromptUntilPreflight(session, promptText, behavior, images, echoUserMessage, true, undefined, requestId);
      if (!accepted) throw new Error("Prompt delivery was rejected before agent start.");
    });
  }

  private async withPromptRequest(session: PiAgentSession, requestId: string | undefined, deliver: () => Promise<void>, receiptTimeoutMs: number | null = this.promptPreflightTimeoutMs): Promise<void> {
    if (requestId === undefined) { await deliver(); return; }
    let pending = this.pendingPromptRequests.get(session);
    if (pending === undefined) { pending = new Map(); this.pendingPromptRequests.set(session, pending); }
    const existing = pending.get(requestId);
    if (existing !== undefined) { await this.waitForPromptRequestReceipt(existing, receiptTimeoutMs); return; }
    // Only in-flight receipts live here. Durable and the compaction queue own
    // admitted input; no completed request cache can drift from their state.
    const receipt = (async () => {
      if (this.compactionQueue.hasPromptRequest(session.sessionId, requestId) || (await session.hasPromptRequest?.(requestId)) === true) return;
      await deliver();
    })();
    pending.set(requestId, receipt);
    void receipt.then(() => { pending.delete(requestId); }, () => { pending.delete(requestId); });
    await this.waitForPromptRequestReceipt(receipt, receiptTimeoutMs);
  }

  private async waitForPromptRequestReceipt(receipt: Promise<void>, timeoutMs: number | null): Promise<void> {
    if (timeoutMs === null) { await receipt; return; }
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([receipt, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { reject(new Error("Prompt preflight receipt timed out.")); }, timeoutMs);
      })]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }

  private submitPrompt(session: PiAgentSession, text: string, behavior: QueuedPromptKind | undefined, images: ImageContent[] = [], echoUserMessage = true, expandPromptTemplates = true, preflightResult?: (accepted: boolean) => void, onCompletion?: (completion: PromptCompletion) => void, requestId?: string): Promise<boolean> {
    this.publishActivity(session, behavior === "steer" ? "steering queued" : behavior === "followUp" ? "message queued" : "prompt accepted", "active");
    if (behavior === undefined && echoUserMessage) this.events.publish(session.sessionId, { type: "message.append", message: userMessage(text, images) });
    const promptOptions = buildPromptOptions(behavior, images, expandPromptTemplates, preflightResult, requestId);
    const promptPromise = this.runSessionEntryMutation(session, "send a prompt", () => session.prompt(text, promptOptions)).then(() => {
      onCompletion?.({ accepted: true });
      return true;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(session, "error", "error", message);
      this.events.publish(session.sessionId, { type: "session.error", message });
      onCompletion?.({ accepted: false, error: message });
      return false;
    });
    void promptPromise;
    return promptPromise;
  }

  private async submitPromptUntilPreflight(session: PiAgentSession, text: string, behavior: QueuedPromptKind | undefined, images: ImageContent[] = [], echoUserMessage = true, expandPromptTemplates = true, onCompletion?: (completion: PromptCompletion) => void, requestId?: string): Promise<boolean> {
    return await new Promise<boolean>((resolvePreflight, rejectPreflight) => {
      let settled = false;
      const settle = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        resolvePreflight(accepted);
      };
      const timeout = requestId === undefined ? setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectPreflight(new Error("Prompt preflight receipt timed out."));
      }, this.promptPreflightTimeoutMs) : undefined;
      const completion = this.submitPrompt(session, text, behavior, images, echoUserMessage, expandPromptTemplates, settle, onCompletion, requestId);
      void completion.then(settle);
    });
  }

  private assertHandoffDestinationAcceptsInput(session: PiAgentSession, allowContinuation = false): void {
    if (this.preparingHandoffDestinations.has(session.sessionId) && !allowContinuation) {
      throw new Error("Handoff destination is preparing context. Retry after the ready status appears.");
    }
  }

  private enqueuePromptBehindCompaction(session: PiAgentSession, text: string, kind: QueuedPromptKind, images: ImageContent[] = [], echoUserMessage = true, expandPromptTemplates = true, requestId?: string): void {
    const prompt = { kind, text, ...(requestId === undefined ? {} : { requestId }), ...(images.length > 0 ? { images } : {}), ...(echoUserMessage ? {} : { echoUserMessage: false }), ...(expandPromptTemplates ? {} : { expandPromptTemplates: false }) };
    this.compactionQueue.enqueuePrompt(session.sessionId, prompt);
    this.publishActivity(session, session.isCompacting ? "message queued during compaction" : "message queued behind compaction", "active");
    this.publishStatus(session);
  }

  async runPromptResourceCommand(ref: PiSessionRef, text: string, identity: PromptResourceCommandIdentity, streamingBehavior?: unknown, attachments?: unknown, options?: PromptRequestOptions): Promise<{ accepted: true; deliveryFingerprint: string }> {
    const { requestId } = promptRequestOptionsSchema.parse(options ?? {});
    const requestedBehavior = parseStreamingBehavior(streamingBehavior);
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    const parsedAttachments = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false });
    const images = (await attachmentsToInlineImages(parsedAttachments)).map((entry) => entry.image);
    this.assertTreeNavigationInactive(session, "send a prompt-resource command");
    const catalog = await this.activeCommandCatalog(session);
    const resolved = resolvePromptResourceIdentity(catalog, text, identity);
    if (resolved.kind !== "matched") throw new Error("Prompt-resource command is no longer available for this session.");
    const expanded = expandPromptResourceCommand(resolved.command, resolved.args);
    await this.withPromptRequest(session, requestId, async () => {
      await this.voidOpenAskForUserMessage(session);
      const waitsForCompaction = session.isCompacting || this.compactionQueue.hasCompactionBoundary(session.sessionId);
      const behavior = session.isStreaming || waitsForCompaction ? requestedBehavior ?? "followUp" : undefined;
      if (waitsForCompaction) this.enqueuePromptBehindCompaction(session, expanded, behavior ?? "followUp", images, true, false, requestId);
      else {
        const accepted = await this.submitPromptUntilPreflight(session, expanded, behavior, images, true, false, undefined, requestId);
        if (!accepted) throw new Error("Prompt-resource command delivery was rejected before agent start.");
      }
    });
    return { accepted: true, deliveryFingerprint: await deliveryFingerprint(expanded) };
  }

  async saveAttachments(ref: PiSessionRef, attachments: unknown, folder?: string): Promise<SavedPromptAttachment[]> {
    const parsed = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false, allowFileAttachments: true });
    if (parsed.length === 0) return [];
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    return saveAttachmentsToWorkspace(active.runtime.cwd, parsed, folder === undefined ? {} : { folder });
  }

  async shell(ref: PiSessionRef, text: string): Promise<void> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    const { session } = active.runtime;
    this.assertHandoffDestinationAcceptsInput(session);
    this.assertTreeNavigationInactive(session, "run a shell command");
    const isExcluded = text.startsWith("!!");
    const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
    if (!command) throw new Error("Usage: !<shell command>");
    if (session.isBashRunning) throw new Error("A bash command is already running");
    if (session.isCompacting || this.compactionQueue.hasCompactionBoundary(session.sessionId)) throw new Error("Cannot run a shell command while compaction is queued or running");

    this.publishActivity(session, "running bash", "active", command);
    this.events.prepareHostShell(session.sessionId, this.openMessages(session.sessionManager).at(-1)?.id);
    this.events.publish(session.sessionId, { type: "shell.start", command, excludeFromContext: isExcluded });
    void this.runSessionEntryMutation(session, "run a shell command", () => session.executeBash(command, (chunk) => {
      this.events.publish(session.sessionId, { type: "shell.chunk", chunk });
      this.publishActivity(session, "running bash", "active", command);
      this.publishStatus(session);
    }, { excludeFromContext: isExcluded })).then((result) => {
      this.events.publish(session.sessionId, {
        type: "shell.end",
        output: result.output,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        cancelled: result.cancelled,
        truncated: result.truncated,
        ...(result.fullOutputPath === undefined ? {} : { fullOutputPath: result.fullOutputPath }),
      });
      this.publishActivity(session, "bash complete", result.exitCode === 0 ? "idle" : "error", command);
      this.publishStatus(session);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.events.publish(session.sessionId, { type: "shell.end", output: message, isError: true });
      this.events.publish(session.sessionId, { type: "session.error", message });
      this.publishActivity(session, "bash failed", "error", message);
      this.publishStatus(session);
    });
  }

  async runCommand(ref: PiSessionRef, text: string, streamingBehavior?: unknown): Promise<ClientCommandResult> {
    parseStreamingBehavior(streamingBehavior);
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    const session = active.runtime.session;
    this.assertHandoffDestinationAcceptsInput(session);
    const sourceSessionId = session.sessionId;
    const parsed = parseLeadingSlashCommand(text);
    if (parsed.kind === "command" && parsed.name === "compact") {
      if (session.isCompacting || this.compactionQueue.isCompactionRunning(sourceSessionId)) return { type: "unsupported", message: "Compaction is already running." };
      if (this.compactionQueue.isCompactionQueued(sourceSessionId)) return { type: "done", message: "Compaction is already queued." };
      const waitsForActiveWork = this.compactionMustWait(session);
      this.compactionQueue.queueCompaction(sourceSessionId, text);
      this.publishActivity(session, waitsForActiveWork ? "compaction queued" : "compacting", "active");
      this.publishStatus(session);
      this.scheduleQueuedCompaction(sourceSessionId);
      return { type: "done", message: waitsForActiveWork ? "Compaction queued…" : "Compaction started…" };
    }
    const result = await this.commandService.run(sourceSessionId, text);
    this.publishCreatedCommandSession(sourceSessionId, result);
    return result;
  }

  async respondToCommand(ref: PiSessionRef, requestId: string, value: string): Promise<ClientCommandResult> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    const sourceSessionId = active.runtime.session.sessionId;
    const result = await this.commandService.respond(sourceSessionId, requestId, value);
    this.publishCreatedCommandSession(sourceSessionId, result);
    return result;
  }

  private publishCreatedCommandSession(sourceSessionId: string, result: ClientCommandResult): void {
    if (result.type !== "done" || result.session === undefined || result.session.id === sourceSessionId) return;
    this.events.publishGlobal({ type: "session.created", session: result.session });
  }

  async navigateTree(ref: PiSessionRef, request: ClientSessionTreeNavigateRequest): Promise<ClientSessionTreeNavigateResult> {
    if (request.targetId.trim() === "") throw new Error("Session tree target is required");
    if (this.isTreeExclusiveSessionIdentityActive(ref.id)) {
      throw new Error("Stop current session activity before navigating the session tree");
    }
    await this.assertWritable(ref);
    const options = sessionTreeNavigationOptions(request);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    if (typeof session.navigateTree !== "function") throw new Error("Session tree navigation is not supported by this Pi runtime");
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before navigating the session tree");

    // Acquire synchronously after the active-work check. No leaf-producing work
    // may enter this runtime until Pi's potentially asynchronous summary settles.
    this.treeNavigations.add(session);
    try {
      const leafId = session instanceof DurableAgentSession ? (await session.getDurableTree()).activeLeafId : session.sessionManager.getLeafId();
      if (leafId !== request.expectedLeafId) {
        throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
      }

      this.publishActivity(session, options.summarize ? "summarizing branch" : "navigating session tree", "active");
      this.publishStatus(session);
      const result = await session.navigateTree(request.targetId, options);
      if (result.cancelled) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, result.aborted === true ? "branch summary aborted" : "tree navigation cancelled", "idle");
        }
        return { cancelled: true, ...(result.aborted === undefined ? {} : { aborted: result.aborted }) };
      }

      this.checkpointResponse(session);
      if (this.isCurrentActiveSession(session)) this.publishActivity(session, "session tree navigated", "idle");
      return { cancelled: false, ...(result.editorText === undefined ? {} : { editorText: result.editorText }) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, "tree navigation failed", "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message });
      }
      throw error;
    } finally {
      this.treeNavigations.delete(session);
      if (this.isCurrentActiveSession(session)) {
        this.flushDeferredTreeNavigationWork(session);
        this.publishStatus(session);
      } else {
        this.deferredGeneratedSessionNames.delete(session);
      }
    }
  }

  /**
   * Fork the session from one entry of its tree into a new session file,
   * leaving the original session untouched. The forked runtime replaces the
   * current one, so the outcome is reported for the session the client is
   * about to join rather than the forked-from record.
   */
  async forkFromTree(ref: PiSessionRef, request: ClientSessionTreeForkRequest): Promise<ClientSessionTreeForkResult> {
    if (request.entryId.trim() === "") throw new Error("Session tree entry is required");
    if (this.isTreeExclusiveSessionIdentityActive(ref.id)) {
      throw new Error("Stop current session activity before forking the session tree");
    }
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before forking the session tree");
    if (session.sessionManager.getLeafId() !== request.expectedLeafId) {
      throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
    }

    this.publishActivity(session, "forking session from entry", "active");
    this.publishStatus(session);
    try {
      const result = await this.commandService.forkEntry(session.sessionId, request.entryId, {
        expectedLeafId: request.expectedLeafId,
      });
      if (result.type === "unsupported") throw new Error(result.message);
      if (result.type !== "done") throw new Error("Session fork is unavailable");
      if (result.session === undefined) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, "fork cancelled", "idle");
          this.publishStatus(session);
        }
        return { cancelled: true };
      }

      const forkedSession = this.active.get(result.session.id)?.runtime.session;
      if (forkedSession !== undefined && this.isCurrentActiveSession(forkedSession)) {
        this.publishActivity(forkedSession, "session forked", "idle");
        this.publishStatus(forkedSession);
      }
      if (result.session.id !== session.sessionId) this.clearSupersededSessionActivity(session);
      this.publishCreatedCommandSession(session.sessionId, result);
      return {
        cancelled: false,
        session: result.session,
        ...(result.promptDraft === undefined ? {} : { promptDraft: result.promptDraft }),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, "fork failed", "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message });
        this.publishStatus(session);
      }
      throw error;
    }
  }

  /**
   * A changed-id fork can rebind its runtime after a heartbeat published the
   * prior identity as active. Clear every observable owner before forgetting
   * that identity's local activity record.
   */
  private clearSupersededSessionActivity(session: PiAgentSession): void {
    const sessionId = session.sessionId;
    if (this.activities.get(sessionId)?.phase === "active") {
      const at = new Date().toISOString();
      const stored = { phase: "idle" as const, label: "idle", at };
      this.activities.set(sessionId, stored);
      const activity = { sessionId, ...stored };
      this.events.publish(sessionId, { type: "activity.update", activity });
      this.events.publishGlobal({ type: "activity.update", activity });
    }
    this.workspaceActivity?.removeSession(sessionId, session.sessionManager.getCwd());
    this.activities.delete(sessionId);
  }

  private async reloadSessionRuntime(session: PiAgentSession): Promise<void> {
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before reloading");
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before reloading",
      async () => {
        this.publishActivity(session, "reloading resources", "active");
        const priorGeneration = this.notificationGenerationBySession.get(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await session.reload(priorGeneration === undefined ? undefined : {
            beforeSessionStart: () => {
              candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
              this.notificationGenerationBySession.set(session, candidateGeneration);
              this.replaceSessionNotificationContext(session, candidateGeneration);
            },
          });
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          this.publishActivity(session, "resources reloaded", "idle");
          this.publishStatus(session);
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          const message = error instanceof Error ? error.message : String(error);
          this.publishActivity(session, "reload failed", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message });
          this.publishStatus(session);
          throw error;
        }
      },
    );
  }

  async archive(ref: PiSessionRef): Promise<void> {
    // Archive only the JSONL file. Its .durable/<name>/ journal can still own live forks.
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) {
      if (await this.isPinned(readonly.session.id)) throw new Error("Unpin session before archiving");
      if (await this.getArchived(ref) !== undefined) return;
      await this.closeSessionManagedProcesses(readonly.session.id, readonly.session.path);
      await this.archiveStore.archive({
        sessionId: readonly.session.id, ...readonly.session,
        path: sessionFileExists(readonly.session.path) ? readonly.session.path : readonly.transcriptPath,
      });
      this.scheduleSearchScan();
      await this.forgetUnreadSessions([{ sessionId: readonly.session.id, cwd: readonly.session.cwd }]);
      return;
    }
    const session = await this.getOrOpen(ref);
    if (await this.isPinned(session.sessionId)) throw new Error("Unpin session before archiving");
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before archiving");
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before archiving",
      async () => {
        const archiveInput = await this.archiveInputForSession(session);
        await this.closeActive(session.sessionId, { kind: "clear", reason: "archive" });
        await this.closeSessionManagedProcesses(archiveInput.sessionId, archiveInput.path);
        await this.archiveStore.archive(archiveInput);
        this.scheduleSearchScan();
        await this.forgetUnreadSessions([archiveInput]);
      },
    );
  }

  async archiveMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkArchiveResponse> {
    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const [archivedRecords, pinnedRecords, sessionContext] = await Promise.all([
      this.archiveStore.list(),
      this.pinStore.list(),
      this.bulkSessionRefContext(uniqueRefs),
    ]);
    const pinnedSessionIds = pinnedSessionIdSet(pinnedRecords);
    const failures: SessionBulkFailure[] = [];
    const alreadyArchivedSessionIds: string[] = [];
    const unreadArchivedIdentities: { sessionId: string; cwd: string }[] = [];
    const planItems: BulkArchivePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const archived = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (archived !== undefined) {
        this.publishNotificationMutations(this.notificationStore.clearSession(archived.sessionId, "archive"));
        alreadyArchivedSessionIds.push(archived.sessionId);
        unreadArchivedIdentities.push(archived);
        continue;
      }

      const active = this.activeForRef(bulkRefToSessionRef(ref));
      const listed = findListedSessionForBulkRef(sessionContext, ref);
      const resolvedSessionId = active?.runtime.session.sessionId ?? listed?.id ?? ref.id;
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: resolvedSessionId, error: "Stop current session activity before archiving" });
        continue;
      }

      try {
        if (listed !== undefined) {
          planItems.push({ input: archiveInputFromListEntry(listed) });
        } else if (active !== undefined) {
          planItems.push({ input: archiveInputFromActiveSession(active.runtime.session) });
        } else {
          failures.push({ sessionId: ref.id, error: "Session not found" });
        }
      } catch (error: unknown) {
        failures.push({ sessionId: resolvedSessionId, error: errorMessage(error) });
      }
    }

    const readyPlanItems: { input: ArchiveSessionInput; active?: ActiveSession<PiSessionRuntime> }[] = [];
    for (const item of planItems) {
      if (pinnedSessionIds.has(item.input.sessionId)) {
        failures.push({ sessionId: item.input.sessionId, error: "Unpin session before archiving" });
        continue;
      }
      const active = this.activeForRef({ id: item.input.sessionId, cwd: item.input.cwd });
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: item.input.sessionId, error: "Stop current session activity before archiving" });
        continue;
      }
      readyPlanItems.push(active === undefined ? item : { ...item, active });
    }

    const readyInputs: ArchiveSessionInput[] = [];
    const archivedSessionIds = [...alreadyArchivedSessionIds];
    await this.runTreeExclusiveOperation(
      readyPlanItems.map(({ input, active }) => ({
        sessionId: input.sessionId,
        ...(active === undefined ? {} : { session: active.runtime.session, runtime: active.runtime }),
      })),
      "Stop current session activity before archiving",
      async () => {
        for (const item of readyPlanItems) {
          try {
            await this.closeActive(item.input.sessionId, { kind: "clear", reason: "archive" });
            readyInputs.push(item.input);
          } catch (error: unknown) {
            failures.push({ sessionId: item.input.sessionId, error: errorMessage(error) });
          }
        }

        try {
          const archived = await this.archiveStoreArchiveMany(readyInputs);
          archivedSessionIds.push(...archived.map((record) => record.sessionId));
          unreadArchivedIdentities.push(...archived);
        } catch (error: unknown) {
          for (const input of readyInputs) failures.push({ sessionId: input.sessionId, error: errorMessage(error) });
        }
      },
    );
    await this.forgetUnreadSessions(unreadArchivedIdentities);

    return {
      archived: true,
      archivedSessionIds: uniqueStrings(archivedSessionIds),
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async archiveTree(ref: PiSessionRef): Promise<ClientArchiveSessionsResponse> {
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) {
      await this.archive(ref);
      return { archived: true, sessionIds: [readonly.session.id], archivedCount: 1 };
    }
    const session = await this.getOrOpen(ref);
    const catalog = await this.workspaceArchiveCandidates(session.sessionManager.getCwd());
    const root = findArchiveCandidateByIdOrPrefix(catalog, session.sessionId) ?? archiveCandidateFromActiveSession(session, false);
    const pinnedSessionIds = pinnedSessionIdSet(await this.pinStore.list());
    if (pinnedSessionIds.has(root.id)) throw new Error("Unpin session before archiving");
    const plan = planSessionArchiveTree(root, catalog);
    const busy = plan.targets.map((target) => target.activeSession).find((target) => target !== undefined && this.hasActiveWork(target));
    if (busy !== undefined) throw new Error(`Stop current session activity before archiving ${sessionDisplayName(busy)}`);

    // Pinned descendants stay live: the pin invariant beats tree completeness.
    const archiveTargets = plan.unarchivedTargets.filter((target) => !pinnedSessionIds.has(target.id));
    const skippedPinnedCount = plan.unarchivedTargets.length - archiveTargets.length;
    const archiveInputs = archiveTargets.map((target) => archiveInputFromCandidate(target));
    await this.runTreeExclusiveOperation(
      archiveTargets.map((target) => ({
        sessionId: target.id,
        ...(target.activeSession === undefined ? {} : { session: target.activeSession }),
      })),
      `Stop current session activity before archiving ${sessionDisplayName(session)}`,
      async () => {
        for (const target of plan.targets) {
          if (target.archived) this.publishNotificationMutations(this.notificationStore.clearSession(target.id, "archive"));
        }
        for (const input of archiveInputs) await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" });
        await this.archiveStoreArchiveMany(archiveInputs);
      },
    );
    await this.forgetUnreadSessions(
      plan.targets
        .filter((target) => !pinnedSessionIds.has(target.id))
        .map((target) => ({ sessionId: target.id, cwd: target.cwd })),
    );

    return {
      archived: true,
      sessionIds: archiveInputs.map((input) => input.sessionId),
      archivedCount: archiveInputs.length,
      skippedAlreadyArchivedCount: plan.skippedAlreadyArchivedCount,
      ...(skippedPinnedCount === 0 ? {} : { skippedPinnedCount }),
    };
  }

  async restore(ref: PiSessionRef): Promise<void> {
    const archived = await this.getArchived(ref);
    if (archived === undefined) throw new Error("Session not found");
    await this.closeActive(archived.sessionId, { kind: "clear", reason: "restore" });
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly === undefined) await this.archiveStore.restore(archived.sessionId);
    else await this.archiveStore.restore(archived.sessionId, readonly.transcriptPath);
    this.scheduleSearchScan();
    await this.forgetUnreadSessions([archived]);
  }

  /**
   * Pin a session: it sorts to the top of its grouped list and every archive
   * path refuses it until unpinned. Archived sessions cannot be pinned — the
   * two flags would contradict each other — so restore comes first.
   */
  async pin(ref: PiSessionRef): Promise<void> {
    if (await this.getArchived(ref) !== undefined) throw new Error("Restore session before pinning");
    const target = await this.resolvePinTarget(ref);
    if (target === undefined) throw new Error("Session not found");
    await this.pinStore.pin(target);
    this.events.publishGlobal({ type: "session.pinned", sessionId: target.sessionId, cwd: target.cwd, pinned: true });
  }

  /** Remove a pin. A no-op when the session is not pinned. */
  async unpin(ref: PiSessionRef): Promise<void> {
    const record = await this.pinStore.get(ref.id);
    if (record === undefined) return;
    await this.pinStore.unpin(record.sessionId);
    this.events.publishGlobal({ type: "session.pinned", sessionId: record.sessionId, cwd: record.cwd, pinned: false });
  }

  /**
   * Replace a session's promoted-tab set and broadcast the change so every
   * connected browser converges. Unlike pins, archived sessions keep their
   * tabs: the set is workspace state that should survive a restore.
   */
  async setTabs(ref: PiSessionRef, tabs: readonly string[]): Promise<{ tabs: string[] }> {
    const archived = await this.getArchived(ref);
    const target = archived !== undefined
      ? { sessionId: archived.sessionId, cwd: archived.cwd }
      : await this.resolvePinTarget(ref);
    if (target === undefined) throw new Error("Session not found");
    const result = await this.tabsStore.set({ sessionId: target.sessionId, cwd: target.cwd, tabs });
    if (result.changed) {
      this.events.publishGlobal({ type: "session.tabs", sessionId: target.sessionId, cwd: target.cwd, tabs: result.tabs });
    }
    return { tabs: result.tabs };
  }

  private async isPinned(sessionId: string): Promise<boolean> {
    const record = await this.pinStore.get(sessionId);
    return record?.sessionId === sessionId;
  }

  private async resolvePinTarget(ref: PiSessionRef): Promise<PinSessionInput | undefined> {
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) return { sessionId: readonly.session.id, cwd: readonly.session.cwd };
    const active = this.activeForRef(ref);
    if (active !== undefined) {
      return { sessionId: active.runtime.session.sessionId, cwd: active.runtime.session.sessionManager.getCwd() };
    }
    const sessions = await this.sessionManager.list(ref.cwd);
    const listed = sessions.find((session) => session.id === ref.id) ?? sessions.find((session) => session.id.startsWith(ref.id));
    return listed === undefined ? undefined : { sessionId: listed.id, cwd: listed.cwd };
  }

  async deleteArchivedMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkDeleteArchivedResponse> {
    if (this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const archivedRecords = await this.archiveStore.list();
    const failures: SessionBulkFailure[] = [];
    const planItems: BulkDeletePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const record = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (record === undefined) {
        failures.push({ sessionId: ref.id, error: "Archived session not found" });
        continue;
      }

      const active = this.activeForRef({ id: record.sessionId, cwd: record.cwd });
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: record.sessionId, error: "Stop current session activity before deleting archived session" });
        continue;
      }
      planItems.push({ record });
    }

    const readyRecords: ArchivedSessionRecord[] = [];
    for (const item of planItems) {
      try {
        await this.closeActive(item.record.sessionId, { kind: "clear", reason: "delete" });
        readyRecords.push(item.record);
      } catch (error: unknown) {
        failures.push({ sessionId: item.record.sessionId, error: errorMessage(error) });
      }
    }

    const deleteIds = readyRecords.map((record) => record.sessionId);

    let deletedSessionIds: string[] = [];
    try {
      deletedSessionIds = await this.archiveStoreDeleteArchivedMany(deleteIds);
    } catch (error: unknown) {
      for (const sessionId of deleteIds) failures.push({ sessionId, error: errorMessage(error) });
    }
    const deletedIdSet = new Set(deletedSessionIds);
    await this.forgetUnreadSessions(readyRecords.filter((record) => deletedIdSet.has(record.sessionId)));
    await this.sessionWorktrees?.store.forgetTranscripts([...deletedIdSet]);

    return {
      deleted: true,
      deletedSessionIds,
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async reload(ref: PiSessionRef): Promise<void> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertHandoffDestinationAcceptsInput(session);
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before reloading");

    const reopenedSession = await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before reloading",
      async () => {
        const priorGeneration = this.notificationGenerationBySession.get(session);
        const { sessionId, cwd } = notificationIdentityForSession(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.closeActive(
            sessionId,
            priorGeneration === undefined ? CLEAR_RUNTIME_NOTIFICATIONS : DEFER_RUNTIME_NOTIFICATIONS,
          );
          candidateGeneration = priorGeneration === undefined
            ? undefined
            : this.notificationStore.beginReplacement(priorGeneration, { sessionId, cwd });
          const reopened = await this.getActive(ref, candidateGeneration === undefined ? {} : { notificationGeneration: candidateGeneration });
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          return reopened.runtime.session;
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration));
          }
          throw error;
        }
      },
    );
    this.publishStatus(reopenedSession);
  }

  /**
   * Detach a freshly forked session by rewriting its file directly.
   *
   * `detachParent` opens the session first, which spins up a runtime and, in
   * the middle of a fork, contends with the tree-exclusive lock the fork holds.
   * The path is already known here, so the file and the caches that memoize it
   * are all that need touching.
   *
   * A failure must not fail the fork: a child that kept its parent link can be
   * detached by hand, a lost fork cannot be recovered. It is reported rather
   * than swallowed, because a silent failure here looks exactly like the
   * feature working.
   */
  /**
   * Detach a session the user just forked or cloned by hand.
   *
   * Called from the command service, which is where `/fork`, `/clone`, and the
   * session-tree fork all converge; patching only the tree path leaves the
   * slash commands attached.
   *
   * Both halves matter. Pi writes some forked files immediately and defers
   * others until the first append, so the in-memory header is cleared for the
   * deferred case and the file for the written one.
   *
   * A failure must not fail the fork: a child that kept its parent link can be
   * detached by hand, a lost fork cannot be recovered.
   */
  private async detachForkedSession(forked: PiAgentSession): Promise<void> {
    clearParentSessionHeader(forked.sessionManager);
    const sessionFile = forked.sessionFile;
    if (sessionFile === undefined || sessionFile === "") return;
    this.sessionHeaderCache.delete(sessionFile);
    this.sessionManager.invalidateSessionFile(sessionFile);
    try {
      await clearParentSession(sessionFile);
    } catch (error: unknown) {
      // A missing file is the normal case rather than a failure: Pi has not
      // written it yet, and the in-memory clear already covers that session.
      const code = isRecord(error) ? error["code"] : undefined;
      if (code === "ENOENT") return;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[sessions] could not detach forked session ${sessionFile}: ${message}\n`);
    }
  }

  /**
   * Record that a tool spawned other sessions, in those sessions' own files.
   *
   * The top level of the inbox is the conversations a human is in; everything
   * an agent spawns to talk to another agent belongs under the session that
   * owns it. Nothing in a spawned session's file distinguishes it from a
   * conversation the user continued -- not the header, not a start reason, not
   * the shape of the transcript, because fork-context copies the parent's
   * history wholesale. So delegation is recorded where it is witnessed: a tool
   * result that names a `sessionFile` spawned that session, and saying so is a
   * statement about what just happened rather than an inference about a file.
   *
   * The mark travels with the artifact, so no index has to be kept in step
   * with it, and every client reads the same truth.
   *
   * Runs on tool end rather than tool start: by then the spawned processes
   * have exited, so rewriting their header cannot race their own appends.
   */
  /**
   * Delegated agents and managed processes this session has running now.
   *
   * Both are omitted when zero so a resting session carries no extra wire
   * fields and the inbox has nothing to render.
   */
  private liveWorkCounts(session: PiAgentSession): Pick<ClientSessionStatus, "workingAgents" | "runningProcesses" | "watchingPullRequest" | "watchingActionRun" | "waitingOnYou" | "flaggedDecisions" | "workflow"> {
    const workingAgents = (this.workingAgentsBySession.get(session.sessionId) ?? 0)
      + (session instanceof DurableAgentSession ? session.workingDurableChildren : 0);
    const waitingOnYou = session instanceof DurableAgentSession ? session.waitingOnUser : 0;
    const flaggedDecisions = session instanceof DurableAgentSession ? session.flaggedDecisions : 0;
    const glance = session instanceof DurableAgentSession ? session.workflowGlance : undefined;
    const runningProcesses = this.processPanels.get(session.sessionId)?.runningCount ?? 0;
    return {
      ...(this.pullRequestWatches?.isWatching(session.sessionId) === true ? { watchingPullRequest: true } : {}),
      ...(this.actionRunWatches?.isWatching(session.sessionId) === true ? { watchingActionRun: true } : {}),
      ...(workingAgents > 0 ? { workingAgents } : {}),
      ...(runningProcesses > 0 ? { runningProcesses } : {}),
      ...(waitingOnYou > 0 ? { waitingOnYou } : {}),
      ...(flaggedDecisions > 0 ? { flaggedDecisions } : {}),
      ...(glance === undefined ? {} : { workflow: glance }),
    };
  }

  /**
   * Track how many delegated agents a session has working, from the progress
   * the delegating tool reports. A run that reports no progress array leaves
   * the count untouched rather than clearing it, so a tool that only reports
   * at the end does not flicker the inbox to zero mid-run.
   */
  private trackWorkingAgents(session: PiAgentSession, event: unknown): void {
    const running = runningAgentCount(event);
    if (running === undefined) return;
    const previous = this.workingAgentsBySession.get(session.sessionId) ?? 0;
    if (running === previous) return;
    if (running === 0) this.workingAgentsBySession.delete(session.sessionId);
    else this.workingAgentsBySession.set(session.sessionId, running);
    this.publishStatus(session);
  }

  /**
   * Session files whose sessions are running a delegating tool right now.
   *
   * A fork those runs create has no durable mark until the run reports the file
   * it made, so this is the only thing that can keep it out of the inbox in the
   * meantime. It is read fresh on every listing and never stored, because the
   * claim it supports is true only for as long as the run is.
   */
  private delegatingSessionFiles(): ReadonlySet<string> {
    const files = new Set<string>();
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if ((this.workingAgentsBySession.get(session.sessionId) ?? 0) === 0) continue;
      if (session.sessionFile !== undefined) files.add(session.sessionFile);
    }
    return files;
  }

  /**
   * Recover spawn marks the live rule could not have written.
   *
   * Marking at tool end only reaches runs this daemon streamed. Sessions driven
   * from the terminal, and runs that outlived a restart, leave children nothing
   * ever marked. Their parents' transcripts still name them, so the fact is
   * read back instead of being lost.
   *
   * Reads whole transcripts, so callers run it in the background and never in
   * front of a listing.
   */
  async repairSpawnMarks(): Promise<AgentSpawnedRepairReport | undefined> {
    const sessionsRoot = this.sessionManager.defaultSessionsRoot?.();
    if (sessionsRoot === undefined) return undefined;
    const report = await repairAgentSpawnedMarks(sessionsRoot, { memo: this.agentSpawnedRepairMemo });
    // Rewritten headers changed the files the catalog remembers by mtime, so
    // the scan re-reads them on its own. Only this cache is keyed by path.
    if (report.marked > 0) this.sessionHeaderCache.clear();
    return report;
  }

  private async markSessionsSpawnedByTool(event: unknown): Promise<void> {
    for (const sessionFile of spawnedSessionFiles(event)) {
      // The run has ended, so the child process that owned this file has
      // exited. That is the proof the quiet period stands in for elsewhere.
      const outcome = await markAgentSpawned(sessionFile, { requireQuietForMs: 0 });
      if (outcome.kind === "marked") {
        this.sessionHeaderCache.delete(sessionFile);
        this.sessionManager.invalidateSessionFile(sessionFile);
        continue;
      }
      // A spawned session that was never persisted has no file to mark, and an
      // already-marked one needs nothing. Neither is worth reporting.
      if (outcome.kind === "absent" || outcome.kind === "already") continue;
      process.stderr.write(`[sessions] could not mark spawned session ${sessionFile}: ${outcome.kind}\n`);
    }
  }

  /**
   * Return a delegated child to the inbox as a session in its own right.
   *
   * Keyed by file rather than by session id: a spawned child is not open, and
   * the caller learns of it from a tool result that reports a path. The path is
   * therefore checked against the sessions root before anything is written, so
   * a request cannot reach a file elsewhere on the disk.
   */
  async promoteSpawnedSession(sessionFile: string): Promise<void> {
    const configuredRoot = this.sessionManager.defaultSessionsRoot?.();
    if (configuredRoot === undefined) throw new Error("Sessions directory is unknown");
    const root = resolve(configuredRoot);
    const target = resolve(sessionFile);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error("Session file is outside the sessions directory");
    }

    await clearAgentSpawned(target);
    this.sessionHeaderCache.delete(target);
    this.sessionManager.invalidateSessionFile(target);
  }

  async detachParent(ref: PiSessionRef): Promise<void> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
    await clearParentSession(sessionFile);
    // The header cache memoizes the first successful read, and detach is the
    // only flow that rewrites a header; drop the stale entry so sibling child
    // counts and parent locations observe the cleared parent immediately.
    this.sessionHeaderCache.delete(sessionFile);
    // The same in-place rewrite is invisible to the gateway's summary memo
    // (same inode, possibly grown file), which would otherwise keep listing
    // the old parent link and a stale message count until restart.
    this.sessionManager.invalidateSessionFile(sessionFile);
    clearParentSessionHeader(session.sessionManager);
    await this.forgetUnreadSessions([{ sessionId: session.sessionId, cwd: session.sessionManager.getCwd() }]);
  }

  async clearQueue(ref: PiSessionRef): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.clearDeferredCompactionWork(session.sessionId);
    clearSessionQueue(session);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async dismissWarning(ref: PiSessionRef, dismissId: string): Promise<ClientSessionStatus> {
    const session = await this.getOrOpen(ref);
    dismissSessionWarning(session, dismissId);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async abort(ref: PiSessionRef): Promise<SessionAbortResult> {
    if (this.pullRequestWatches !== undefined || this.actionRunWatches !== undefined) {
      const target = await this.resolvePinTarget(ref);
      await this.pullRequestWatches?.stop(target?.sessionId ?? ref.id, "Session aborted by request.");
      await this.actionRunWatches?.stop(target?.sessionId ?? ref.id, "Session aborted by request.");
    }
    const active = this.activeForRef(ref);
    if (active === undefined) return { aborted: true, restoredMessages: [] };
    const session = active.runtime.session;
    const sessionId = session.sessionId;
    const restoredMessages = this.queuedMessages(session);
    this.clearDeferredCompactionWork(sessionId);
    clearSessionQueue(session);
    // Settle run-scoped dialogs now, at abort-request time: pi's agent loop
    // waits for a parked `tool_call` dialog handler before it can emit
    // `agent_end`, so leaving settlement to the `agent_end` observer would
    // strand the dialog until its timeout. Settling before the runtime abort
    // also means a failing or hung abort cannot strand the parked waiter.
    this.abortRunScopedExtensionDialogs(sessionId);
    try {
      await this.abortSessionOperations(session);
      this.publishActivity(session, "stopped", "idle");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(active.runtime.session, "stop failed", "error", message);
      throw error;
    } finally {
      this.publishStatus(session);
    }
    return { aborted: true, restoredMessages };
  }

  async stop(ref: PiSessionRef): Promise<void> {
    if (this.pullRequestWatches !== undefined || this.actionRunWatches !== undefined) {
      const target = await this.resolvePinTarget(ref);
      await this.pullRequestWatches?.stop(target?.sessionId ?? ref.id, "Session stopped by request.");
      await this.actionRunWatches?.stop(target?.sessionId ?? ref.id, "Session stopped by request.");
    }
    const active = this.activeForRef(ref);
    if (active !== undefined) {
      await this.closeActive(active.runtime.session.sessionId);
      return;
    }
    // A session whose open is parked (e.g. on a session_start dialog) is not
    // active yet; close it through the same path so stopping cannot block
    // behind the dialog timeout.
    const startup = this.startupSessionForRef(ref);
    if (startup !== undefined) {
      await this.closeActive(startup.sessionId);
      return;
    }
    this.publishNotificationMutations(this.notificationStore.clearSessionIdentity(ref.id, canonicalizeStoredCwd(ref.cwd), "runtime-close"));
  }

  private async bulkSessionRefContext(refs: readonly SessionBulkMutationRef[]): Promise<BulkSessionRefContext> {
    const cwdSet = new Set<string>();
    for (const ref of refs) cwdSet.add(ref.cwd);
    return { sessionsByCwd: await this.listSessionsByCwd([...cwdSet]) };
  }

  private async listSessionsByCwd(cwds: readonly string[]): Promise<Map<string, PiSessionListEntry[]>> {
    const uniqueCwds = uniqueStrings(cwds);
    const entries = await Promise.all(uniqueCwds.map(async (cwd) => {
      const listed = await this.sessionManager.list(cwd);
      const known = new Set(listed.map((session) => session.id));
      for (const saved of await this.withSessionWorktrees([], cwd)) {
        if (known.has(saved.id)) continue;
        const readonly = await this.sessionWorktrees?.store.readOnly(saved);
        if (readonly === undefined) continue;
        listed.push({ ...saved, path: readonly.transcriptPath, created: new Date(saved.created), modified: new Date(saved.modified), allMessagesText: "" });
      }
      return [cwd, listed] as const;
    }));
    return new Map(entries);
  }

  private scheduleSearchScan(): void {
    void this.sessionSearch?.scan().catch((error: unknown) => {
      this.logger.info({ err: error }, "session search scan failed");
    });
  }

  private async archiveStoreArchiveMany(inputs: readonly ArchiveSessionInput[]): Promise<ArchivedSessionRecord[]> {
    if (inputs.length === 0) return [];
    for (const input of inputs) await this.closeSessionManagedProcesses(input.sessionId, input.path);
    if (this.archiveStore.archiveMany !== undefined) {
      const records = await this.archiveStore.archiveMany(inputs);
      this.scheduleSearchScan();
      return records;
    }
    const records: ArchivedSessionRecord[] = [];
    for (const input of inputs) records.push(await this.archiveStore.archive(input));
    this.scheduleSearchScan();
    return records;
  }

  private async archiveStoreDeleteArchivedMany(sessionIds: readonly string[]): Promise<string[]> {
    // Never remove .durable/<name>/ because <name>.jsonl is gone; forks share that journal.
    if (sessionIds.length === 0) return [];
    for (const sessionId of sessionIds) await this.closeSessionManagedProcesses(sessionId);
    if (this.archiveStore.deleteArchivedMany !== undefined) {
      const deleted = await this.archiveStore.deleteArchivedMany(sessionIds);
      this.scheduleSearchScan();
      return deleted;
    }
    if (this.archiveStore.deleteArchived === undefined) throw new Error("Archive store does not support deletion");
    for (const sessionId of sessionIds) await this.archiveStore.deleteArchived(sessionId);
    this.scheduleSearchScan();
    return [...sessionIds];
  }

  private async cleanupPlan(request: NormalizedSessionCleanupRequest) {
    const [sessions, archivedRecords, pinnedRecords] = await Promise.all([this.sessionManager.listAll(), this.archiveStore.list(), this.pinStore.list()]);
    return planSessionCleanup({
      sessions,
      pinnedSessionIds: pinnedSessionIdSet(pinnedRecords),
      archivedRecords,
      activeSessions: this.cleanupActiveSessionStatuses(),
      thresholds: request.thresholds,
      ...(request.projectCwds === undefined ? {} : { projectCwds: request.projectCwds }),
      now: this.now(),
    });
  }

  private cleanupActiveSessionStatuses(): { sessionId: string; hasActiveWork: boolean }[] {
    return [...new Set(this.active.values())].map((active) => ({
      sessionId: active.runtime.session.sessionId,
      hasActiveWork: this.hasActiveWork(active.runtime.session),
    }));
  }

  private activeSessionHasWork(sessionId: string): boolean {
    const active = this.active.get(sessionId);
    return active !== undefined && this.hasActiveWork(active.runtime.session);
  }

  private reconcilableSessionIds(cwd: string, listedSessionIds: string[], archivedById: Map<string, ArchivedSessionRecord>): string[] {
    const sessionIds = new Set(listedSessionIds);
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd && !archivedById.has(session.sessionId)) sessionIds.add(session.sessionId);
    }
    return [...sessionIds];
  }

  private async archiveInputForSession(session: PiAgentSession): Promise<ArchiveSessionInput> {
    const cwd = session.sessionManager.getCwd();
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
    const listed = (await this.sessionManager.list(cwd)).find((candidate) => candidate.id === session.sessionId);
    if (listed !== undefined) return archiveInputFromListEntry(listed);
    return archiveInputFromActiveSession(session);
  }

  private async workspaceArchiveCandidates(cwd: string): Promise<WorkspaceArchiveCandidate[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const candidates = new Map<string, WorkspaceArchiveCandidate>();
    const archivedById = new Map<string, ArchivedSessionRecord>();

    for (const record of archivedRecords) {
      if (record.cwd === cwd) archivedById.set(record.sessionId, record);
    }

    for (const session of sessions) {
      const archived = archivedById.get(session.id);
      if (archived === undefined) candidates.set(session.id, archiveCandidateFromListEntry(session));
      else {
        const candidate = archiveCandidateFromArchivedRecord(archived, session);
        if (candidate !== undefined) candidates.set(candidate.id, candidate);
      }
    }

    for (const record of archivedById.values()) {
      if (candidates.has(record.sessionId)) continue;
      const candidate = archiveCandidateFromArchivedRecord(record, undefined);
      if (candidate !== undefined) candidates.set(candidate.id, candidate);
    }

    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() !== cwd || archivedById.has(session.sessionId)) continue;
      const existing = candidates.get(session.sessionId);
      candidates.set(session.sessionId, { ...(existing ?? archiveCandidateFromActiveSession(session, false)), activeSession: session });
    }

    return [...candidates.values()];
  }

  private async listSessionNames(cwd: string): Promise<string[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const names = new Set<string>();
    for (const session of sessions) addSessionName(names, session.name);
    for (const record of archivedRecords) {
      if (record.cwd === cwd) addSessionName(names, record.name);
    }
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd) addSessionName(names, session.sessionName);
    }
    return [...names];
  }

  private async closeActive(sessionId: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    if (notificationPolicy.kind === "clear" && (notificationPolicy.reason === "archive" || notificationPolicy.reason === "delete")) {
      await this.pullRequestWatches?.stop(sessionId, "Session archived or deleted.");
      await this.actionRunWatches?.stop(sessionId, "Session archived or deleted.");
    }
    // A session whose open is parked on a `session_start` dialog holds its
    // pending open until the dialog settles; settle it first so closing cannot
    // block behind the dialog timeout (which `0` makes infinite).
    if (this.startupSessions.has(sessionId)) this.endSessionExtensionDialogs(sessionId);
    const pendingOpens = this.pendingSessionOpenPromises(sessionId);
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const active = this.active.get(sessionId);
    if (notificationPolicy.kind === "clear") {
      const generation = active === undefined ? undefined : this.notificationGenerationBySession.get(active.runtime.session);
      const mutations = generation === undefined
        ? this.notificationStore.clearSession(sessionId, notificationPolicy.reason)
        : this.notificationStore.clearGeneration(generation, notificationPolicy.reason);
      this.publishNotificationMutations(mutations);
    }
    if (!active) return;
    this.retireAttentionSession(active.runtime.session);
    this.forgetUnreadActivity(active.runtime.session);
    // Questions remain on the durable branch. Only live extension dialogs own
    // parked Promises in the dying runtime, so settle those waits.
    this.endSessionExtensionDialogs(sessionId);
    this.active.delete(sessionId);
    this.activities.delete(sessionId);
    this.workspaceActivity?.removeSession(sessionId, active.runtime.session.sessionManager.getCwd());
    this.clearDeferredCompactionWork(sessionId);
    clearSessionQueue(active.runtime.session);
    active.unsubscribe();
    active.runtime.setRebindSession(undefined);
    try {
      await this.abortSessionOperations(active.runtime.session);
    } finally {
      this.cancelSessionTitleGeneration(active.runtime.session);
      active.runtime.services?.sessionTitleBridgeSlot?.dispose();
      this.processPanels.get(active.runtime.session.sessionId)?.dispose();
      this.processPanels.delete(active.runtime.session.sessionId);
      await active.runtime.dispose();
    }
  }

  private async abortSessionOperations(session: PiAgentSession): Promise<void> {
    await this.waitForCompactionStart(session);
    session.abortCompaction();
    let branchSummaryAbortFailed = false;
    let branchSummaryAbortError: unknown;
    try {
      session.abortBranchSummary?.();
    } catch (error: unknown) {
      branchSummaryAbortFailed = true;
      branchSummaryAbortError = error;
    }

    try {
      await session.abort();
    } catch (abortError: unknown) {
      if (branchSummaryAbortFailed) {
        throw new AggregateError([branchSummaryAbortError, abortError], "Failed to abort session operations", { cause: abortError });
      }
      throw abortError;
    }
    if (branchSummaryAbortFailed) throw branchSummaryAbortError;
  }

  private async assertWritable(ref: PiSessionRef): Promise<void> {
    await this.sessionWorktrees?.store.assertWritable(ref);
    if (await this.getArchived(ref) !== undefined) throw new Error("Archived sessions are read-only. Restore the session to continue.");
  }

  private async getOrOpen(ref: PiSessionRef): Promise<PiAgentSession> {
    return (await this.getActive(ref)).runtime.session;
  }

  private async historySessionManager(
    ref: PiSessionRef,
    open: (path: string) => PiSessionManager | Promise<PiSessionManager> = (path) => this.sessionManager.open(path),
  ): Promise<PiSessionManager> {
    const active = this.activeForRef(ref);
    if (active !== undefined) return active.runtime.session.sessionManager;

    const archived = await this.getArchived(ref);
    if (archived?.archivePath !== undefined) return open(archived.archivePath);
    const readonly = await this.sessionWorktrees?.store.readOnly(ref);
    if (readonly !== undefined) return open(readonly.transcriptPath);

    const match = await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader);
    if (!match) throw new Error("Session not found");
    return open(match.path);
  }

  private assertSessionOpenAllowed(stopped: () => boolean): void {
    if (this.stopping || stopped()) throw new Error("Session service is shutting down");
  }

  private async getActive(ref: PiSessionRef, options: Pick<CreateSessionRuntimeOptions, "notificationGeneration"> = {}, stopped: () => boolean = () => false): Promise<ActiveSession<PiSessionRuntime>> {
    this.assertSessionOpenAllowed(stopped);
    await this.sessionWorktrees?.store.assertWritable(ref);
    const active = this.activeForRef(ref);
    if (active !== undefined) return active;

    const archived = await this.getArchived(ref);
    if (archived?.archivePath !== undefined) {
      this.assertSessionOpenAllowed(stopped);
      const { archivePath } = archived;
      return this.openExistingSession(
        archived.sessionId,
        archived.cwd,
        () => this.sessionManager.open(archivePath),
        { notifications: "disabled" },
      );
    }

    // Resolve the session file directly by id: opening one inactive session
    // must not pay for a full transcript listing of its whole workspace.
    const match = await this.sessionManager.resolveSessionFile(ref.cwd, ref.id, this.readCachedSessionHeader);
    if (!match) throw new Error("Session not found");
    this.assertSessionOpenAllowed(stopped);
    return this.openExistingSession(match.id, match.cwd, () => this.sessionManager.open(match.path), options);
  }

  private openExistingSession(
    sessionId: string,
    cwd: string,
    openSessionManager: () => PiSessionManager,
    options: Pick<CreateSessionRuntimeOptions, "notificationGeneration" | "notifications" | "initialModel" | "initialThinkingLevel"> = {},
  ): Promise<ActiveSession<PiSessionRuntime>> {
    if (this.stopping) return Promise.reject(new Error("Session service is shutting down"));
    const active = this.activeForRef({ id: sessionId, cwd });
    if (active !== undefined) return Promise.resolve(active);

    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionId]);
    const existing = this.pendingSessionOpens.get(key);
    if (existing !== undefined) return existing.promise;

    const pending: PendingSessionOpen = {
      sessionId,
      promise: this.create(openSessionManager(), cwd, options),
    };
    pending.promise = pending.promise.finally(() => {
      if (this.pendingSessionOpens.get(key) === pending) this.pendingSessionOpens.delete(key);
    });
    this.pendingSessionOpens.set(key, pending);
    return pending.promise;
  }

  private pendingSessionOpenPromises(sessionId?: string): Promise<ActiveSession<PiSessionRuntime>>[] {
    return [...this.pendingSessionOpens.values()]
      .filter((pending) => sessionId === undefined || pending.sessionId === sessionId)
      .map((pending) => pending.promise);
  }

  private async getArchived(ref: PiSessionRef): Promise<ArchivedSessionRecord | undefined> {
    const archived = await this.archiveStore.get(ref.id);
    if (archived === undefined) return undefined;
    if (archived.cwd !== ref.cwd) return undefined;
    return archived;
  }

  private isCurrentActiveSession(session: PiAgentSession): boolean {
    return this.active.get(session.sessionId)?.runtime.session === session;
  }

  /** Only Decision hints publications require this stronger runtime ownership check.
   * Legacy publishers also serve startup sessions that are not active yet.
   */
  private isCurrentDecisionHintSession(session: PiAgentSession): boolean {
    return !this.stopping && !(session instanceof DurableAgentSession && session.isClosed) && this.isCurrentActiveSession(session);
  }

  private publishDecisionHintStatus(session: PiAgentSession): void {
    const current = this.active.get(session.sessionId)?.runtime.session;
    if (current === session && this.isCurrentDecisionHintSession(current)) this.publishStatus(current);
  }

  /**
   * The command service tracks sessions by id alone; its callbacks only ever
   * run against a session the caller just resolved as active, so the cwd
   * needed for a full ref comes from that active runtime.
   */
  private activeSessionRef(sessionId: string): PiSessionRef {
    const active = this.active.get(sessionId);
    if (active === undefined) throw new Error("Session not found");
    return { id: sessionId, cwd: active.runtime.cwd };
  }

  private activeForRef(ref: PiSessionRef): ActiveSession<PiSessionRuntime> | undefined {
    const sessionId = ref.id;
    const exact = this.active.get(sessionId);
    if (exact !== undefined && refMatchesActiveSession(ref, exact)) return exact;
    for (const [candidateId, active] of this.active.entries()) {
      if (candidateId.startsWith(sessionId) && refMatchesActiveSession(ref, active)) return active;
    }
    return undefined;
  }

  private startupSessionForRef(ref: PiSessionRef): PiAgentSession | undefined {
    const sessionId = ref.id;
    const exact = this.startupSessions.get(sessionId);
    if (exact !== undefined && refMatchesStartupSession(ref, exact)) return exact;
    for (const [candidateId, session] of this.startupSessions.entries()) {
      if (candidateId.startsWith(sessionId) && refMatchesStartupSession(ref, session)) return session;
    }
    return undefined;
  }

  /**
   * The session to serve a read-only status or a dialog close for, while it
   * can still be found: active first, then still starting up, and only then
   * the on-demand open path (which a stale close on an idle session needs for
   * its status projection).
   */
  private async sessionForStatusOrDialogClose(ref: PiSessionRef): Promise<PiAgentSession> {
    const reachable = this.activeForRef(ref)?.runtime.session ?? this.startupSessionForRef(ref);
    if (reachable !== undefined) return reachable;
    return this.getOrOpen(ref);
  }

  /**
   * Construct a session while telling waiting browsers which phase of startup
   * they are waiting on. The reporting wraps the *whole* construction rather
   * than the inner bookkeeping `try`, because the runtime construction that runs
   * first is both the slowest phase and one that can fail on its own; a clear
   * that only ran for the later phases would leave a stale label behind.
   */
  private async create(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions = {},
  ): Promise<ActiveSession<PiSessionRuntime>> {
    const startup = this.startupProgress(sessionManager, options.startupIntent ?? "open", options.startupToken);
    // A new start has no catalog entry or pending-open receipt until runtime construction finishes.
    const constructing = { id: sessionManager.getSessionId(), cwd };
    this.constructingSessions.add(constructing);
    try {
      return await this.createSessionRuntime(sessionManager, cwd, options, startup);
    } finally {
      this.constructingSessions.delete(constructing);
      startup.end();
    }
  }

  private async createSessionRuntime(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions,
    startup: SessionStartupProgressReporter,
  ): Promise<ActiveSession<PiSessionRuntime>> {
    startup.report(STARTUP_PHASE_RUNTIME);
    const delegationToolsEnabled = await sessionAllowsDelegationTools(sessionManager, this.sessionManager);
    const settings = SettingsManager.create(cwd, this.agentDir);
    const scopedModels = await resolveEnabledModels(settings, this.modelRuntime);
    const runtime = await this.createAgentRuntime(this.createRuntime, {
      cwd,
      agentDir: this.agentDir,
      sessionManager,
      delegationToolsEnabled,
      scopedModels,
      ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
      ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
    });
    const active: ActiveSession<PiSessionRuntime> = { runtime, unsubscribe: noop };
    this.bindProcessPanel(runtime.session);
    this.bindSessionTitleBridge(runtime, runtime.session);
    let boundSession = runtime.session;
    let notificationGeneration = options.notificationGeneration;
    let notificationOwnership: "disabled" | "external" | "registered" | "replacement" = options.notifications === "disabled"
      ? "disabled"
      : notificationGeneration === undefined
        ? "registered"
        : "external";

    if (notificationOwnership === "registered") {
      const notificationIdentity = notificationIdentityForSession(runtime.session);
      const existingCandidate = this.notificationStore.beginReplacementForSession(
        notificationIdentity.sessionId,
        notificationIdentity.cwd,
      );
      if (existingCandidate !== undefined) {
        notificationGeneration = existingCandidate;
        notificationOwnership = "replacement";
      } else {
        const registration = this.notificationStore.registerSession(
          notificationIdentity.sessionId,
          notificationIdentity.cwd,
        );
        notificationGeneration = registration.generation;
        this.publishNotificationMutations(registration.mutations);
      }
    }
    if (notificationGeneration !== undefined) this.notificationGenerationBySession.set(runtime.session, notificationGeneration);

    try {
      await this.restoreAttentionHint(runtime.session);
      await this.excludeVerifiedHistoricalChildFromUnread(runtime.session);
      startup.report(STARTUP_PHASE_EXTENSIONS);
      if (options.creationProvenance === "detached-handoff") this.detachedHandoffStartupSessions.add(runtime.session);
      try {
        await this.bindSessionExtensions(runtime.session, notificationGeneration);
      } finally {
        this.detachedHandoffStartupSessions.delete(runtime.session);
      }
      this.bindRuntime(active);
      this.recoverAskAnswerDelivery(runtime.session);
      runtime.setRebindSession(async (session) => {
        const outgoingSession = boundSession;
        const priorGeneration = notificationGeneration;
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          this.attentionHints.invalidate(this.attentionSession(boundSession));
          await this.prepareUnreadRuntimeRebind(boundSession, session);
          await this.restoreAttentionHint(session);
          await this.excludeVerifiedHistoricalChildFromUnread(session);
          if (priorGeneration !== undefined) {
            candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          this.cancelSessionTitleGeneration(boundSession);
          if (boundSession.sessionId !== session.sessionId) {
            this.processPanels.get(boundSession.sessionId)?.dispose();
            this.processPanels.delete(boundSession.sessionId);
          }
          this.bindProcessPanel(session);
          this.bindSessionTitleBridge(runtime, session);
          this.bindRuntime(active, session);
          this.recoverAskAnswerDelivery(session);
          // The runtime being replaced parked every dialog the store still
          // holds for this session; settle those waits before the new
          // runtime's extensions can open fresh dialogs under the same id.
          this.endSessionExtensionDialogs(boundSession.sessionId);
          boundSession = session;
          await this.bindSessionExtensions(session, candidateGeneration);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
            notificationGeneration = candidateGeneration;
          }
          if (outgoingSession !== session) this.retireAttentionSession(outgoingSession);
        } catch (error: unknown) {
          if (outgoingSession !== session) this.retireAttentionSession(session);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            notificationGeneration = candidateGeneration;
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          throw error;
        }
      });
      this.active.set(runtime.session.sessionId, active);
      if (notificationOwnership === "replacement" && notificationGeneration !== undefined) {
        this.publishNotificationMutations(this.notificationStore.commitReplacement(notificationGeneration));
        notificationOwnership = "external";
      }
      this.publishStatus(runtime.session);
      return active;
    } catch (error: unknown) {
      this.retireAttentionSession(boundSession);
      this.retireAttentionSession(runtime.session);
      if (notificationGeneration !== undefined) {
        if (notificationOwnership === "registered") {
          this.publishNotificationMutations(this.notificationStore.clearSession(runtime.session.sessionId, "initialization-failed"));
        } else if (notificationOwnership === "replacement") {
          this.publishNotificationMutations(this.notificationStore.abortReplacement(notificationGeneration));
        }
      }
      active.unsubscribe();
      this.forgetUnreadActivity(boundSession);
      // A session_start dialog may already be parked when a later startup
      // step fails; its waiter dies with the runtime being torn down here.
      this.endSessionExtensionDialogs(boundSession.sessionId);
      let removedActive = false;
      for (const [sessionId, candidate] of this.active.entries()) {
        if (candidate !== active) continue;
        this.active.delete(sessionId);
        this.activities.delete(sessionId);
        this.clearDeferredCompactionWork(sessionId);
        removedActive = true;
      }
      if (removedActive) {
        this.workspaceActivity?.removeSession(runtime.session.sessionId, runtime.session.sessionManager.getCwd());
      }
      try {
        await runtime.session.abort();
      } finally {
        this.cancelSessionTitleGeneration(runtime.session);
        runtime.services?.sessionTitleBridgeSlot?.dispose();
        this.processPanels.get(runtime.session.sessionId)?.dispose();
        this.processPanels.delete(runtime.session.sessionId);
        await runtime.dispose();
      }
      throw error;
    }
  }

  private async bindSessionExtensions(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
  ): Promise<void> {
    const uiContext = this.sessionUiContext(session, generation);
    // A `session_start` hook can park this bind on a dialog the browser has
    // not answered yet. On the initial create/open path the session becomes
    // active only after this returns, so register it for the duration: the
    // answer that unblocks startup has to be reachable while it waits.
    this.startupSessions.set(session.sessionId, session);
    try {
      await session.bindExtensions({
        uiContext,
        mode: "rpc",
        onError: (error) => {
          if (error.extensionPath === "<durable>" && error.event === DECISION_HINT_ERROR_EVENT && !this.isCurrentDecisionHintSession(session)) return;
          const message = `${error.extensionPath}: ${error.error}`;
          this.publishActivity(session, "extension error", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message });
        },
      });
    } finally {
      this.startupSessions.delete(session.sessionId);
    }
  }

  private replaceSessionNotificationContext(session: PiAgentSession, generation: SessionNotificationGeneration): void {
    session.extensionRunner.setUIContext(this.sessionUiContext(session, generation), "rpc");
  }

  private sessionUiContext(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
  ): ExtensionUIContext {
    const baseUiContext = session.extensionRunner.getUIContext();
    const notify: ExtensionUIContext["notify"] = (message, type) => {
      if (generation === undefined) {
        this.events.publish(session.sessionId, {
          type: "command.output",
          level: type === "error" ? "error" : "info",
          message,
        });
        return;
      }
      const added = this.notificationStore.addNotification(generation, message, type);
      this.publishNotificationMutations(added.mutations);
    };
    // Forgerie owns the browser-facing dialog, notification, and text-formatting
    // boundaries: the three dialog primitives park daemon-held Promises that
    // the browser answers, while every other UI method delegates to Pi's
    // headless defaults.
    //
    // The two surfaces that draw a terminal to collect an answer are refused
    // rather than delegated. Pi's headless defaults resolve them with
    // `undefined`, which is the same value they carry when a user walks away
    // from a real terminal, so extension code reports a cancel that nobody
    // performed. A rejection reaches the model as a tool error naming the
    // browser-backed alternatives instead.
    return new Proxy(baseUiContext, {
      get: (target, property, receiver): unknown => {
        if (property === "notify") return notify;
        if (property === "theme") return plainTextTheme;
        if (property === "custom") {
          return () => Promise.reject(new Error(TERMINAL_ONLY_UI_REFUSAL.custom));
        }
        if (property === "editor") {
          return () => Promise.reject(new Error(TERMINAL_ONLY_UI_REFUSAL.editor));
        }
        if (property === "confirm") {
          return (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "confirm", title, message }, opts);
        }
        if (property === "select") {
          return (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "select", title, options }, opts);
        }
        if (property === "input") {
          return (title: string, placeholder: string | undefined, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "input", title, placeholder }, opts);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
  }

  private publishNotificationMutations(mutations: readonly SessionNotificationMutation[]): void {
    for (const mutation of mutations) {
      this.events.publish(mutation.sessionId, mutation.inboxEvent);
      this.events.publishNotificationSummary(mutation.summaryEvent);
    }
  }

  private async prepareUnreadRuntimeRebind(previous: PiAgentSession, next: PiAgentSession): Promise<void> {
    const previousCwd = canonicalizeStoredCwd(previous.sessionManager.getCwd());
    this.unreadStore.forgetActivity(previous.sessionId, previousCwd);
    const nextCwd = canonicalizeStoredCwd(next.sessionManager.getCwd());
    if (previous.sessionId === next.sessionId && cwdPathsEqual(previousCwd, nextCwd)) return;
    await this.publishUnreadMutations(this.unreadStore.forgetSession(previous.sessionId, previousCwd));
  }

  private forgetUnreadActivity(session: PiAgentSession): void {
    this.unreadStore.forgetActivity(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
    );
  }

  private async forgetUnreadSessions(identities: readonly { sessionId: string; cwd: string }[]): Promise<void> {
    if (this.sessionWorktrees !== undefined) {
      for (const identity of identities) {
        if (!await this.archiveStore.isArchived(identity.sessionId)) continue;
        const record = await this.sessionWorktrees.store.forSession({ id: identity.sessionId, cwd: identity.cwd });
        if (record?.sessionId !== identity.sessionId || record.state.kind !== "active") continue;
        const sessions = await this.worktreeSessionInventory(record.path);
        await this.sessionWorktrees.archiveCleanup(record.id, sessions);
      }
    }
    const mutations: SessionUnreadMutation[] = [];
    for (const identity of identities) {
      mutations.push(...this.unreadStore.forgetSession(
        identity.sessionId,
        canonicalizeStoredCwd(identity.cwd),
      ));
    }
    await this.publishUnreadMutations(mutations);
  }

  private observeUnreadActivityState(session: PiAgentSession): void {
    const mutations = this.unreadStore.observeActivityState(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
      this.hasActiveWork(session),
    );
    if (mutations.length === 0) return;
    void this.publishUnreadMutations(mutations).catch(() => undefined);
  }

  private publishUnreadMutations(mutations: readonly SessionUnreadMutation[]): Promise<void> {
    this.enqueueUnreadMutations(mutations);
    this.unreadPublicationFlushRequested = true;
    if (this.unreadPublication === undefined && this.unreadPublicationRetryTimer !== undefined) {
      const failure = this.unreadPublicationFailure;
      return Promise.reject(failure instanceof Error
        ? failure
        : new Error("Session unread publication is awaiting retry", { cause: failure }));
    }
    return this.ensureUnreadPublication();
  }

  private ensureUnreadPublication(): Promise<void> {
    const existing = this.unreadPublication;
    if (existing !== undefined) return existing;

    const publication = this.drainUnreadPublication();
    this.unreadPublication = publication;
    void publication.then(
      () => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
      },
      (error: unknown) => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
        this.unreadPublicationFailure = error;
        this.logger.info(
          { error: error instanceof Error ? error.message : String(error) },
          "failed to publish durable session unread mutations",
        );
        this.scheduleUnreadPublicationRetry();
      },
    );
    return publication;
  }

  private async drainUnreadPublication(): Promise<void> {
    while (this.unreadPublicationFlushRequested || this.pendingUnreadMutations.length > 0) {
      this.unreadPublicationFlushRequested = false;
      const batch = this.pendingUnreadMutations.splice(0);
      let publishedCount = 0;
      try {
        await this.unreadStore.flush();
        for (const mutation of batch) {
          this.events.publishGlobal(mutation.event);
          publishedCount += 1;
        }
      } catch (error: unknown) {
        this.prependUnreadMutations(batch.slice(publishedCount));
        this.unreadPublicationFlushRequested = true;
        throw error;
      }
      this.unreadPublicationFailure = undefined;
      this.clearUnreadPublicationRetry();
    }
  }

  private enqueueUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.push(...mutations);
    this.trimPendingUnreadMutations();
  }

  private prependUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.unshift(...mutations);
    this.trimPendingUnreadMutations();
  }

  private trimPendingUnreadMutations(): void {
    const excess = this.pendingUnreadMutations.length - MAX_PENDING_UNREAD_MUTATIONS;
    if (excess > 0) this.pendingUnreadMutations.splice(0, excess);
  }

  private scheduleUnreadPublicationRetry(): void {
    if (this.unreadPublicationStopped || this.unreadPublicationRetryTimer !== undefined) return;
    const delay = this.unreadPublicationRetryDelayMs;
    this.unreadPublicationRetryDelayMs = Math.min(
      Math.max(delay * 2, this.unreadPublicationRetryInitialMs),
      Math.max(MAX_UNREAD_PUBLICATION_RETRY_MS, this.unreadPublicationRetryInitialMs),
    );
    this.unreadPublicationRetryTimer = setTimeout(() => {
      this.unreadPublicationRetryTimer = undefined;
      void this.ensureUnreadPublication().catch(() => undefined);
    }, delay);
    this.unreadPublicationRetryTimer.unref();
  }

  private clearUnreadPublicationRetry(): void {
    if (this.unreadPublicationRetryTimer !== undefined) clearTimeout(this.unreadPublicationRetryTimer);
    this.unreadPublicationRetryTimer = undefined;
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
  }

  private readonly processPanels = new Map<string, ManagedProcessPanel>();

  private bindProcessPanel(session: PiAgentSession): void {
    this.processPanels.get(session.sessionId)?.dispose();
    if (this.managedProcesses === undefined) return;
    // Archived/read-only runtimes intentionally have no daemon-owned dispatcher.
    if (session instanceof DurableAgentSession && session.processTools === undefined) {
      this.processPanels.delete(session.sessionId);
      return;
    }
    const panel = new ManagedProcessPanel(() => this.getManagedProcesses(session.sessionId),
      session instanceof DurableAgentSession ? session.processTools : undefined,
      (event) => { this.events.publish(session.sessionId, event); if (event.type === "processes.update") this.publishStatus(session); },
      () => { this.logger.info({ sessionId: session.sessionId }, "managed process panel refresh failed"); });
    this.processPanels.set(session.sessionId, panel);
    panel.watch();
  }

  private bindSessionTitleBridge(runtime: PiSessionRuntime, session: PiAgentSession): void {
    runtime.services?.sessionTitleBridgeSlot?.setReceiver(
      (event) => { this.handleSessionTitleBridgeEvent(session, event); },
      (error) => {
        this.logger.info(
          { sessionId: session.sessionId, error: error instanceof Error ? error.message : String(error) },
          "session title bridge receiver failed",
        );
      },
    );
  }

  private handleSessionTitleBridgeEvent(session: PiAgentSession, event: SessionTitleBridgeEvent): void {
    if (event.type === "intent.accepted") {
      this.acceptSessionTitleIntent(session, event.text);
      return;
    }
    this.cancelSessionTitleGeneration(session);
    this.claimedSessionTitleIntents.delete(session);
  }

  private bindRuntime(active: ActiveSession<PiSessionRuntime>, session: PiAgentSession = active.runtime.session): void {
    active.unsubscribe();
    for (const [sessionId, candidate] of this.active.entries()) {
      if (candidate === active) {
        this.active.delete(sessionId);
        if (sessionId !== session.sessionId) this.clearDeferredCompactionWork(sessionId);
      }
    }
    active.unsubscribe = session.subscribe((event) => {
      if (getString(event, "type") === "session_retired") { this.retireAttentionSession(session); return; }
      // The marker belongs only to the optional annotation observer. Do not
      // filter pre-existing lifecycle, dialog, process or child-status events.
      if (getBoolean(event, "decisionHint") === true && !this.isCurrentDecisionHintSession(session)) return;
      if (getString(event, "type") === "agent_start") this.attentionHints.started(this.attentionSession(session));
      if (getString(event, "type") === "agent_start") this.appendResponseEvent(session, { version: 1, kind: "started" });
      this.events.publish(session.sessionId, toClientEvent(event, session.thinkingLevel));
      this.publishActivityForEvent(session, event);
      const eventType = getString(event, "type");
      if (eventType === "session_info_changed") {
        this.cancelSessionTitleGeneration(session);
        this.rememberSessionName(session);
        this.publishSessionName(session);
      }
      if (eventType === "durable_parent_state_changed") this.checkpointResponse(session);
      if (eventType === "agent_end") {
        this.checkpointResponse(session);
        this.abortRunScopedExtensionDialogs(session.sessionId);
      }
      // agent_end precedes extension handlers and retries. agent_settled fires
      // after agent_end handlers and transcript projection finish.
      if (eventType === "agent_settled") this.attentionHints.settled(this.attentionSession(session));
      if (eventType === "agent_settled" && session.sessionFile !== undefined) {
        void this.sessionSearch?.refreshFile(session.sessionFile).catch((error: unknown) => {
          this.logger.info({ err: error, sessionId: session.sessionId }, "session search refresh failed");
        });
      }
      if (eventType === "compaction_start") this.resolveCompactionStartGate(session.sessionId);
      if (eventType === "compaction_end") this.scheduleCompactionQueueDrain(session.sessionId);
      if (eventType === "agent_start" || eventType === "agent_end") this.scheduleCompactionQueueDrain(session.sessionId);
      if (eventType === "agent_start" || eventType === "agent_end" || eventType === "compaction_end") this.scheduleQueuedCompaction(session.sessionId);
      this.publishStatus(session);
    });
    this.active.set(session.sessionId, active);
    this.rememberSessionName(session);
    if (session.sessionName !== undefined) this.publishSessionName(session);
  }

  private armCompactionStartGate(sessionId: string): void {
    if (this.compactionStartGates.has(sessionId)) return;
    let resolveGate: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => { resolveGate = resolve; });
    this.compactionStartGates.set(sessionId, { promise, resolve: () => { resolveGate?.(); } });
  }

  private resolveCompactionStartGate(sessionId: string): void {
    const gate = this.compactionStartGates.get(sessionId);
    if (gate === undefined) return;
    this.compactionStartGates.delete(sessionId);
    gate.resolve();
  }

  private async waitForCompactionStart(session: PiAgentSession): Promise<void> {
    if (session.isCompacting) return;
    await this.compactionStartGates.get(session.sessionId)?.promise;
  }

  private compactionMustWait(session: PiAgentSession): boolean {
    return session.isStreaming
      || session.isBashRunning
      || session.pendingMessageCount > 0
      || this.compactionQueue.readyPromptCount(session.sessionId) > 0
      || this.isSessionEntryMutationActive(session)
      || this.isTreeExclusiveOperationActive(session);
  }

  private scheduleQueuedCompaction(sessionId: string): void {
    if (!this.compactionQueue.isCompactionQueued(sessionId)) return;
    scheduleSessionTimer(this.queuedCompactionTimers, sessionId, 0, () => { this.drainQueuedCompaction(sessionId); });
  }

  private drainQueuedCompaction(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!this.compactionQueue.isCompactionQueued(sessionId) || active === undefined) return;
    const { session } = active.runtime;
    if (session.isCompacting || this.compactionMustWait(session)) return;

    const handle = this.compactionQueue.startCompaction(sessionId);
    if (handle === undefined) return;
    this.publishStatus(session);
    void this.commandService.run(sessionId, handle.text, { canStartCompaction: (session) => this.commitQueuedCompactionStart(session, handle) }).then((result) => {
      if (result.type === "unsupported") this.failQueuedCompaction(session, handle, result.message);
    }).catch((error: unknown) => {
      this.failQueuedCompaction(session, handle, error instanceof Error ? error.message : String(error));
    });
  }

  private commitQueuedCompactionStart(session: PiAgentSession, handle: QueuedCompactionHandle): boolean {
    const current = this.active.get(handle.sessionId)?.runtime.session;
    if (current !== session || session.isCompacting || this.compactionMustWait(session)) {
      if (this.compactionQueue.deferCompaction(handle)) this.scheduleQueuedCompaction(handle.sessionId);
      return false;
    }
    return this.compactionQueue.commitCompactionStart(handle);
  }

  private failQueuedCompaction(session: PiAgentSession, handle: QueuedCompactionHandle, message: string): void {
    if (!this.compactionQueue.failCompaction(handle)) return;
    this.events.publish(session.sessionId, { type: "command.output", level: "error", message: `Queued compaction failed to start: ${message}` });
    this.publishActivity(session, "compaction failed", "error", message);
    this.publishStatus(session);
    this.scheduleCompactionQueueDrain(session.sessionId);
  }

  private scheduleCompactionQueueDrain(sessionId: string, delayMs = 0): void {
    if (!this.compactionQueue.hasReadyPrompts(sessionId)) return;
    scheduleSessionTimer(this.compactionDrainTimers, sessionId, delayMs, () => { this.drainCompactionPromptQueue(sessionId); });
  }

  private drainCompactionPromptQueue(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (active === undefined) return;
    const { session } = active.runtime;
    if (this.compactionDrains.has(session)) return;
    if (session.isCompacting) {
      this.scheduleCompactionQueueDrain(sessionId, 100);
      return;
    }

    if (session.isStreaming) {
      const queued = this.compactionQueue.takeReadyPrompts(sessionId);
      if (queued.length === 0) return;
      this.publishStatus(session);
      this.compactionDrains.add(session);
      // Admission must finish in queue order, including request-ID lookups.
      // Another drain must not overtake this batch while admission awaits I/O.
      void (async () => {
        try { for (const prompt of queued) await this.submitCompactionPrompt(session, prompt, prompt.kind); }
        finally { this.compactionDrains.delete(session); this.scheduleCompactionQueueDrain(sessionId); }
      })();
      return;
    }

    const prompt = this.compactionQueue.shiftReadyPrompt(sessionId);
    if (prompt === undefined) return;
    this.publishStatus(session);
    const onCompletion = () => { this.scheduleCompactionQueueDrain(sessionId); };
    if (prompt.requestId === undefined) {
      void this.submitCompactionPrompt(session, prompt, undefined, onCompletion);
    } else {
      this.compactionDrains.add(session);
      void this.submitCompactionPrompt(session, prompt, undefined, onCompletion).finally(() => {
        this.compactionDrains.delete(session);
        this.scheduleCompactionQueueDrain(sessionId);
      });
    }
  }

  private async submitCompactionPrompt(session: PiAgentSession, prompt: QueuedPrompt, behavior: QueuedPromptKind | undefined, onCompletion?: () => void): Promise<void> {
    if (prompt.requestId === undefined) {
      await this.submitPrompt(session, prompt.text, behavior, prompt.images, prompt.echoUserMessage ?? true,
        prompt.expandPromptTemplates ?? true, undefined, onCompletion);
      return;
    }
    try {
      await this.withPromptRequest(session, prompt.requestId, async () => {
        await this.submitPromptUntilPreflight(session, prompt.text, behavior, prompt.images, prompt.echoUserMessage ?? true,
          prompt.expandPromptTemplates ?? true, onCompletion, prompt.requestId);
      }, null);
    } catch (error) {
      this.events.publish(session.sessionId, { type: "session.error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private clearDeferredCompactionWork(sessionId: string): void {
    this.compactionQueue.clear(sessionId);
    clearSessionTimer(this.compactionDrainTimers, sessionId);
    clearSessionTimer(this.queuedCompactionTimers, sessionId);
  }

  /**
   * The configured title model when the runtime offers it with credentials,
   * else the session's own model. A missing or unreadable title model is
   * logged, not fatal: the title then costs what it did before.
   */
  private titleModelFor(session: PiAgentSession): PiAgentSession["model"] {
    let spec: string | undefined;
    try {
      spec = this.sessionTitleModel?.();
    } catch (error: unknown) {
      this.logger.info({ sessionId: session.sessionId, outcome: "title_model_unreadable", error: errorMessage(error) }, "session title model setting is unreadable; using the session's model");
      return session.model;
    }
    if (spec === undefined) return session.model;
    const parsed = parseModelSpec(spec);
    const configured = parsed === undefined
      ? undefined
      : this.modelRuntime.getAvailableSnapshot().find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.modelId);
    if (configured !== undefined) return configured;
    this.logger.info({ sessionId: session.sessionId, sessionTitleModel: spec, outcome: "title_model_unavailable" }, "session title model is unavailable; using the session's model");
    return session.model;
  }

  private acceptSessionTitleIntent(session: PiAgentSession, titleInput: string): void {
    if (session.sessionName !== undefined || hasUserMessage(session.messages) || this.claimedSessionTitleIntents.has(session)) return;
    this.claimedSessionTitleIntents.add(session);
    const deterministicName = deterministicSessionName(titleInput);
    if (deterministicName !== undefined) {
      this.applyGeneratedSessionName(session, deterministicName);
      return;
    }

    const model = this.titleModelFor(session);
    if (model === undefined) {
      this.applyGeneratedSessionName(session, fallbackSessionName(titleInput));
      return;
    }

    const controller = new AbortController();
    this.sessionTitleGenerationControllers.set(session, controller);
    void generateShortSessionName(session.agent.streamFunction, model, titleInput, controller.signal, (failureKind) => {
      this.logger.info({ sessionId: session.sessionId, outcome: "fallback", failureKind }, "session title generation returned no usable name");
    }).then((name) => {
      this.applyGeneratedSessionName(session, name ?? fallbackSessionName(titleInput), controller);
    }).catch(() => {
      if (!controller.signal.aborted) {
        this.logger.info(
          { sessionId: session.sessionId, outcome: "fallback", failureKind: "exception" },
          "session title generation failed",
        );
      }
      this.applyGeneratedSessionName(session, fallbackSessionName(titleInput), controller);
    }).finally(() => {
      if (this.sessionTitleGenerationControllers.get(session) === controller) {
        this.sessionTitleGenerationControllers.delete(session);
      }
    });
  }

  private cancelSessionTitleGeneration(session: PiAgentSession): void {
    this.sessionTitleGenerationControllers.get(session)?.abort();
    this.sessionTitleGenerationControllers.delete(session);
  }

  private applyGeneratedSessionName(session: PiAgentSession, name: string | undefined, controller?: AbortController): void {
    if (name === undefined || session.sessionName !== undefined || !this.isCurrentActiveSession(session)) return;
    if (controller !== undefined && (controller.signal.aborted || this.sessionTitleGenerationControllers.get(session) !== controller)) return;
    if (this.treeNavigations.has(session)) {
      this.deferredGeneratedSessionNames.set(session, name);
      return;
    }
    try {
      session.setSessionName(name);
    } catch (error: unknown) {
      this.logger.info(
        { sessionId: session.sessionId, outcome: "persistence_failed", error: error instanceof Error ? error.message : String(error) },
        "failed to persist generated session title",
      );
    }
  }

  private flushDeferredTreeNavigationWork(session: PiAgentSession): void {
    const generatedName = this.deferredGeneratedSessionNames.get(session);
    this.deferredGeneratedSessionNames.delete(session);
    if (generatedName !== undefined) this.applyGeneratedSessionName(session, generatedName);
  }

  private rememberSessionName(session: PiAgentSession): void {
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "" || this.sessionManager.rememberSessionName === undefined) return;
    void this.sessionManager.rememberSessionName(sessionFile, session.sessionName).catch((error: unknown) => {
      this.logger.info(
        { sessionId: session.sessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to remember session name",
      );
    });
  }

  private publishSessionName(session: PiAgentSession): void {
    if (session.sessionName !== undefined) {
      void this.sessionWorktrees?.renameFromTitle(session.sessionId, session.sessionName).catch((error: unknown) => {
        this.logger.info({ sessionId: session.sessionId, error: errorMessage(error) }, "worktree branch rename failed");
      });
    }
    const event = session.sessionName === undefined
      ? { type: "session.name", sessionId: session.sessionId } as const
      : { type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const;
    this.events.publish(session.sessionId, event);
    this.events.publishGlobal(event);
  }

  private publishHeartbeats(): void {
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      this.scheduleQueuedCompaction(session.sessionId);
      const activity = this.activities.get(session.sessionId);
      if (!this.hasActiveWork(session)) {
        if (activity?.phase === "active" || activity?.activeSince !== undefined) this.publishStatus(session);
        continue;
      }
      this.publishStatus(session);
      if (activity?.phase === "active") this.publishActivity(session, activity.label, "active", activity.detail);
      else this.publishActivity(session, this.activityLabelFromStatus(session), "active");
    }
  }

  private activityLabelFromStatus(session: PiAgentSession): string {
    if (this.treeNavigations.has(session)) return "navigating session tree";
    if (this.isSessionEntryMutationActive(session)) return "updating session";
    if (this.isCompactionRunning(session)) return "compacting";
    if (session.isBashRunning) return "running bash";
    if (session.isStreaming) return "agent running";
    if (this.pendingMessageCount(session) > 0) return "queued";
    return "active";
  }

  private hasActiveWork(session: PiAgentSession): boolean {
    return this.treeNavigations.has(session)
      || this.isCompactionRunning(session)
      || this.isSessionEntryMutationActive(session)
      || this.isTreeExclusiveOperationActive(session)
      || sessionHasActiveWork(session, this.compactionQueue.pendingCount(session.sessionId));
  }

  private async runTreeExclusiveOperation<T>(
    targets: readonly TreeExclusiveOperationTarget[],
    activeError: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const sessionIds = new Set<string>();
    const runtimes = new Set<PiSessionRuntime>();
    const sessions = new Set<PiAgentSession>();
    for (const target of targets) {
      const runtime = target.runtime ?? (target.session === undefined ? undefined : this.activeRuntimeForSession(target.session));
      const session = target.session ?? runtime?.session;
      if (session !== undefined && this.hasActiveWork(session)) throw new Error(activeError);
      sessionIds.add(target.sessionId);
      if (runtime !== undefined) runtimes.add(runtime);
      if (session !== undefined) sessions.add(session);
    }

    for (const sessionId of sessionIds) {
      this.treeExclusiveSessionOperationCounts.set(sessionId, (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) + 1);
    }
    for (const runtime of runtimes) {
      this.treeExclusiveRuntimeOperationCounts.set(runtime, (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) + 1);
    }
    for (const session of sessions) this.observeUnreadActivityState(session);

    try {
      return await operation();
    } finally {
      for (const runtime of runtimes) decrementWeakCount(this.treeExclusiveRuntimeOperationCounts, runtime);
      for (const sessionId of sessionIds) decrementMapCount(this.treeExclusiveSessionOperationCounts, sessionId);
      for (const session of sessions) {
        if (this.isCurrentActiveSession(session)) this.observeUnreadActivityState(session);
      }
    }
  }

  private isTreeExclusiveSessionIdentityActive(sessionId: string): boolean {
    return (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) > 0;
  }

  private isTreeExclusiveOperationActive(session: PiAgentSession): boolean {
    if (this.isTreeExclusiveSessionIdentityActive(session.sessionId)) return true;
    const runtime = this.activeRuntimeForSession(session);
    return runtime !== undefined && (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) > 0;
  }

  private activeRuntimeForSession(session: PiAgentSession): PiSessionRuntime | undefined {
    for (const active of new Set(this.active.values())) {
      if (active.runtime.session === session) return active.runtime;
    }
    return undefined;
  }

  private assertTreeNavigationInactive(session: PiAgentSession, action: string): void {
    if (this.treeNavigations.has(session)) throw new Error(`Cannot ${action} while session tree navigation is active`);
  }

  private async runSessionEntryMutation<T>(session: PiAgentSession, action: string, operation: () => Promise<T>): Promise<T> {
    this.beginSessionEntryMutation(session, action);
    try {
      return await operation();
    } finally {
      this.endSessionEntryMutation(session);
    }
  }

  private beginSessionEntryMutation(session: PiAgentSession, action: string): void {
    this.assertTreeNavigationInactive(session, action);
    this.sessionEntryMutationCounts.set(session, (this.sessionEntryMutationCounts.get(session) ?? 0) + 1);
    this.observeUnreadActivityState(session);
  }

  private endSessionEntryMutation(session: PiAgentSession): void {
    const remaining = (this.sessionEntryMutationCounts.get(session) ?? 1) - 1;
    if (remaining <= 0) this.sessionEntryMutationCounts.delete(session);
    else this.sessionEntryMutationCounts.set(session, remaining);
    this.observeUnreadActivityState(session);
    this.scheduleQueuedCompaction(session.sessionId);
  }

  private isSessionEntryMutationActive(session: PiAgentSession): boolean {
    return (this.sessionEntryMutationCounts.get(session) ?? 0) > 0;
  }

  private publishActivityForEvent(session: PiAgentSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType === undefined) return;
    if (eventType === "durable_children_changed") { this.publishStatus(session); return; }
    if (eventType === "agent_start") { this.publishActivity(session, "agent running", "active"); return; }
    if (eventType === "agent_end") {
      this.publishActivity(session, "idle", "idle");
      setTimeout(() => {
        this.publishActivity(session, "idle", "idle");
        this.publishStatus(session);
      }, 250);
      return;
    }
    if (eventType === "turn_end") { this.publishActivity(session, "turn complete", "idle"); return; }
    if (eventType === "message_start") { this.publishActivity(session, "message started", "active"); return; }
    if (eventType === "message_end") { this.publishActivity(session, "message complete", "idle"); return; }
    if (eventType === "message_update") { this.publishActivity(session, "receiving response", "active"); return; }
    if (eventType === "tool_execution_start") { this.publishActivity(session, "running tool", "active", getString(event, "toolName")); return; }
    if (eventType === "tool_execution_update") { this.trackWorkingAgents(session, event); return; }
    if (eventType === "tool_execution_end") {
      const isError = getBoolean(event, "isError") === true;
      // A script's call ending is progress of the script, not the end of a step:
      // the step, and any delegated run beside it, is still going.
      if (isNestedToolEvent(event)) return;
      this.publishActivity(session, isError ? "tool failed" : "tool complete", isError ? "error" : "idle", getString(event, "toolName"));
      // A finished run leaves nothing working, whatever its last progress said.
      if (this.workingAgentsBySession.delete(session.sessionId)) this.publishStatus(session);
      void this.markSessionsSpawnedByTool(event);
      return;
    }
    if (eventType === "bash_execution_start") { this.publishActivity(session, "running bash", "active"); return; }
    if (eventType === "bash_execution_end") { this.publishActivity(session, "bash complete", "idle"); return; }
    if (this.hasActiveWork(session)) this.publishActivity(session, eventType.replaceAll("_", " "), "active");
  }

  /**
   * Build the reporter for one session construction.
   *
   * The session id is known before any await — a `SessionManager` has its id
   * from construction — so the daemon can name what it is starting even though
   * the `PiAgentSession` that {@link publishActivity} needs does not exist yet.
   * Without an id there is nothing to report against, so the reporter stays
   * silent and the browser keeps its own generic wording.
   */
  private startupProgress(sessionManager: PiSessionManager, intent: "create" | "open", startupToken: string | undefined): SessionStartupProgressReporter {
    const sessionId = sessionManager.getSessionId();
    if (sessionId === "") return { report: noop, end: noop };
    const label = intent === "create" ? "Creating session" : "Opening session";
    return {
      report: (phase) => { this.publishStartupProgress(sessionId, startupToken, label, "active", this.startupDetail(phase)); },
      end: () => {
        // A real activity published during the window (an extension error, say)
        // is the truth about this session and must survive the clear.
        if (this.activities.has(sessionId)) return;
        this.publishStartupProgress(sessionId, startupToken, "idle", "idle", undefined);
      },
    };
  }

  private startupDetail(phase: string): string {
    return this.catalogRefreshStatus?.isRefreshInFlight() === true
      ? `${phase} · ${STARTUP_CONCURRENT_CATALOG_REFRESH}`
      : phase;
  }

  /**
   * Report startup progress on the global channel only, echoing the caller's
   * correlation token so a waiting browser row recognises its own construction.
   *
   * Unlike {@link publishActivity} this deliberately records nothing: no
   * `activities` entry, no workspace activity, no unread observation. There is
   * no session to own that state, and a failed creation would leave it stranded.
   *
   * Every report is marked `startup`, which is what keeps a session that is
   * merely opening from counting as one doing work. This is the only publisher
   * that sets the marker, and because it writes no `activities` entry no later
   * heartbeat re-publication can carry it.
   */
  private publishStartupProgress(sessionId: string, startupToken: string | undefined, label: string, phase: "active" | "idle", detail: string | undefined): void {
    const at = new Date().toISOString();
    const activity = detail === undefined ? { sessionId, phase, label, at, startup: true } : { sessionId, phase, label, detail, at, startup: true };
    this.events.publishGlobal(startupToken === undefined ? { type: "session.startup", activity } : { type: "session.startup", startupToken, activity });
  }

  private publishActivity(session: PiAgentSession, label: string, phase: "active" | "idle" | "error", detail?: string): void {
    const at = new Date().toISOString();
    const previous = this.activities.get(session.sessionId);
    // SDK tool/message completion events can briefly say idle while the turn is
    // still streaming. Keep one start across those internal phase changes so a
    // Working runtime measures the user's whole wait, not the current tool.
    const stillWorking = phase === "active" || this.hasActiveWork(session);
    const runStartedAt = session instanceof DurableAgentSession ? session.getActiveRunStartedAt() : undefined;
    const activeSince = stillWorking ? runStartedAt ?? previous?.activeSince ?? at : undefined;
    const stored = {
      phase,
      label,
      ...(detail === undefined ? {} : { detail }),
      ...(activeSince === undefined ? {} : { activeSince }),
      at,
    };
    this.activities.set(session.sessionId, stored);
    const activity = { sessionId: session.sessionId, ...stored };
    this.workspaceActivity?.applySessionActivity(session.sessionManager.getCwd(), activity);
    this.events.publish(session.sessionId, { type: "activity.update", activity });
    this.events.publishGlobal({ type: "activity.update", activity });
    this.observeUnreadActivityState(session);
  }

  private publishStatus(session: PiAgentSession): void {
    const status = this.statusFromSession(session);
    // Attachment can start with a running snapshot and no agent_start event. Seed activity now,
    // rather than waiting for a provider update or the first heartbeat after daemon startup.
    const runStartedAt = session instanceof DurableAgentSession ? session.getActiveRunStartedAt() : undefined;
    if (runStartedAt !== undefined && this.activities.get(session.sessionId)?.activeSince !== runStartedAt) {
      this.publishActivity(session, this.activityLabelFromStatus(session), "active");
    }
    this.clearStaleActiveActivity(session);
    this.workspaceActivity?.applySessionStatus(session.sessionManager.getCwd(), status);
    this.events.publish(session.sessionId, { type: "status.update", status });
    this.events.publishGlobal({ type: "status.update", status });
    this.observeUnreadActivityState(session);
  }

  private clearStaleActiveActivity(session: PiAgentSession): void {
    const current = this.activities.get(session.sessionId);
    if (current === undefined || this.hasActiveWork(session)) return;
    if (current.phase !== "active" && current.activeSince === undefined) return;
    const at = new Date().toISOString();
    const stored = current.phase === "active"
      ? { phase: "idle" as const, label: "idle", at }
      : {
          phase: current.phase,
          label: current.label,
          ...(current.detail === undefined ? {} : { detail: current.detail }),
          at,
        };
    this.activities.set(session.sessionId, stored);
    const activity = { sessionId: session.sessionId, ...stored };
    this.events.publish(session.sessionId, { type: "activity.update", activity });
    this.events.publishGlobal({ type: "activity.update", activity });
  }

  private nativeHostState(session: PiAgentSession | undefined): DurableHostState {
    if (session === undefined) return {};
    const warnings = this.warningsForSession(session);
    const contextUsage = this.contextUsageBySession.get(session);
    return { status: { ...this.liveWorkCounts(session),
      ...(contextUsage === undefined ? {} : { contextUsage }),
      doubleEscapeAction: session.settingsManager.getDoubleEscapeAction?.() ?? "tree",
      ...(warnings.length === 0 ? {} : { warnings }),
      pendingDialogs: this.pendingExtensionDialogStore.pendingDialogs(session.sessionId) },
      compaction: { isRunning: this.compactionQueue.isCompactionRunning(session.sessionId),
        queuedMessages: this.compactionQueue.queuedMessages(session.sessionId, []) } };
  }

  private async restoreAttentionHint(session: PiAgentSession): Promise<void> {
    if (!(session instanceof DurableAgentSession) || !this.attentionHints.configured()) return;
    try {
      const stored = await readAttentionHint(session.journal.handle);
      if (stored !== undefined) this.attentionHints.restore(this.attentionSession(session), stored);
    } catch (err) { this.logger.info({ err, sessionId: session.sessionId }, "attention hint restore failed"); }
  }

  private retireAttentionSession(session: PiAgentSession): void {
    const attention = this.attentionSessions.get(session);
    if (attention !== undefined) this.attentionHints.retire(attention);
  }

  private attentionSession(session: PiAgentSession): AttentionSession {
    let attention = this.attentionSessions.get(session);
    if (attention === undefined) {
      attention = {
        branch: () => session.sessionManager.getBranch(), messages: () => session.messages,
        awaiting: () => { const response = this.responseProjection(session).response; return response.kind === "none" ? "nothing" : response.reason === "undeclared" ? "undeclared" : "reply"; },
        persist: (data) => {
          if (!this.isCurrentDecisionHintSession(session)) return Promise.resolve("discarded");
          return session instanceof DurableAgentSession ? appendAttentionHint(session.journal.handle, durableJson(data))
            : decisionAnnotations(session.sessionManager).write(session.sessionId, ATTENTION_HINT_CUSTOM_TYPE, durableJson(data));
        },
        publish: () => { this.publishDecisionHintStatus(session); },
      };
      this.attentionSessions.set(session, attention);
    }
    return attention;
  }

  private statusFromSession(session: PiAgentSession): ClientSessionStatus {
    const stats = session.getSessionStats();
    const model = session.model === undefined ? undefined : modelToClientModel(session.model);
    const contextUsage = session.getContextUsage();
    if (contextUsage === undefined) this.contextUsageBySession.delete(session);
    else this.contextUsageBySession.set(session, contextUsage);
    const warnings = this.warningsForSession(session);
    const pendingAsk = session instanceof DurableAgentSession ? session.parentResponseProjection.pendingAsk : this.sessionAsks.pendingAsk(session.sessionId);
    const pendingDialogs = this.pendingExtensionDialogStore.pendingDialogs(session.sessionId);
    const attentionHint = this.attentionHints.read(this.attentionSession(session));
    return {
      sessionId: session.sessionId,
      persisted: sessionFileExists(session.sessionFile),
      ...(model === undefined ? {} : { model }),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: this.isCompactionRunning(session),
      isBashRunning: session.isBashRunning,
      ...this.liveWorkCounts(session),
      pendingMessageCount: this.pendingMessageCount(session),
      queuedMessages: this.queuedMessages(session),
      doubleEscapeAction: session.settingsManager.getDoubleEscapeAction?.() ?? "tree",
      // Durable stats count the current projection; SDK stats count entries across all branches.
      messageCount: session instanceof DurableAgentSession ? stats.totalMessages : session.messages.length,
      tokens: stats.tokens,
      cost: stats.cost,
      ...(contextUsage === undefined ? {} : { contextUsage }),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(pendingAsk === undefined ? {} : { pendingAsk }),
      response: this.responseProjection(session).response,
      ...(attentionHint === undefined ? {} : { attentionHint }),
      ...(pendingDialogs.length === 0 ? {} : { pendingDialogs }),
    };
  }

  /**
   * Compute the live warning set for a session: runtime/resource diagnostics from
   * the active runtime (if any) plus the Anthropic subscription-auth notice. Read
   * fresh on each status publish so a rebuilt runtime or an auth/model change is
   * reflected without caching a stale snapshot.
   */
  private warningsForSession(session: PiAgentSession): SessionWarning[] {
    const runtime = this.active.get(session.sessionId)?.runtime;
    const warnings = runtime === undefined ? [] : collectRuntimeWarnings(runtime);
    const anthropic = anthropicSubscriptionWarning(session, join(this.agentDir, "auth.json"));
    if (anthropic !== undefined) warnings.push(anthropic);
    return warnings;
  }

  private isCompactionRunning(session: PiAgentSession): boolean {
    return session.isCompacting || this.compactionQueue.isCompactionRunning(session.sessionId);
  }

  private pendingMessageCount(session: PiAgentSession): number {
    return session.pendingMessageCount + this.compactionQueue.pendingCount(session.sessionId);
  }

  private queuedMessages(session: PiAgentSession): QueuedSessionMessage[] {
    return this.compactionQueue.queuedMessages(session.sessionId, runtimeQueuedMessages(session));
  }
}

function savedTranscriptUsage(messages: readonly unknown[]): Pick<ClientSessionStatus, "tokens" | "cost"> {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  const numeric = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
  for (const message of messages) {
    if (getProperty(message, "role") !== "assistant") continue;
    const usage = getProperty(message, "usage");
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) tokens[key] += numeric(getProperty(usage, key));
    tokens.total += numeric(getProperty(usage, "totalTokens"));
    cost += numeric(getProperty(getProperty(usage, "cost"), "total"));
  }
  return { tokens, cost };
}

function previewResponseFromPlan(plan: SessionCleanupPlan): ClientSessionCleanupPreviewResponse {
  return {
    generatedAt: plan.generatedAt,
    thresholds: plan.thresholds,
    projects: plan.projects,
    totals: plan.totals,
    ...(plan.skippedBusySessionIds.length === 0 ? {} : { skippedBusySessionIds: plan.skippedBusySessionIds }),
  };
}

function uniqueBulkSessionRefs(refs: readonly SessionBulkMutationRef[]): SessionBulkMutationRef[] {
  const seen = new Set<string>();
  const unique: SessionBulkMutationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.cwd}\0${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function bulkRefToSessionRef(ref: SessionBulkMutationRef): PiSessionRef {
  return { id: ref.id, cwd: ref.cwd };
}

function findArchivedRecordForBulkRef(records: readonly ArchivedSessionRecord[], ref: SessionBulkMutationRef): ArchivedSessionRecord | undefined {
  return records.find((record) => record.cwd === ref.cwd && (record.sessionId === ref.id || record.sessionId.startsWith(ref.id)));
}

function findListedSessionForBulkRef(context: BulkSessionRefContext, ref: SessionBulkMutationRef): PiSessionListEntry | undefined {
  return findSessionByIdOrPrefix(context.sessionsByCwd.get(ref.cwd) ?? [], ref.id);
}

function findSessionByIdOrPrefix(sessions: readonly PiSessionListEntry[], sessionId: string): PiSessionListEntry | undefined {
  return sessions.find((session) => session.id === sessionId) ?? sessions.find((session) => session.id.startsWith(sessionId));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ScopedAgentModel {
  readonly model: AgentModel;
  readonly thinkingLevel?: ClientThinkingLevel;
}

async function resolveEnabledModels(settings: SettingsManager, modelRuntime: ModelRuntime): Promise<readonly ScopedAgentModel[]> {
  const patterns = settings.getEnabledModels();
  if (patterns === undefined || patterns.length === 0) return [];
  return (await resolveModelScopeWithDiagnostics(patterns, modelRuntime)).scopedModels;
}

function modelsWithScopeFirst(candidates: readonly AgentModel[], scopedModels: readonly ScopedAgentModel[]): AgentModel[] {
  const ordered = scopedModels.map((scoped) => scoped.model);
  const scopedIds = new Set(ordered.map(modelIdentity));
  return [...ordered, ...candidates.filter((candidate) => !scopedIds.has(modelIdentity(candidate)))];
}

function resolveNewSessionDefaultModel(
  candidates: readonly AgentModel[],
  scopedModels: readonly ScopedAgentModel[],
  defaultProvider: string | undefined,
  defaultModelId: string | undefined,
): ScopedAgentModel | undefined {
  if (defaultProvider !== undefined && defaultModelId !== undefined) {
    const configured = candidates.find((candidate) => candidate.provider === defaultProvider && candidate.id === defaultModelId);
    const configuredScope = configured === undefined ? undefined : scopedModels.find((scoped) => modelIdentity(scoped.model) === modelIdentity(configured));
    if (configured !== undefined && (scopedModels.length === 0 || configuredScope !== undefined)) return configuredScope ?? { model: configured };
  }
  const scoped = scopedModels[0];
  return scoped ?? (candidates[0] === undefined ? undefined : { model: candidates[0] });
}

function modelIdentity(model: AgentModel): string {
  return `${model.provider}\u0000${model.id}`;
}

/**
 * The catalogue, with Pi's cycling scope marked on the models that belong to
 * it. Order already puts them first; the flag says *why* they are first, which
 * position alone cannot tell a reader.
 */
function clientModelsWithScope(models: readonly AgentModel[], scopedModels: readonly ScopedAgentModel[]): ClientSessionModel[] {
  const scopedIds = new Set(scopedModels.map((scoped) => modelIdentity(scoped.model)));
  return models.map((model) => {
    const client = modelToClientModel(model);
    return scopedIds.has(modelIdentity(model)) ? { ...client, scoped: true } : client;
  });
}

function modelToClientModel(model: PiAgentSession["model"]): ClientSessionModel {
  if (model === undefined) return {};
  const name = getString(model, "name");
  const reasoning = getProperty(model, "reasoning");
  return {
    provider: model.provider,
    id: model.id,
    ...(name === undefined ? {} : { name }),
    contextWindow: model.contextWindow,
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function notificationIdentityForSession(session: PiAgentSession): { sessionId: string; cwd: string } {
  return {
    sessionId: session.sessionId,
    cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
  };
}

function pinnedSessionIdSet(records: readonly PinnedSessionRecord[]): ReadonlySet<string> {
  return new Set(records.map((record) => record.sessionId));
}

function withPinnedFlags(sessions: ClientSession[], pinnedSessionIds: ReadonlySet<string>): ClientSession[] {
  if (pinnedSessionIds.size === 0) return sessions;
  return sessions.map((session) => (pinnedSessionIds.has(session.id) ? { ...session, pinned: true } : session));
}

function tabsBySessionId(records: readonly SessionTabsRecord[]): ReadonlyMap<string, readonly string[]> {
  return new Map(records.map((record) => [record.sessionId, record.tabs]));
}

function withSessionTabs(sessions: ClientSession[], tabs: ReadonlyMap<string, readonly string[]>): ClientSession[] {
  if (tabs.size === 0) return sessions;
  return sessions.map((session) => {
    const sessionTabs = tabs.get(session.id);
    return sessionTabs === undefined ? session : { ...session, tabs: [...sessionTabs] };
  });
}

function sessionCatalogIdentity(session: PiAgentSession): string {
  return JSON.stringify([
    canonicalizeStoredCwd(session.sessionManager.getCwd()),
    session.sessionId,
  ]);
}

function clientSessionFromListEntry(session: PiSessionListEntry): ClientSession {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    persisted: true,
    ...(session.name === undefined ? {} : { name: session.name }),
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: boundSessionCatalogFirstMessage(session.firstMessage),
    ...(session.response === undefined ? {} : { response: session.response }),
    ...(session.pendingAsk === undefined ? {} : { pendingAsk: session.pendingAsk }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
    ...(session.agentSpawned === true ? { agentSpawned: true } : {}),
  };
}

function withMachineSessionRelationships(sessions: readonly ClientSession[]): ClientSession[] {
  const sessionsByPath = new Map(sessions.map((session) => [session.path, session]));
  const childCounts = new Map<string, number>();

  for (const session of sessions) {
    if (session.parentSessionPath === undefined) continue;
    const parent = sessionsByPath.get(session.parentSessionPath);
    if (parent === undefined || cwdPathsEqual(parent.cwd, session.cwd)) continue;
    childCounts.set(parent.path, (childCounts.get(parent.path) ?? 0) + 1);
  }

  return sessions.map((session) => {
    const parent = session.parentSessionPath === undefined
      ? undefined
      : sessionsByPath.get(session.parentSessionPath);
    const crossWorkspaceParent = parent !== undefined && !cwdPathsEqual(parent.cwd, session.cwd)
      ? parent
      : undefined;
    const childSessionsElsewhere = childCounts.get(session.path);
    if (crossWorkspaceParent === undefined && childSessionsElsewhere === undefined) return session;
    return {
      ...session,
      ...(crossWorkspaceParent === undefined ? {} : {
        parentSessionId: crossWorkspaceParent.id,
        parentSessionCwd: crossWorkspaceParent.cwd,
      }),
      ...(childSessionsElsewhere === undefined ? {} : { childSessionsElsewhere }),
    };
  });
}

function archiveInputFromListEntry(session: PiSessionListEntry): ArchiveSessionInput {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    path: session.path,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: boundSessionCatalogFirstMessage(session.firstMessage),
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function archiveInputFromActiveSession(session: PiAgentSession): ArchiveSessionInput {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    sessionId: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    path: sessionFile,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: session.messages.length,
    firstMessage: "",
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveCandidateFromListEntry(session: PiSessionListEntry): WorkspaceArchiveCandidate {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    archived: false,
    listEntry: session,
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function archiveCandidateFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): WorkspaceArchiveCandidate | undefined {
  const path = record.originalPath ?? fallback?.path;
  if (path === undefined) return undefined;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    archived: true,
    ...(fallback === undefined ? {} : { listEntry: fallback }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveCandidateFromActiveSession(session: PiAgentSession, archived: boolean): WorkspaceArchiveCandidate {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    id: session.sessionId,
    path: sessionFile,
    cwd: session.sessionManager.getCwd(),
    archived,
    activeSession: session,
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveInputFromCandidate(candidate: WorkspaceArchiveCandidate): ArchiveSessionInput {
  if (candidate.listEntry !== undefined) return archiveInputFromListEntry(candidate.listEntry);
  if (candidate.activeSession !== undefined) return archiveInputFromActiveSession(candidate.activeSession);
  throw new Error(`Session is not available for archiving: ${candidate.id}`);
}

function sessionHasActiveWork(session: PiAgentSession, extraQueuedMessageCount = 0): boolean {
  return session.isStreaming || session.isCompacting || session.isBashRunning || session.pendingMessageCount + extraQueuedMessageCount > 0;
}

function sessionDisplayName(session: PiAgentSession): string {
  return session.sessionName ?? session.sessionId;
}

function clientSessionFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): ClientSession | undefined {
  const path = record.originalPath ?? fallback?.path;
  const created = record.created ?? fallback?.created.toISOString();
  const modified = record.modified ?? fallback?.modified.toISOString();
  const messageCount = record.messageCount ?? fallback?.messageCount;
  const firstMessage = record.firstMessage ?? fallback?.firstMessage;
  if (path === undefined || created === undefined || modified === undefined || messageCount === undefined || firstMessage === undefined) return undefined;
  const name = record.name ?? fallback?.name;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    ...(name === undefined ? {} : { name }),
    created,
    modified,
    messageCount,
    firstMessage: boundSessionCatalogFirstMessage(firstMessage),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    archived: true,
    archivedAt: record.archivedAt,
  };
}

function addSessionName(names: Set<string>, name: string | undefined): void {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  if (trimmed !== undefined && trimmed !== "") names.add(trimmed);
}

function compareArchivedRecords(a: ArchivedSessionRecord, b: ArchivedSessionRecord): number {
  return archivedTimestamp(b) - archivedTimestamp(a);
}

function archivedTimestamp(record: ArchivedSessionRecord): number {
  const time = Date.parse(record.archivedAt);
  return Number.isNaN(time) ? 0 : time;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

interface TrackedSubsessionSessionIdentity {
  sessionId: string;
  sessionFile: string | undefined;
  sessionManager: PiSessionManager;
  cwd: string;
}

/**
 * Resolve the delegation capability from server-owned, persisted session
 * provenance. A copied marker is not enough: the child header and reciprocal
 * parent link must identify the exact same session files.
 */
export async function sessionAllowsDelegationTools(
  sessionManager: PiSessionManager,
  managers: Pick<PiSessionManagerGateway, "open">,
): Promise<boolean> {
  const trackedLink = await verifiedTrackedSubsessionLink(managers, {
    sessionId: sessionManager.getSessionId(),
    sessionFile: sessionManager.getSessionFile(),
    sessionManager,
    cwd: sessionManager.getCwd(),
  });
  return trackedLink === undefined;
}

async function verifiedTrackedSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  session: TrackedSubsessionSessionIdentity,
): Promise<TrackedSubsessionLink | undefined> {
  // Child markers are only hints; the current child header and reciprocal
  // parent custom link must agree on the exact ids and files before relinking.
  const entries = session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
  let marker: PersistedChildSubsessionLink | undefined;
  for (const entry of entries) {
    const parsed = parsePersistedChildSubsessionLink(entry);
    if (parsed?.spawnedSessionId === session.sessionId) marker = parsed;
  }
  if (marker === undefined) return undefined;

  const childSessionFile = nonEmptyString(session.sessionFile);
  if (childSessionFile === undefined) return undefined;
  const childHeader = await readSessionHeaderSummary(childSessionFile);
  if (childHeader?.id !== session.sessionId) return undefined;
  const parentSessionFile = nonEmptyString(childHeader.parentSession);
  if (parentSessionFile === undefined) return undefined;
  const parentHeader = await readSessionHeaderSummary(parentSessionFile);
  if (parentHeader?.id !== marker.spawnedBySessionId) return undefined;

  const parentLink = findReciprocalParentSubsessionLink(
    managers,
    parentSessionFile,
    marker.spawnedBySessionId,
    session.sessionId,
    childSessionFile,
  );
  if (parentLink === undefined) return undefined;
  return {
    parentSessionId: marker.spawnedBySessionId,
    childSessionId: session.sessionId,
    childSessionFile,
    parentSessionFile,
    cwd: parentLink.cwd ?? session.cwd,
  };
}

function findReciprocalParentSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  parentSessionFile: string,
  parentSessionId: string,
  childSessionId: string,
  childSessionFile: string,
): PersistedParentSubsessionLink | undefined {
  let parentManager: PiSessionManager;
  try {
    parentManager = managers.open(parentSessionFile);
  } catch {
    return undefined;
  }
  const entries = parentManager.getEntries?.() ?? parentManager.getBranch();
  for (const entry of entries) {
    const link = parsePersistedParentSubsessionLink(entry);
    if (link === undefined) continue;
    if (link.spawnedBySessionId !== parentSessionId || link.spawnedSessionId !== childSessionId) continue;
    if (link.spawnedSessionFile === undefined || !sessionPathsEqual(link.spawnedSessionFile, childSessionFile)) continue;
    return link;
  }
  return undefined;
}

function parsePersistedParentSubsessionLink(entry: unknown): PersistedParentSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  const spawnedSessionFile = getString(data, "spawnedSessionFile");
  const cwd = getString(data, "cwd");
  return {
    spawnedBySessionId,
    spawnedSessionId,
    ...(spawnedSessionFile === undefined || spawnedSessionFile === "" ? {} : { spawnedSessionFile }),
    ...(cwd === undefined || cwd === "" ? {} : { cwd }),
  };
}

function parsePersistedChildSubsessionLink(entry: unknown): PersistedChildSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_CHILD_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  return { spawnedBySessionId, spawnedSessionId };
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function sessionPathsEqual(a: string, b: string): boolean {
  return cwdPathsEqual(a, b);
}

function sessionFileExists(sessionFile: string | undefined): sessionFile is string {
  if (sessionFile === undefined || sessionFile === "") return false;
  try {
    return statSync(sessionFile).isFile();
  } catch {
    return false;
  }
}

async function sessionFileHeaderMatches(sessionFile: string, expected: { sessionId: string; parentSessionFile?: string | undefined }): Promise<boolean> {
  const header = await readSessionHeaderSummary(sessionFile);
  if (header?.id !== expected.sessionId) return false;
  if (expected.parentSessionFile === undefined) return true;
  return header.parentSession !== undefined && sessionPathsEqual(header.parentSession, expected.parentSessionFile);
}


/**
 * Rewrite a session file's header line in place.
 *
 * The header is the first line of the file and the agent appends to the rest,
 * so only the first line is parsed and only the first line is replaced. The
 * mutate function returns false when it changed nothing, which skips the write
 * and leaves the file's timestamp alone.
 */
async function rewriteSessionHeader(
  sessionFile: string,
  mutate: (header: Record<string, unknown>) => boolean,
): Promise<void> {
  const content = await readFile(sessionFile, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);
  const header: unknown = JSON.parse(firstLine);
  if (!isRecord(header) || header["type"] !== "session") throw new Error("Invalid session file header");
  if (!mutate(header)) return;
  await writeFile(sessionFile, `${JSON.stringify(header)}${rest}`, "utf8");
}

/**
 * Undo the spawn marker, which returns the session to the inbox.
 *
 * The marker is what keeps a delegated child out of the inbox, so clearing it
 * is the whole of promoting that child to a session of its own.
 */
async function clearAgentSpawned(sessionFile: string): Promise<void> {
  await rewriteSessionHeader(sessionFile, (header) => {
    if (header["agentSpawned"] !== true) return false;
    delete header["agentSpawned"];
    return true;
  });
}

async function clearParentSession(sessionFile: string): Promise<void> {
  await rewriteSessionHeader(sessionFile, (header) => {
    if (header["parentSession"] === undefined) return false;
    delete header["parentSession"];
    return true;
  });
}

function clearParentSessionHeader(sessionManager: PiSessionManager): void {
  const header = sessionManager.getHeader?.();
  if (header !== undefined && header !== null) delete header.parentSession;
}

function clearSessionQueue(session: PiAgentSession): void {
  session.clearQueue();
}

function scheduleSessionTimer(timers: Map<string, NodeJS.Timeout>, sessionId: string, delayMs: number, task: () => void): void {
  if (timers.has(sessionId)) return;
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    task();
  }, delayMs);
  timers.set(sessionId, timer);
}

function clearSessionTimer(timers: Map<string, NodeJS.Timeout>, sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(sessionId);
}

function clearSessionTimers(timers: Map<string, NodeJS.Timeout>): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function runtimeQueuedMessages(session: PiAgentSession): QueuedSessionMessage[] {
  return [
    ...session.getSteeringMessages().map((text) => ({ kind: "steer" as const, text })),
    ...session.getFollowUpMessages().map((text) => ({ kind: "followUp" as const, text })),
  ];
}

function hasUserMessage(messages: readonly unknown[]): boolean {
  return messages.some((message) => getString(message, "role") === "user");
}

function userTextMessage(text: string): { role: "user"; content: string } {
  return { role: "user", content: text };
}

/**
 * Build the optimistic user message echoed to clients. When images are present
 * we mirror pi's content-array shape (`[{type:"text"}, {type:"image"}, ...]`) so
 * the local echo matches what pi persists in the session branch.
 */
function userMessage(text: string, images: ImageContent[]): { role: "user"; content: string | (ImageContent | { type: "text"; text: string })[] } {
  if (images.length === 0) return userTextMessage(text);
  const content: (ImageContent | { type: "text"; text: string })[] = [];
  if (text !== "") content.push({ type: "text", text });
  content.push(...images);
  return { role: "user", content };
}

function buildPromptOptions(behavior: QueuedPromptKind | undefined, images: ImageContent[], expandPromptTemplates = true, preflightResult?: (accepted: boolean) => void, requestId?: string): PromptRequestOptions & { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; expandPromptTemplates?: boolean; preflightResult?: PromptOptions["preflightResult"] } | undefined {
  const options: PromptRequestOptions & { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; expandPromptTemplates?: boolean; preflightResult?: PromptOptions["preflightResult"] } = {};
  if (requestId !== undefined) options.requestId = requestId;
  if (behavior !== undefined) options.streamingBehavior = behavior;
  if (images.length > 0) options.images = images;
  if (!expandPromptTemplates) options.expandPromptTemplates = false;
  // Pi calls preflightResult only for an accepted prompt ("handled", "queued",
  // or "started"). A rejected prompt throws from prompt() instead.
  if (preflightResult !== undefined) options.preflightResult = () => { preflightResult(true); };
  return Object.keys(options).length > 0 ? options : undefined;
}

function boundedActivePromptContent(content: string): string {
  try {
    assertBoundedPromptResourceContent(content, PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes);
    return content;
  } catch {
    throw new Error("Prompt-resource template content is unavailable.");
  }
}

async function readActiveSkillContent(filePath: string | undefined): Promise<string> {
  if (filePath === undefined) throw new Error("Prompt-resource skill content is unavailable.");
  try {
    return await readBoundedPromptResourceFile(filePath, PROMPT_RESOURCE_CATALOG_LIMITS.maxSerializedBytes);
  } catch {
    throw new Error("Prompt-resource skill content is unavailable.");
  }
}

async function deliveryFingerprint(expanded: string): Promise<string> {
  return await fingerprintPromptResourceDeliveryText(expanded);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Attach the thinking level in effect when an assistant message was generated,
 * so chat bubbles can show it next to the model. Non-assistant messages pass
 * through by reference; assistant messages are copied only when a level is set.
 * "off" is the absence of thinking, not a level worth labeling on every bubble.
 */
function annotateAssistantThinkingLevel(message: unknown, thinkingLevel: string | undefined): unknown {
  if (thinkingLevel === undefined || thinkingLevel === "" || thinkingLevel === "off") return message;
  if (!isRecord(message) || message["role"] !== "assistant") return message;
  return { ...message, thinkingLevel };
}

function historyMessages(sessionManager: Pick<PiSessionManager, "getBranch">, onMessage?: (entryId: string, position: number) => void): unknown[] {
  const messages: unknown[] = [];
  const append = (entry: Record<string, unknown>, message: unknown) => {
    if (typeof entry["id"] === "string") onMessage?.(entry["id"], messages.length);
    messages.push(message);
  };
  // Pi records the initial level at session creation and every later change, so
  // walking the branch yields the level in effect for each assistant message.
  let thinkingLevel: string | undefined;
  for (const entry of sessionManager.getBranch()) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "message") append(entry, annotateAssistantThinkingLevel(entry["message"], thinkingLevel));
    else if (entry["type"] === "thinking_level_change") {
      const level = getString(entry, "thinkingLevel");
      if (level !== undefined) thinkingLevel = level;
    }
    else if (entry["type"] === "custom_message" && entry["display"] === true) append(entry, { role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (entry["type"] === "compaction") append(entry, { role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") append(entry, { role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return messages;
}

/** custom entry type used to persist parent -> child subsession links outside LLM context. */
const SUBSESSION_LINK_CUSTOM_TYPE = "pi-web.subsession.link";

/** custom entry type used to mark a child as created by spawn_subsession. */
const SUBSESSION_CHILD_LINK_CUSTOM_TYPE = "pi-web.subsession.spawned";

function toClientEvent(event: unknown, thinkingLevel?: string): SessionUiEvent {
  const eventType = getString(event, "type");
  const assistantMessageEvent = getProperty(event, "assistantMessageEvent");
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "text_delta") {
    return { type: "assistant.delta", text: getString(assistantMessageEvent, "delta") ?? "" };
  }
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "thinking_delta") {
    return { type: "assistant.thinking.delta", text: getString(assistantMessageEvent, "delta") ?? "" };
  }
  // A script's own calls reach the browser through the script's progress
  // updates. As tool events they would draw cards that a reload cannot restore.
  if (eventType?.startsWith("tool_execution_") === true && isNestedToolEvent(event)) return { type: "pi.event", eventType };
  if (eventType === "tool_execution_start") {
    const args = getProperty(event, "args");
    const toolName = getString(event, "toolName") ?? "";
    return { type: "tool.start", toolName, toolCallId: getString(event, "toolCallId") ?? "", summary: summarizeToolCall(toolName, args), args };
  }
  if (eventType === "tool_execution_update") {
    const partialResult = getProperty(event, "partialResult");
    return { type: "tool.update", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: stringifyToolResult(partialResult), content: toolResultContent(partialResult), details: toolResultDetails(partialResult) };
  }
  if (eventType === "tool_execution_end") {
    const result = getProperty(event, "result");
    return { type: "tool.end", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: stringifyToolResult(result), content: toolResultContent(result), details: toolResultDetails(result), isError: getBoolean(event, "isError") === true };
  }
  if (eventType === "agent_start") return { type: "agent.start" };
  if (eventType === "agent_end") return { type: "agent.end" };
  if (eventType === "message_end") {
    const message = getProperty(event, "message");
    if (message === undefined) return { type: "message.end" };
    return { type: "message.end", message: annotateAssistantThinkingLevel(message, thinkingLevel) };
  }
  return { type: "pi.event", eventType: eventType ?? "unknown" };
}

function summarizeToolCall(toolName: string, args: unknown): string {
  return toolName === CODEMODE_TOOL_NAME ? codemodeScriptSummary(getString(args, "code") ?? "") : summarizeToolArgs(args);
}

function summarizeToolArgs(args: unknown): string {
  if (!isRecord(args)) return stringifyPrimitive(args);
  const command = getString(args, "command");
  if (command !== undefined) return command;
  const path = getString(args, "path");
  if (path !== undefined) return path;
  if (typeof args["oldText"] === "string" && typeof args["newText"] === "string") return "edit text replacement";
  const edits = args["edits"];
  if (Array.isArray(edits)) return `${String(edits.length)} edit${edits.length === 1 ? "" : "s"}`;
  const entries = Object.entries(args).filter(([, value]) => value != null).slice(0, 3);
  return entries.map(([key, value]) => `${key}: ${shortToolValue(value)}`).join(" · ");
}

function shortToolValue(value: unknown): string {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${String(value.length)} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object" && value !== null) return "object";
  return "";
}

function toolResultContent(result: unknown): unknown {
  if (isRecord(result)) {
    const content = getProperty(result, "content");
    if (content !== undefined) return content;
    const text = getString(result, "text") ?? getString(result, "output");
    if (text !== undefined) return [{ type: "text", text }];
  }
  if (typeof result === "string") return [{ type: "text", text: result }];
  return result;
}

function toolResultDetails(result: unknown): unknown {
  return isRecord(result) ? getProperty(result, "details") : undefined;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(stringifyToolResult).filter((text) => text !== "").join("\n");
  if (isRecord(result)) {
    if (getString(result, "type") === "image") return "[image]";
    const text = getString(result, "text") ?? getString(result, "content") ?? getString(result, "output");
    if (text !== undefined) return text;
    const content = getProperty(result, "content");
    if (Array.isArray(content)) return stringifyToolResult(content);
    return JSON.stringify(result, null, 2);
  }
  return stringifyPrimitive(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function stringifyPrimitive(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

const openMessageSchema = durableBrowserMessageSchema.extend({ fullOutputPath: z.string().optional(), thinkingLevel: z.string().optional() });
