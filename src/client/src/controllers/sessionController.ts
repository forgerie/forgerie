import { api as defaultApi, type AskUserCloseResponse, type AskUserSubmission, type CommandResult, type ExtensionDialogAnswer, type ExtensionDialogCloseReason, type ExtensionDialogCloseResponse, type ExtensionDialogOutcome, type MessagePage, type PendingAskUser, type PendingExtensionDialog, type PromptAttachment, type QueuedSessionMessage, type SessionActivity, type SessionBulkFailure, type SessionCleanupExecuteResponse, type SessionInfo, type SessionRef, type SessionStatus, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type Workspace } from "../api";
import { ASK_USER_OTHER_TEXT_MAX_LENGTH, type NewSessionAgentChoices } from "../../../shared/apiTypes";
import { MAX_PROMPT_ATTACHMENTS, maximumSavedAttachmentReferencesLength } from "../../../shared/promptAttachments";
import type { AppState, ClosedExtensionDialog } from "../appState";
import { forgetCachedNewSession, isCachedNewSessionInfo, markCachedNewSessionInfo, mergeCachedNewSessions, rememberCachedNewSession, stripCachedNewSessionMarker } from "../cachedNewSessions";
import { normalizeMessages, textMessage } from "../chatMessages";
import { machineSessionKey } from "../machineKeys";
import { clearDraft, loadDraft, moveDraft, saveDraft } from "../promptDraftStorage";
import { clearAskDraft, type AskDraftSubmission } from "../askDrafts";
import { ChatTranscriptStore, transcriptViewFromHistory, type ChatTranscriptView } from "../chatTranscriptStore";
import { isShellInput } from "../inputModes";
import { fileCompletionInsertText } from "../promptCompletions";
import { SessionSocket, type GlobalSessionEvent, type SessionUiEvent } from "../sessionSocket";
import { isArchivableSessionInfo, isTransientNewSessionInfo } from "../sessionPersistence";
import {
  selectedChatCachedReadable,
  selectedChatCanUseRuntime,
  selectedChatFailed,
  selectedChatFreshReadable,
  selectedChatLiveReady,
  selectedChatLoading,
  selectedChatPreviewReadable,
  selectedChatNoTarget,
  selectedChatReadOnly,
  selectedChatReadability,
  selectedChatTarget,
  selectedChatTargetsEqual,
  type SelectedChatReadability,
  type SelectedChatTarget,
} from "../selectedChatLoad";
import { isSessionActive } from "../../../shared/activity";
import type { PromptAttachmentDelivery, SessionNotificationInboxEvent, SessionStartupProgressEvent, SessionUiEvent as SharedSessionUiEvent } from "../../../shared/apiTypes";
import { base64ByteLength } from "../../../shared/promptAttachments";
import { fingerprintPromptResourceDeliveryText, parseLeadingSlashCommand, type PromptResourceCommandIdentity } from "../../../shared/promptResourceCommand";
import type { NewSessionFirstPromptSubmission } from "../newSessionComposer";
import { InMemorySessionSelectionMemory, markSessionArchived, markSessionsArchived, selectPreferredSession, selectionAfterArchivingSession, selectionAfterArchivingSessions, shouldDeselectAfterArchivedCollapse, type SessionSelectionMemory } from "./sessionSelection";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import type { SessionInboxBridge } from "./sessionInboxController";
import { sessionPathsEqual } from "../sessionPaths";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";

const MESSAGE_PAGE_SIZE = 25;

export interface SessionEventSocket {
  connect(
    session: SessionRef,
    onEvent: (event: SessionUiEvent) => void,
    onReconnect?: () => void,
    machineId?: string,
    onInitialOpen?: () => void,
  ): void;
  setHandler(onEvent: (event: SessionUiEvent) => void): void;
  close(): void;
}

export interface SessionNotificationSessionBridge {
  prepareSelectedSession(session: SessionInfo, machineId: string): void;
  clearSelectedSession(): void;
  refreshSelectedSession(session: SessionRef, machineId: string): Promise<void>;
  applyInboxEvent(machineId: string, event: SessionNotificationInboxEvent): void;
}

export interface PromptEditorTextReplacement {
  machineId: string;
  sessionId: string;
  text: string;
  snapshot?: SessionLaunchRecoveryDraftSnapshot | undefined;
}

export interface SelectedSessionReady {
  machineId: string;
  session: SessionInfo;
}

export interface PendingSessionLaunchView {
  readonly message: ReturnType<typeof textMessage>;
  readonly initialPreviewPending: boolean;
  readonly suppressedCanonicalMessage?: ReturnType<typeof textMessage>;
}

export type SessionTranscriptPreview = ChatTranscriptView;

export interface ReadinessSendRecovery {
  readonly count: number;
  readonly attachmentsNeedReattaching: boolean;
  readonly restoredText: string;
}

export interface SessionControllerDependencies {
  api?: typeof defaultApi;
  socket?: SessionEventSocket;
  transcripts?: ChatTranscriptStore;
  notifications?: SessionNotificationSessionBridge;
  /** Bridge to the machine-scoped inbox store for archive/restore notifications. */
  inbox?: SessionInboxBridge;
  // `void` keeps existing editor bridges source-compatible; only explicit `false` reports a lost replacement race.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  replacePromptEditorText?: (replacement: PromptEditorTextReplacement) => boolean | void | Promise<boolean | void>;
  onSelectedSessionReady?: (selection: SelectedSessionReady) => void;
  onPendingSessionLaunchProjectionChange?: () => void;
  onManagedProcessesEvent?: (event: Extract<SharedSessionUiEvent, { type: "processes.update" | "processes.output" }> | { type: "processes.refresh" }) => void;
}

interface BulkSessionMutationResult {
  succeededIds: string[];
  failures: string[];
  generatedAt?: string;
}

export type ClientPendingStartSessionInfo = SessionInfo & { clientPendingStart: true; machineId: string };

type QueuedPendingSessionSendInput =
  | { type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" | undefined; attachments?: PromptAttachment[] | undefined; delivery: PromptAttachmentDelivery; purpose?: "initialPrompt" }
  | { type: "promptResource"; text: string; identity: PromptResourceCommandIdentity; streamingBehavior?: "steer" | "followUp" | undefined; attachments?: PromptAttachment[] | undefined; delivery: PromptAttachmentDelivery; purpose: "initialPrompt"; retryAttempts?: number | undefined }
  | { type: "shell"; text: string }
  | { type: "command"; text: string };

type QueuedPendingSessionSend = QueuedPendingSessionSendInput & { id: string; deliveredText?: string | undefined; deliveryReceipt?: string | undefined };

export type FirstPromptSubmission = NewSessionFirstPromptSubmission;

export type SessionLaunchRecoveryDraftSnapshot = Omit<FirstPromptSubmission, "promptResourceCommandIdentity">;

export interface SessionLaunchRecoveryDraftSeed {
  readonly id: string;
  readonly snapshot: SessionLaunchRecoveryDraftSnapshot;
}

interface ReadinessQueuedSends {
  readonly session: SessionInfo;
  readonly machineId: string;
  readonly sends: QueuedPendingSessionSend[];
}

export interface SessionLaunchDestination {
  readonly machineId: string;
  readonly workspaceId: string;
  readonly cwd: string;
}

export type SessionLaunchCompletion =
  | { readonly kind: "started" }
  | { readonly kind: "failed"; readonly message: string };

export interface SessionLaunchHandoff {
  readonly pendingSessionId: string;
  readonly completion: Promise<SessionLaunchCompletion>;
}

export interface SessionLaunchAttachmentMetadata {
  readonly name?: string | undefined;
  readonly mimeType: string;
  readonly size: number;
}

export interface SessionLaunchRecovery {
  readonly stage: "creationFailed" | "promptConfirmedUnsent" | "promptDeliveryAmbiguous";
  readonly sessionId: string;
  readonly destination: SessionLaunchDestination;
  readonly retrying: boolean;
  readonly requiresPromptResourceValidation?: boolean | undefined;
  readonly attachments?: readonly SessionLaunchAttachmentMetadata[] | undefined;
  readonly delivery?: PromptAttachmentDelivery | undefined;
}

type SessionLaunchSelection = "select" | "preserve";

interface PendingSessionStart {
  tempId: string;
  workspaceId: string;
  cwd: string;
  machineId: string;
  session: ClientPendingStartSessionInfo;
  /** Model and thinking level chosen before this session existed. */
  agentChoices?: NewSessionAgentChoices;
  queuedSends: QueuedPendingSessionSend[];
  discarded: boolean;
  /**
   * The real session id, learned from the daemon's `session.startup` events
   * long before the create request resolves. It is what lets the startup view
   * subscribe to the constructing session and answer its `session_start`
   * dialogs — the dialogs that gate the readiness the create request waits on.
   */
  backendSessionId?: string;
}

type FirstPromptQueuedSend = Extract<QueuedPendingSessionSend, { type: "prompt" }> | Extract<QueuedPendingSessionSend, { type: "promptResource" }>;

interface PendingSessionLaunchProjection {
  readonly queued: FirstPromptQueuedSend;
  readonly message: ReturnType<typeof textMessage>;
  initialPreviewPending: boolean;
  canonicalMessage: ReturnType<typeof textMessage> | undefined;
  receiptReconciliationPending: boolean;
  receiptReconciliationQueuedMessages: readonly ReturnType<typeof textMessage>[] | undefined;
  readonly receiptCheckedTexts: Set<string>;
}

type ClaimedSessionLaunchRecoveryDraftQueue = Omit<Extract<QueuedPendingSessionSend, { type: "prompt" }>, "text" | "attachments" | "deliveredText">
  | Omit<Extract<QueuedPendingSessionSend, { type: "promptResource" }>, "text" | "attachments" | "deliveredText">;

interface ClaimedSessionLaunchRecoveryDraft {
  readonly index: number;
  readonly queued: ClaimedSessionLaunchRecoveryDraftQueue;
}

interface SessionLaunchRecoveryRecord {
  recovery: SessionLaunchRecovery;
  queuedSends: QueuedPendingSessionSend[];
  pending?: PendingSessionStart;
  session?: SessionInfo;
  creationFailureMessage?: string;
  claimedDraft?: ClaimedSessionLaunchRecoveryDraft;
}

interface SuppressedCreatedSession {
  session: SessionInfo;
  machineId: string;
}

interface SelectedSessionRefreshTarget {
  session: SessionInfo;
  machineId: string;
  selectionSeq: number;
}

export class SessionController {
  private readonly socket: SessionEventSocket;
  private readonly api: typeof defaultApi;
  private readonly transcripts: ChatTranscriptStore;
  private readonly notifications: SessionNotificationSessionBridge | undefined;
  private readonly inbox: SessionInboxBridge | undefined;
  private readonly replacePromptEditorText: SessionControllerDependencies["replacePromptEditorText"];
  private readonly onSelectedSessionReady: SessionControllerDependencies["onSelectedSessionReady"];
  private readonly onPendingSessionLaunchProjectionChange: SessionControllerDependencies["onPendingSessionLaunchProjectionChange"];
  private readonly onManagedProcessesEvent: SessionControllerDependencies["onManagedProcessesEvent"];
  private selectionSeq = 0;
  private disposed = false;
  // Join-time stream watermark for the selected session. `seq` is the
  // `SessionEventHub` sequence captured together with the seeded partial by the
  // stream snapshot: buffered/live events with `seq <= seq` are already reflected
  // in the committed history + seeded partial and must be dropped, so every event
  // applies exactly once. Reset whenever the selection changes.
  private streamWatermark: { sessionId: string; seq: number } | undefined;
  private latestTranscriptSeq: { sessionId: string; seq: number } | undefined;
  private liveMessagePageEnd = 0;
  private transcriptRevision = 0;
  private pendingTranscriptEvents: SessionUiEvent[] = [];
  private pendingStatusBySession = new Map<string, SessionStatus>();
  private pendingActivityBySession = new Map<string, SessionActivity>();
  private pendingFrame: number | undefined;
  private pendingSessionStartSeq = 0;
  private pendingQueuedSendSeq = 0;
  private recoveryDraftClaimSeq = 0;
  private readonly pendingSessionStarts = new Map<string, PendingSessionStart>();
  /** Ephemeral view data kept outside AppState and durable draft storage. */
  private readonly pendingSessionLaunchProjections = new Map<string, PendingSessionLaunchProjection>();
  private readonly readinessQueuedSends = new Map<string, ReadinessQueuedSends>();
  private readonly transcriptPreviewRequests = new Map<string, Promise<MessagePage>>();
  private readonly sessionLaunchRecoveries = new Map<string, SessionLaunchRecoveryRecord>();
  private readonly suppressedCreatedSessions = new Map<string, SuppressedCreatedSession>();
  private readonly selectedSessionRefreshes = new TrailingRefreshCoordinator<string>();

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    private readonly sessionSelection: SessionSelectionMemory = new InMemorySessionSelectionMemory(),
    deps: SessionControllerDependencies = {},
  ) {
    this.socket = deps.socket ?? new SessionSocket();
    this.api = deps.api ?? defaultApi;
    this.transcripts = deps.transcripts ?? new ChatTranscriptStore();
    this.notifications = deps.notifications;
    this.inbox = deps.inbox;
    this.replacePromptEditorText = deps.replacePromptEditorText;
    this.onSelectedSessionReady = deps.onSelectedSessionReady;
    this.onPendingSessionLaunchProjectionChange = deps.onPendingSessionLaunchProjectionChange;
    this.onManagedProcessesEvent = deps.onManagedProcessesEvent;
  }

  applyGlobalEvent(event: GlobalSessionEvent): void {
    // Route all session events to the inbox controller so its statuses map
    // stays current alongside the workspace-scoped session list.
    const machineId = selectedMachineId(this.getState());
    this.inbox?.applyGlobalEvent(machineId, event);
    if (event.type === "status.update") this.queueStatusUpdate(event.status);
    else if (event.type === "activity.update") this.queueActivityUpdate(event.activity);
    else if (event.type === "session.created") this.applyCreatedSession(event.session);
    else if (event.type === "session.name") this.applySessionName(event.sessionId, event.name);
    else if (event.type === "session.pinned") this.applySessionPinned(event.sessionId, event.pinned);
    else if (event.type === "session.tabs") this.applySessionTabs(event.sessionId, event.tabs);
    else if (event.type === "session.startup") this.queueStartupProgress(event);
  }

  dispose() {
    this.disposed = true;
    this.selectionSeq += 1;
    this.socket.close();
    this.latestTranscriptSeq = undefined;
    this.liveMessagePageEnd = 0;
    this.clearPendingUpdates();
    for (const queue of this.readinessQueuedSends.values()) this.restoreReadinessQueueDraft(queue);
    this.pendingSessionLaunchProjections.clear();
    this.readinessQueuedSends.clear();
    this.transcriptPreviewRequests.clear();
    this.transcripts.dispose();
    this.setState({ selectedChatLoad: selectedChatNoTarget(), clientQueuedSessionMessages: {} });
  }

  clearActiveSession() {
    this.selectionSeq += 1;
    this.socket.close();
    this.notifications?.clearSelectedSession();
    this.streamWatermark = undefined;
    this.latestTranscriptSeq = undefined;
    this.liveMessagePageEnd = 0;
    this.clearPendingUpdates();
    // Note: sendingPrompts is intentionally NOT cleared here. Deselecting a
    // session must not cancel the in-flight upload indicator of the session
    // that is still sending; the per-session entry is cleared by send()'s
    // finally block when the request settles.
    this.setState({ selectedSession: undefined, selectedChatLoad: selectedChatNoTarget(), messages: [], messagePageStart: 0, messagePageEnd: 0, messagePageTotal: 0, isLoadingEarlierMessages: false, status: undefined, activity: undefined, pendingAsk: undefined, pendingDialogs: [], closedDialogs: [], availableThinkingLevels: [], treeDialog: undefined });
  }

  deselectSession(options?: { forgetRememberedSelection?: boolean | undefined; updateUrl?: boolean | undefined }) {
    const state = this.getState();
    const cwd = state.selectedSession?.cwd ?? state.selectedWorkspace?.path;
    if (options?.forgetRememberedSelection === true && cwd !== undefined) this.sessionSelection.forgetWorkspace(this.workspaceSelectionKey(cwd));
    this.clearActiveSession();
    if (options?.updateUrl !== false) this.updateUrl();
  }

  clearSelectionAfterArchivedCollapse(): void {
    const state = this.getState();
    if (!shouldDeselectAfterArchivedCollapse(state.sessions, state.selectedSession)) return;
    this.deselectSession({ forgetRememberedSelection: true });
  }

  async startSession() {
    const workspace = this.getState().selectedWorkspace;
    if (!workspace) return;
    const destination = sessionLaunchDestinationForWorkspace(workspace, selectedMachineId(this.getState()));
    const pending = this.createPendingSessionStart(destination);
    this.pendingSessionStarts.set(pending.tempId, pending);
    this.insertAndSelectPendingSession(pending.session);
    await this.startPendingSession(pending);
  }

  async launchSession(submission: FirstPromptSubmission, agentChoices?: NewSessionAgentChoices): Promise<void> {
    const workspace = this.getState().selectedWorkspace;
    if (workspace === undefined) return;
    const handoff = this.beginSessionLaunch(
      sessionLaunchDestinationForWorkspace(workspace, selectedMachineId(this.getState())),
      submission,
      agentChoices,
      "select",
    );
    await handoff?.completion;
  }

  launchSessionPreservingSelection(
    destination: SessionLaunchDestination,
    submission: FirstPromptSubmission,
    agentChoices?: NewSessionAgentChoices,
  ): SessionLaunchHandoff | undefined {
    if (!this.isCurrentSessionLaunchDestination(destination)) return undefined;
    return this.beginSessionLaunch(destination, submission, agentChoices, "preserve");
  }

  private beginSessionLaunch(
    destination: SessionLaunchDestination,
    submission: FirstPromptSubmission,
    agentChoices: NewSessionAgentChoices | undefined,
    selection: SessionLaunchSelection,
  ): SessionLaunchHandoff | undefined {
    if (!sessionLaunchDestinationIsValid(destination) || firstPromptSubmissionIsEmpty(submission)) return undefined;
    const promptResourceIdentity = submission.promptResourceCommandIdentity;
    if (submission.text.startsWith("/") && promptResourceIdentity === undefined) return undefined;
    const attachments = submission.attachments?.map((attachment) => ({ ...attachment }));
    const pending = this.createPendingSessionStart(destination);
    if (agentChoices !== undefined) pending.agentChoices = agentChoices;
    this.pendingSessionStarts.set(pending.tempId, pending);
    if (selection === "select") this.insertAndSelectPendingSession(pending.session);
    else this.insertPendingSessionPreservingSelection(pending);
    if (promptResourceIdentity === undefined) {
      this.enqueuePendingSessionSend(pending.session, { type: "prompt", text: submission.text, attachments, delivery: submission.delivery ?? "inline", purpose: "initialPrompt" });
    } else {
      this.enqueuePendingSessionSend(pending.session, { type: "promptResource", text: submission.text, identity: promptResourceIdentity, attachments, delivery: submission.delivery ?? "inline", purpose: "initialPrompt" });
    }
    return { pendingSessionId: pending.tempId, completion: this.startPendingSession(pending) };
  }

  getSessionLaunchRecovery(sessionId: string): SessionLaunchRecovery | undefined {
    return this.sessionLaunchRecoveries.get(sessionId)?.recovery;
  }

  hasQueuedInitialPrompt(sessionId: string): boolean {
    return this.pendingSessionStarts.get(sessionId)?.queuedSends.some(isInitialPromptSend) === true;
  }

  pendingSessionLaunchView(machineId: string, sessionId: string): PendingSessionLaunchView | undefined {
    const projection = this.pendingSessionLaunchProjections.get(machineSessionKey(machineId, sessionId));
    if (projection === undefined) return undefined;
    return {
      message: projection.message,
      initialPreviewPending: projection.initialPreviewPending,
      ...(projection.canonicalMessage === undefined ? {} : { suppressedCanonicalMessage: projection.canonicalMessage }),
    };
  }

  claimSessionLaunchRecoveryDraft(sessionId: string): SessionLaunchRecoveryDraftSeed | undefined {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record === undefined || (record.recovery.stage !== "creationFailed" && record.recovery.stage !== "promptConfirmedUnsent") || record.claimedDraft !== undefined) return undefined;
    const index = record.queuedSends.findIndex(isInitialPromptSend);
    const queued = index === -1 ? undefined : record.queuedSends[index];
    if (queued === undefined || !isInitialPromptSend(queued)) return undefined;
    record.queuedSends.splice(index, 1);
    this.pendingSessionLaunchProjections.delete(machineSessionKey(record.recovery.destination.machineId, sessionId));
    if (record.pending !== undefined && record.pending.queuedSends !== record.queuedSends) {
      record.pending.queuedSends = record.pending.queuedSends.filter((candidate) => candidate.id !== queued.id);
    }
    record.claimedDraft = { index, queued: claimedRecoveryDraftQueueBookkeeping(queued) };
    record.recovery = payloadFreeClaimedRecovery(record.recovery, queued);
    this.publishCreationFailedRecoveryQueue(sessionId, record);
    return {
      id: `${sessionId}:claim-${String(++this.recoveryDraftClaimSeq)}`,
      snapshot: {
        text: queued.text,
        ...(queued.attachments === undefined ? {} : { attachments: queued.attachments.map((attachment) => ({ ...attachment })) }),
        delivery: queued.delivery,
      },
    };
  }

  returnSessionLaunchRecoveryDraft(sessionId: string, snapshot: SessionLaunchRecoveryDraftSnapshot): void {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    const claimed = record?.claimedDraft;
    if (record === undefined || (record.recovery.stage !== "creationFailed" && record.recovery.stage !== "promptConfirmedUnsent") || claimed === undefined) return;
    if (firstPromptSubmissionIsEmpty(snapshot)) {
      delete record.claimedDraft;
      record.recovery = {
        stage: record.recovery.stage,
        sessionId: record.recovery.sessionId,
        destination: record.recovery.destination,
        retrying: record.recovery.retrying,
      };
      this.publishCreationFailedRecoveryQueue(sessionId, record);
      return;
    }
    const queued = queuedRecoveryDraftFromSnapshot(claimed.queued, snapshot);
    insertQueuedRecoveryDraft(record.queuedSends, claimed.index, queued);
    if (record.pending !== undefined && record.pending.queuedSends !== record.queuedSends) {
      insertQueuedRecoveryDraft(record.pending.queuedSends, claimed.index, queued);
    }
    delete record.claimedDraft;
    this.setPendingSessionLaunchProjection(record.recovery.destination.machineId, sessionId, queued);
    record.recovery = recoveryWithQueuedSubmission(record.recovery, queued);
    this.publishCreationFailedRecoveryQueue(sessionId, record);
  }

  mergeCreationFailedSessionStarts(cwd: string, listedSessions: SessionInfo[], machineId: string): SessionInfo[] {
    const recovered: ClientPendingStartSessionInfo[] = [];
    for (const record of this.sessionLaunchRecoveries.values()) {
      if (record.recovery.stage !== "creationFailed"
        || record.pending === undefined
        || record.recovery.destination.machineId !== machineId
        || !sessionPathsEqual(record.recovery.destination.cwd, cwd)) continue;
      recovered.push(record.pending.session);
    }
    if (recovered.length === 0) return listedSessions;
    const recoveredIds = new Set(recovered.map((session) => session.id));
    return [...recovered, ...listedSessions.filter((session) => !recoveredIds.has(session.id))];
  }

  /** Remove a failed creation after its replacement pending row is the accepted selection. */
  acceptSessionLaunchReplacement(failedSessionId: string, replacementSessionId: string): void {
    const record = this.sessionLaunchRecoveries.get(failedSessionId);
    const state = this.getState();
    if (record === undefined
      || (record.recovery.stage !== "creationFailed" && record.recovery.stage !== "promptConfirmedUnsent")
      || replacementSessionId === failedSessionId
      || state.selectedSession?.id !== replacementSessionId
      || !state.sessions.some((session) => session.id === replacementSessionId)) return;
    this.sessionLaunchRecoveries.delete(failedSessionId);
    this.pendingSessionLaunchProjections.delete(machineSessionKey(record.recovery.destination.machineId, failedSessionId));
    clearDraft(machineSessionKey(record.recovery.destination.machineId, failedSessionId));
    const removeFailedSession = record.recovery.stage === "creationFailed";
    this.setState({
      sessions: removeFailedSession ? state.sessions.filter((session) => session.id !== failedSessionId) : state.sessions,
      sessionStatuses: omitKey(state.sessionStatuses, failedSessionId),
      sessionActivities: omitSessionActivity(state.sessionActivities, failedSessionId),
      sendingPrompts: omitKey(state.sendingPrompts, failedSessionId),
      clientQueuedSessionMessages: omitKey(state.clientQueuedSessionMessages, failedSessionId),
    });
    if (removeFailedSession) this.inbox?.notifyDeleted(record.recovery.destination.machineId, [failedSessionId]);
  }

  async retrySessionLaunch(sessionId: string): Promise<void> {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record === undefined || record.recovery.retrying) return;

    if (record.recovery.stage === "creationFailed" && record.pending !== undefined) {
      if (record.recovery.requiresPromptResourceValidation === true) return;
      record.recovery = { ...record.recovery, retrying: true };
      record.pending.discarded = false;
      delete record.pending.backendSessionId;
      this.pendingSessionStarts.set(sessionId, record.pending);
      this.applySessionLaunchRetryActivity(sessionId, "Creating session");
      await this.startPendingSession(record.pending);
      return;
    }

    if (record.recovery.stage !== "promptConfirmedUnsent" || record.session === undefined || record.recovery.requiresPromptResourceValidation === true) return;
    const firstPrompt = record.queuedSends[0];
    if (firstPrompt?.type === "promptResource") firstPrompt.retryAttempts = (firstPrompt.retryAttempts ?? 0) + 1;
    record.recovery = { ...record.recovery, retrying: true };
    this.applySessionLaunchRetryActivity(sessionId, INITIAL_PROMPT_RETRY_ACTIVITY_LABEL);
    await this.flushQueuedPendingSends(record.session, record.recovery.destination.machineId, record.queuedSends, record.recovery.destination);
    if (this.sessionLaunchRecoveries.get(sessionId) === record) {
      this.sessionLaunchRecoveries.delete(sessionId);
      this.clearSuccessfulInitialPromptRetryActivity(sessionId);
    }
  }

  async restoreSessionLaunchPrompt(sessionId: string): Promise<void> {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record?.recovery.stage !== "promptDeliveryAmbiguous" || record.session === undefined || this.replacePromptEditorText === undefined) return;
    if (!this.isSelectedSessionIdentity(sessionId, record.recovery.destination.machineId)) return;
    const queued = record.queuedSends[0];
    if (queued === undefined || !isInitialPromptSend(queued)) return;
    const snapshot: SessionLaunchRecoveryDraftSnapshot = {
      text: queued.text,
      ...(queued.attachments === undefined ? {} : { attachments: queued.attachments.map((attachment) => ({ ...attachment })) }),
      delivery: queued.delivery,
    };
    const replaced = await this.replacePromptEditorText({
      machineId: record.recovery.destination.machineId,
      sessionId,
      text: queued.text,
      snapshot,
    });
    if (replaced === false || this.sessionLaunchRecoveries.get(sessionId) !== record) return;
    const retainedQueuedSends = record.queuedSends.slice(1);
    this.sessionLaunchRecoveries.delete(sessionId);
    this.dropNextQueuedSessionMessage(sessionId);
    this.clearInitialPromptRecoveryProjection(record.recovery.destination.machineId, sessionId);
    await this.flushQueuedPendingSends(record.session, record.recovery.destination.machineId, retainedQueuedSends, record.recovery.destination);
  }

  async refreshSessionLaunchRecovery(sessionId: string): Promise<void> {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record?.recovery.stage !== "promptDeliveryAmbiguous" || record.session === undefined) return;
    const { machineId } = record.recovery.destination;
    const transcriptRevision = this.transcriptRevision;
    try {
      const [page, status] = await Promise.all([
        this.api.messages(record.session, { limit: MESSAGE_PAGE_SIZE }, machineId),
        this.api.status(record.session, machineId),
      ]);
      if (this.sessionLaunchRecoveries.get(sessionId) !== record || !this.isSelectedSessionIdentity(sessionId, machineId)) return;
      const merge = await this.transcripts.mergeHistoryCooperatively(machineSessionKey(machineId, sessionId), page);
      if (merge.kind === "superseded" || this.sessionLaunchRecoveries.get(sessionId) !== record || !this.isSelectedSessionIdentity(sessionId, machineId)) return;
      if (transcriptRevision === this.transcriptRevision) this.setState(merge.view);
      this.applyStatus(status);
      if (await initialPromptRecoveryAccepted(page, record.queuedSends[0])) {
        const retainedQueuedSends = record.queuedSends.slice(1);
        this.sessionLaunchRecoveries.delete(sessionId);
        this.dropNextQueuedSessionMessage(sessionId);
        this.clearInitialPromptRecoveryProjection(machineId, sessionId);
        this.markCachedNewSessionPersisted(record.session);
        await this.flushQueuedPendingSends(record.session, machineId, retainedQueuedSends, record.recovery.destination);
        return;
      }
      const stage = canonicalSessionIsBlankAndIdle(page, status) ? "promptConfirmedUnsent" : "promptDeliveryAmbiguous";
      record.recovery = { ...record.recovery, stage };
      this.applyInitialPromptRecoveryActivity(record.recovery);
    } catch (error) {
      if (this.sessionLaunchRecoveries.get(sessionId) === record) this.setState({ error: String(error) });
    }
  }

  private applySessionLaunchRetryActivity(sessionId: string, label: string): void {
    const activity: SessionActivity = {
      sessionId,
      phase: "active",
      label,
      detail: "Retry in progress",
      at: new Date().toISOString(),
    };
    const state = this.getState();
    this.setState({
      sessionActivities: { ...state.sessionActivities, [sessionId]: activity },
      activity: state.selectedSession?.id === sessionId ? activity : state.activity,
      error: "",
    });
  }

  private clearInitialPromptRecoveryProjection(machineId: string, sessionId: string): void {
    this.pendingSessionLaunchProjections.delete(machineSessionKey(machineId, sessionId));
    const state = this.getState();
    const clearsSessionActivity = isInitialPromptRecoveryActivity(state.sessionActivities[sessionId]);
    const clearsSelectedActivity = state.selectedSession?.id === sessionId && isInitialPromptRecoveryActivity(state.activity);
    this.setState({
      ...(clearsSessionActivity ? { sessionActivities: omitSessionActivity(state.sessionActivities, sessionId) } : {}),
      ...(clearsSelectedActivity ? { activity: undefined } : {}),
      error: "",
    });
  }

  private clearSuccessfulInitialPromptRetryActivity(sessionId: string): void {
    const state = this.getState();
    const clearsSessionActivity = isInitialPromptRetryActivity(state.sessionActivities[sessionId]);
    const clearsSelectedActivity = state.selectedSession?.id === sessionId && isInitialPromptRetryActivity(state.activity);
    if (!clearsSessionActivity && !clearsSelectedActivity) return;
    this.setState({
      ...(clearsSessionActivity ? { sessionActivities: omitSessionActivity(state.sessionActivities, sessionId) } : {}),
      ...(clearsSelectedActivity ? { activity: undefined } : {}),
    });
  }

  private async startPendingSession(pending: PendingSessionStart): Promise<SessionLaunchCompletion> {
    try {
      const session = await this.api.startSession(pending.cwd, pending.machineId, pending.tempId, pending.agentChoices);
      await this.resolvePendingSessionStart(pending.tempId, session);
      return { kind: "started" };
    } catch (error) {
      const recovered = await this.failPendingSessionStart(pending.tempId, error);
      return recovered ? { kind: "started" } : { kind: "failed", message: errorMessage(error) };
    }
  }

  preferredSession(cwd: string, sessions: SessionInfo[], targetSessionId: string | undefined): SessionInfo | undefined {
    return selectPreferredSession(sessions, { targetSessionId, latestSessionId: this.sessionSelection.latestSessionId(this.workspaceSelectionKey(cwd)) });
  }

  async previewSession(session: SessionInfo, machineId: string): Promise<SessionTranscriptPreview> {
    const key = machineSessionKey(machineId, session.id);
    for (const pendingKey of this.transcriptPreviewRequests.keys()) {
      if (pendingKey !== key) this.transcriptPreviewRequests.delete(pendingKey);
    }
    let request = this.transcriptPreviewRequests.get(key);
    if (request === undefined) {
      request = this.api.messages(session, { limit: MESSAGE_PAGE_SIZE, preview: true }, machineId);
      this.transcriptPreviewRequests.set(key, request);
      const pending = request;
      void request.catch(() => {
        if (this.transcriptPreviewRequests.get(key) === pending) this.transcriptPreviewRequests.delete(key);
      });
    }
    return transcriptViewFromHistory(await request);
  }

  async selectSession(session: SessionInfo, options?: { updateUrl?: boolean | undefined; preserveTreeDialog?: boolean | undefined; propagateRefreshError?: boolean | undefined }) {
    if (this.disposed) return;
    if (isClientPendingStartSessionInfo(session)) {
      this.selectClientPendingStartSession(session, options);
      return;
    }
    this.sessionSelection.rememberSession({ ...session, cwd: this.workspaceSelectionKey(session.cwd) });
    const seq = ++this.selectionSeq;
    this.transcripts.cancelCooperativeMerges();
    this.socket.close();
    this.streamWatermark = undefined;
    this.latestTranscriptSeq = undefined;
    this.clearPendingUpdates();
    const machineId = selectedMachineId(this.getState());
    this.notifications?.prepareSelectedSession(session, machineId);
    const transcriptKey = this.sessionCacheKey(session.id);
    const target = selectedChatTarget(machineId, session);
    const cached = this.transcripts.boundedCachedView(transcriptKey, MESSAGE_PAGE_SIZE);
    const showCachedImmediately = cached !== undefined;
    const openingView = cached ?? transcriptViewFromHistory(undefined);
    this.liveMessagePageEnd = openingView.messagePageEnd;
    this.reconcilePendingSessionLaunchProjection(machineId, session.id, openingView.messages, openingView.messagePageStart);
    this.setState({
      selectedSession: session,
      selectedChatLoad: showCachedImmediately ? selectedChatCachedReadable(target) : selectedChatLoading(target),
      ...openingView,
      isLoadingEarlierMessages: false,
      ...(options?.preserveTreeDialog === true ? {} : { treeDialog: undefined }),
      status: session.archived === true ? undefined : this.getState().sessionStatuses[session.id],
      activity: session.archived === true ? undefined : this.getState().sessionActivities[session.id],
      pendingAsk: session.archived === true ? undefined : this.getState().sessionStatuses[session.id]?.pendingAsk,
      pendingDialogs: session.archived === true ? [] : (this.getState().sessionStatuses[session.id]?.pendingDialogs ?? []),
      closedDialogs: [],
      availableThinkingLevels: [],
    });
    let buffered: SessionUiEvent[] | undefined;
    try {
      if (session.archived === true) {
        const page = await this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, selectedMachineId(this.getState()));
        if (seq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) return;
        const merge = await this.transcripts.mergeHistoryCooperatively(transcriptKey, page);
        if (merge.kind === "superseded" || seq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) return;
        this.reconcilePendingSessionLaunchProjection(machineId, session.id, merge.view.messages, merge.view.messagePageStart);
        this.setState({ ...merge.view, selectedChatLoad: selectedChatReadOnly(target, "fresh"), isLoadingEarlierMessages: false, status: undefined, activity: undefined, pendingAsk: undefined, pendingDialogs: [], closedDialogs: [] });
        this.transcripts.schedulePersist(transcriptKey);
        this.transcriptPreviewRequests.delete(transcriptKey);
        this.onSelectedSessionReady?.({ machineId, session });
        if (options?.updateUrl !== false) this.updateUrl();
        return;
      }
      const socketBuffer: SessionUiEvent[] = [];
      buffered = socketBuffer;
      this.socket.connect(
        session,
        (event) => socketBuffer.push(event),
        () => {
          this.onManagedProcessesEvent?.({ type: "processes.refresh" });
          void this.refreshSelectedSession(session.id);
        },
        machineId,
        () => { void this.notifications?.refreshSelectedSession(session, machineId); },
      );
      await this.requestSelectedSessionRefresh({ session, machineId, selectionSeq: seq });
      if (!this.isCurrentRefreshTarget({ session, machineId, selectionSeq: seq })) return;
      void this.refreshAvailableThinkingLevels();
      for (const event of socketBuffer) this.applyEvent(event);
      this.socket.setHandler((event) => { this.applyEvent(event); });
      this.onSelectedSessionReady?.({ machineId, session });
      if (options?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      this.transcriptPreviewRequests.delete(transcriptKey);
      if (seq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) {
        // Tree navigation still needs to know when a same-session reselection's
        // shared trailing refresh failed, even though this selection is stale.
        if (options?.propagateRefreshError === true && this.isSelectedSessionIdentity(session.id, machineId)) throw error;
        return;
      }
      if (isCachedNewSessionInfo(session) && isSessionNotFoundError(error)) {
        await this.recreateCachedNewSession(session, options);
        return;
      }
      // A failed join refresh must not strand the socket on its temporary
      // buffering callback. If the stream snapshot established a watermark,
      // replay only events not already reflected by that snapshot. Without the
      // snapshot there is no safe de-duplication anchor, so skip the initial
      // buffer and let future live events or reconnect refresh recover.
      if (buffered !== undefined) {
        if (this.hasStreamWatermark()) {
          // A successful stream snapshot covers transcript content. A failed
          // status request does not cover status, activity, asks, or dialogs,
          // so replay those buffered projections without the transcript
          // watermark while still deduplicating buffered transcript events.
          for (const event of buffered) this.applyEvent(event, !isTranscriptContentEvent(event));
        }
        this.socket.setHandler((event) => { this.applyEvent(event); });
      }
      const failure = this.recoverReadinessFailure(session, machineId, error);
      this.setState({ selectedChatLoad: selectedChatFailed(target, this.currentSelectedChatReadability(target), failure), error: failure });
      if (options?.propagateRefreshError === true) throw error;
    }
  }

  async loadEarlierMessages() {
    let state = this.getState();
    const session = state.selectedSession;
    if (!session || state.isLoadingEarlierMessages || state.messagePageStart <= 0) return;
    const machineId = selectedMachineId(state);
    const key = machineSessionKey(machineId, session.id);
    this.setState({ isLoadingEarlierMessages: true });
    try {
      if (this.transcripts.rawHistoryPage(key) === undefined || this.transcripts.cachedView(key).messages !== state.messages) {
        await this.refreshSelectedSession();
        state = this.getState();
        if (!this.isSelectedSessionReference(session, machineId)
          || state.messagePageStart <= 0
          || this.transcripts.rawHistoryPage(key) === undefined
          || this.transcripts.cachedView(key).messages !== state.messages) return;
        if (!state.isLoadingEarlierMessages) this.setState({ isLoadingEarlierMessages: true });
      }
      const transcriptRevision = this.transcriptRevision;
      const page = await this.api.messages(session, { before: state.messagePageStart, limit: MESSAGE_PAGE_SIZE }, machineId);
      if (!this.isSelectedSessionReference(session, machineId)) return;
      const merge = await this.transcripts.mergeHistoryCooperatively(key, page);
      if (merge.kind === "superseded" || !this.isSelectedSessionReference(session, machineId)) return;
      if (transcriptRevision !== this.transcriptRevision) return;
      this.reconcilePendingSessionLaunchProjection(machineId, session.id, merge.view.messages, merge.view.messagePageStart);
      this.setState(merge.view);
    } catch (error) {
      if (this.isSelectedSessionReference(session, machineId)) this.setState({ error: String(error) });
    } finally {
      if (this.isSelectedSessionReference(session, machineId)) this.setState({ isLoadingEarlierMessages: false });
    }
  }

  private restoreReadinessQueueDraft(queue: ReadinessQueuedSends): ReadinessSendRecovery {
    const key = machineSessionKey(queue.machineId, queue.session.id);
    const recoveredText = queue.sends.map((send) => send.text).filter((text) => text.trim() !== "").join("\n\n");
    const restoredDraft = [recoveredText, loadDraft(key)].filter((text) => text.trim() !== "").join("\n\n");
    if (restoredDraft !== "") saveDraft(key, restoredDraft);
    return {
      count: queue.sends.length,
      attachmentsNeedReattaching: queue.sends.some((send) => send.type === "prompt" && (send.attachments?.length ?? 0) > 0),
      restoredText: restoredDraft,
    };
  }

  recoverReadinessSends(session: SessionInfo, machineId: string): ReadinessSendRecovery | undefined {
    const key = machineSessionKey(machineId, session.id);
    const queue = this.readinessQueuedSends.get(key);
    if (queue === undefined || queue.sends.length === 0) return undefined;
    const recovery = this.restoreReadinessQueueDraft(queue);
    this.readinessQueuedSends.delete(key);
    const state = this.getState();
    this.setState({ clientQueuedSessionMessages: omitKey(state.clientQueuedSessionMessages, session.id) });
    if (state.selectedSession?.id === session.id && selectedMachineId(state) === machineId && this.replacePromptEditorText !== undefined) {
      void this.replaceRecoveredReadinessDraft(session, machineId, recovery.restoredText);
    }
    return recovery;
  }

  private recoverReadinessFailure(session: SessionInfo, machineId: string, error: unknown): string {
    const recovery = this.recoverReadinessSends(session, machineId);
    const attachmentNotice = recovery?.attachmentsNeedReattaching === true ? " Reattach files before retrying." : "";
    const recoveryNotice = recovery === undefined
      ? ""
      : ` ${String(recovery.count)} queued ${recovery.count === 1 ? "message was" : "messages were"} restored to the draft for explicit retry.${attachmentNotice}`;
    return `${String(error)}${recoveryNotice}`;
  }

  private async replaceRecoveredReadinessDraft(session: SessionInfo, machineId: string, text: string): Promise<void> {
    try {
      const replaced = await this.replacePromptEditorText?.({ machineId, sessionId: session.id, text });
      if (replaced === false) throw new Error("the mounted editor no longer owns this session");
    } catch (error) {
      const state = this.getState();
      if (state.selectedSession?.id === session.id && selectedMachineId(state) === machineId) {
        this.setState({ error: `Queued messages remain saved in this session's draft. Reopen the session to retry. ${String(error)}` });
      }
    }
  }

  async sendToSession(session: SessionInfo, machineId: string, text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery: PromptAttachmentDelivery = "inline"): Promise<void> {
    const state = this.getState();
    const selected = state.selectedSession;
    if (selected?.id === session.id && selectedMachineId(state) === machineId && !this.shouldQueueUntilReady(session, machineId)) {
      await this.send(text, streamingBehavior, attachments, delivery);
      return;
    }
    if (session.archived === true) return;
    const trimmed = text.trim();
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (!hasAttachments && trimmed.startsWith("/")) this.enqueueReadinessSend(session, machineId, { type: "command", text });
    else if (!hasAttachments && isShellInput(text)) this.enqueueReadinessSend(session, machineId, { type: "shell", text });
    else this.enqueueReadinessSend(session, machineId, { type: "prompt", text, streamingBehavior, attachments, delivery });
  }

  async send(text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery: PromptAttachmentDelivery = "inline") {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;

    const trimmed = text.trim();
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    const machineId = selectedMachineId(this.getState());
    if (isClientPendingStartSessionInfo(session)) {
      if (!hasAttachments && trimmed.startsWith("/")) this.enqueuePendingSessionSend(session, { type: "command", text });
      else if (!hasAttachments && isShellInput(text)) this.enqueuePendingSessionSend(session, { type: "shell", text });
      else this.enqueuePendingSessionSend(session, { type: "prompt", text, streamingBehavior, attachments, delivery });
      return;
    }
    if (this.shouldQueueUntilReady(session, machineId)) {
      if (!hasAttachments && trimmed.startsWith("/")) this.enqueueReadinessSend(session, machineId, { type: "command", text });
      else if (!hasAttachments && isShellInput(text)) this.enqueueReadinessSend(session, machineId, { type: "shell", text });
      else this.enqueueReadinessSend(session, machineId, { type: "prompt", text, streamingBehavior, attachments, delivery });
      return;
    }
    if (!hasAttachments && trimmed.startsWith("/")) return this.runCommand(text, streamingBehavior);
    if (!hasAttachments && isShellInput(text)) return this.runShell(text);

    // Capture the originating session/machine before any await so the request
    // and its sending indicator stay bound to the right session even if the
    // user navigates elsewhere mid-upload.
    await this.deliverPromptToSession(session, text, streamingBehavior, attachments, delivery, machineId, { markSending: hasAttachments });
  }

  private markSendingPrompt(sessionId: string, sending: boolean): void {
    const current = this.getState().sendingPrompts;
    if (sending) {
      if (current[sessionId] !== true) this.setState({ sendingPrompts: { ...current, [sessionId]: true } });
    } else if (sessionId in current) {
      this.setState({ sendingPrompts: omitKey(current, sessionId) });
    }
  }

  async runShell(text: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    if (isClientPendingStartSessionInfo(session)) {
      this.enqueuePendingSessionSend(session, { type: "shell", text });
      return;
    }
    const machineId = selectedMachineId(this.getState());
    if (this.shouldQueueUntilReady(session, machineId)) {
      this.enqueueReadinessSend(session, machineId, { type: "shell", text });
      return;
    }
    await this.deliverShellToSession(session, text, machineId, { optimisticLine: true });
  }

  async runCommand(text: string, streamingBehavior?: "steer" | "followUp") {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    if (isClientPendingStartSessionInfo(session)) {
      this.enqueuePendingSessionSend(session, { type: "command", text });
      return;
    }
    const machineId = selectedMachineId(this.getState());
    if (this.shouldQueueUntilReady(session, machineId)) {
      this.enqueueReadinessSend(session, machineId, { type: "command", text });
      return;
    }
    await this.deliverCommandToSession(session, text, machineId, { applyResult: true, ...(streamingBehavior === undefined ? {} : { streamingBehavior }) });
  }

  private shouldQueueUntilReady(session: SessionInfo, machineId: string): boolean {
    const key = machineSessionKey(machineId, session.id);
    if (this.readinessQueuedSends.has(key)) return true;
    const load = this.getState().selectedChatLoad;
    // `no-target` is also used by controller-only callers that have not begun a
    // chat-open transition. Preserve their direct-send behavior; a real opening
    // always installs a target-bearing loading state before it exposes Send.
    if (load.kind === "no-target") return false;
    return !selectedChatCanUseRuntime(load)
      || !selectedChatTargetsEqual(load.target, selectedChatTarget(machineId, session));
  }

  private enqueueReadinessSend(session: SessionInfo, machineId: string, input: QueuedPendingSessionSendInput): void {
    const key = machineSessionKey(machineId, session.id);
    const queue = this.readinessQueuedSends.get(key) ?? { session, machineId, sends: [] };
    const queued: QueuedPendingSessionSend = { ...input, id: `readiness-send-${String(++this.pendingQueuedSendSeq)}` };
    queue.sends.push(queued);
    this.readinessQueuedSends.set(key, queue);
    const state = this.getState();
    const visible = state.clientQueuedSessionMessages[session.id] ?? [];
    this.setState({
      clientQueuedSessionMessages: { ...state.clientQueuedSessionMessages, [session.id]: [...visible, queuedSessionMessagePreview(queued)] },
      error: "",
    });
  }

  private async flushReadinessSends(session: SessionInfo, machineId: string): Promise<void> {
    const key = machineSessionKey(machineId, session.id);
    const queue = this.readinessQueuedSends.get(key);
    if (queue === undefined) return;
    while (queue.sends.length > 0) {
      const queued = queue.sends[0];
      if (queued === undefined) return;
      if (!await this.deliverQueuedPendingSend(session, machineId, queued)) {
        const recovery = this.recoverReadinessSends(session, machineId);
        if (recovery !== undefined) {
          const attachmentNotice = recovery.attachmentsNeedReattaching ? " Reattach files before retrying." : "";
          this.setState({ error: `Queued message delivery is uncertain. ${String(recovery.count)} ${recovery.count === 1 ? "message was" : "messages were"} restored to the draft for explicit retry.${attachmentNotice}` });
        }
        return;
      }
      queue.sends.shift();
      this.dropNextQueuedSessionMessage(session.id);
    }
    this.readinessQueuedSends.delete(key);
  }

  private enqueuePendingSessionSend(session: ClientPendingStartSessionInfo, input: QueuedPendingSessionSendInput): void {
    const pending = this.pendingSessionStarts.get(session.id);
    if (pending === undefined || pending.discarded) {
      this.setState({ error: "The backend session is not ready for queued sends. Copy your message before discarding this failed start." });
      return;
    }
    const queued: QueuedPendingSessionSend = { ...input, id: `pending-send-${String(++this.pendingQueuedSendSeq)}` };
    pending.queuedSends.push(queued);
    if (isInitialPromptSend(queued)) this.setPendingSessionLaunchProjection(session.machineId, session.id, queued);
    const state = this.getState();
    const current = state.clientQueuedSessionMessages[session.id] ?? [];
    const activity = creatingPendingSessionActivity(session.id);
    this.setState({
      clientQueuedSessionMessages: { ...state.clientQueuedSessionMessages, [session.id]: [...current, queuedSessionMessagePreview(queued)] },
      sessionActivities: { ...state.sessionActivities, [session.id]: activity },
      activity: state.selectedSession?.id === session.id ? activity : state.activity,
      ...(state.selectedSession?.id === session.id ? { error: "" } : {}),
    });
  }

  private async flushQueuedPendingSends(session: SessionInfo, machineId: string, queuedSends: readonly QueuedPendingSessionSend[], destination?: SessionLaunchDestination): Promise<void> {
    for (const [index, queued] of queuedSends.entries()) {
      const delivered = await this.deliverQueuedPendingSend(session, machineId, queued);
      if (delivered) {
        if (isInitialPromptSend(queued)) {
          this.markPendingSessionLaunchInitialPreviewConsumed(machineId, session.id);
          if (this.isSelectedSessionIdentity(session.id, machineId)) {
            this.reconcilePendingSessionLaunchProjection(machineId, session.id, this.getState().messages, this.getState().messagePageStart);
          } else this.pendingSessionLaunchProjections.delete(machineSessionKey(machineId, session.id));
        }
        this.dropNextQueuedSessionMessage(session.id);
        continue;
      }
      if (!isInitialPromptSend(queued)) {
        this.dropQueuedSessionMessages(session.id, queuedSends.length - index);
        return;
      }
      if (destination === undefined) return;
      const stage = await this.reconcileInitialPromptDelivery(session, machineId, queued);
      if (stage === "accepted") {
        this.markCachedNewSessionPersisted(session);
        this.dropNextQueuedSessionMessage(session.id);
        this.clearInitialPromptRecoveryProjection(machineId, session.id);
        continue;
      }
      const recovery: SessionLaunchRecovery = {
        stage,
        sessionId: session.id,
        destination,
        retrying: false,
        ...(queuedPromptNeedsValidation(queued) ? { requiresPromptResourceValidation: true } : {}),
        ...recoverySubmissionProjection(queued),
      };
      this.sessionLaunchRecoveries.set(session.id, { recovery, queuedSends: queuedSends.slice(index), session });
      this.applyInitialPromptRecoveryActivity(recovery);
      return;
    }
  }

  private async reconcileInitialPromptDelivery(session: SessionInfo, machineId: string, queued: Extract<QueuedPendingSessionSend, { type: "prompt" | "promptResource" }>): Promise<"accepted" | "promptConfirmedUnsent" | "promptDeliveryAmbiguous"> {
    try {
      const [page, status] = await Promise.all([
        this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, machineId),
        this.api.status(session, machineId),
      ]);
      if (await queuedInitialPromptAccepted(page, queued)) return "accepted";
      return canonicalSessionIsBlankAndIdle(page, status) ? "promptConfirmedUnsent" : "promptDeliveryAmbiguous";
    } catch {
      return "promptDeliveryAmbiguous";
    }
  }

  private publishCreationFailedRecoveryQueue(sessionId: string, record: SessionLaunchRecoveryRecord): void {
    if (record.recovery.stage !== "creationFailed") return;
    const state = this.getState();
    const queuedMessages = record.queuedSends.map(queuedSessionMessagePreview);
    const activity = record.creationFailureMessage === undefined
      ? state.sessionActivities[sessionId]
      : failedPendingSessionActivity(sessionId, record.creationFailureMessage, record.queuedSends.length);
    this.setState({
      clientQueuedSessionMessages: queuedMessages.length === 0
        ? omitKey(state.clientQueuedSessionMessages, sessionId)
        : { ...state.clientQueuedSessionMessages, [sessionId]: queuedMessages },
      ...(activity === undefined ? {} : {
        sessionActivities: { ...state.sessionActivities, [sessionId]: activity },
        ...(state.selectedSession?.id === sessionId ? { activity } : {}),
      }),
    });
  }

  private applyInitialPromptRecoveryActivity(recovery: SessionLaunchRecovery): void {
    const activity = failedInitialPromptActivity(recovery.sessionId, recovery.stage);
    const state = this.getState();
    this.setState({
      sessionActivities: { ...state.sessionActivities, [recovery.sessionId]: activity },
      activity: state.selectedSession?.id === recovery.sessionId ? activity : state.activity,
      error: recovery.stage === "promptConfirmedUnsent"
        ? recovery.requiresPromptResourceValidation === true
          ? "The first prompt resource needs validation before it can be sent again."
          : "The first prompt was not sent. You can retry it."
        : "The first prompt may have been accepted. Inspect the transcript before you send it again.",
    });
  }

  private async deliverQueuedPendingSend(session: SessionInfo, machineId: string, queued: QueuedPendingSessionSend): Promise<boolean> {
    if (queued.type === "prompt") return this.deliverPromptToSession(session, queued.text, queued.streamingBehavior, queued.attachments, queued.delivery, machineId, { markSending: true, recordDelivery: (delivery) => { queued.deliveredText = delivery.text; } });
    if (queued.type === "promptResource") return this.deliverPromptResourceToSession(session, queued.text, queued.identity, queued.streamingBehavior, queued.attachments, queued.delivery, machineId, { markSending: true, recordDelivery: (delivery) => { queued.deliveredText = delivery.text; queued.deliveryReceipt = delivery.receipt; } });
    if (queued.type === "shell") return this.deliverShellToSession(session, queued.text, machineId, { optimisticLine: true });
    return this.deliverCommandToSession(session, queued.text, machineId, { applyResult: true });
  }

  private async deliverPromptToSession(session: SessionInfo, text: string, streamingBehavior: "steer" | "followUp" | undefined, attachments: PromptAttachment[] | undefined, delivery: PromptAttachmentDelivery, machineId: string, options: { markSending: boolean; recordDelivery?: ((delivery: { text: string }) => void) | undefined }): Promise<boolean> {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (options.markSending) this.markSendingPrompt(session.id, true);
    try {
      if (hasAttachments && delivery === "folder") {
        const saved = await this.api.saveAttachments(session, attachments, machineId);
        const body = appendSavedAttachmentReferences(text, saved.map((file) => file.path));
        options.recordDelivery?.({ text: body });
        await this.api.prompt(session, body, streamingBehavior, machineId);
      } else {
        options.recordDelivery?.({ text });
        await this.api.prompt(session, text, streamingBehavior, machineId, attachments);
      }
      this.markCachedNewSessionPersisted(session);
      return true;
    } catch (error) {
      this.setState({ error: String(error) });
      return false;
    } finally {
      if (options.markSending) this.markSendingPrompt(session.id, false);
    }
  }

  private async deliverPromptResourceToSession(session: SessionInfo, text: string, identity: PromptResourceCommandIdentity, streamingBehavior: "steer" | "followUp" | undefined, attachments: PromptAttachment[] | undefined, delivery: PromptAttachmentDelivery, machineId: string, options: { markSending: boolean; recordDelivery?: ((delivery: { text: string; receipt: string }) => void) | undefined }): Promise<boolean> {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (options.markSending) this.markSendingPrompt(session.id, true);
    try {
      if (hasAttachments && delivery === "folder") {
        const saved = await this.api.saveAttachments(session, attachments, machineId);
        const body = appendSavedAttachmentReferences(text, saved.map((file) => file.path));
        const response = await this.api.runPromptResourceCommand(session, body, identity, streamingBehavior, machineId);
        options.recordDelivery?.({ text: body, receipt: response.deliveryFingerprint });
      } else {
        const response = await this.api.runPromptResourceCommand(session, text, identity, streamingBehavior, machineId, attachments);
        options.recordDelivery?.({ text, receipt: response.deliveryFingerprint });
      }
      this.markCachedNewSessionPersisted(session);
      return true;
    } catch (error) {
      this.setState({ error: String(error) });
      return false;
    } finally {
      if (options.markSending) this.markSendingPrompt(session.id, false);
    }
  }

  private async deliverShellToSession(session: SessionInfo, text: string, machineId: string, options: { optimisticLine: boolean }): Promise<boolean> {
    if (options.optimisticLine && this.getState().selectedSession?.id === session.id) {
      this.setState({ messages: [...this.getState().messages, textMessage("user", text)] });
    }
    try {
      await this.api.shell(session, text, machineId);
      this.markCachedNewSessionPersisted(session);
      return true;
    } catch (error) {
      if (this.getState().selectedSession?.id === session.id) this.setState({ messages: [...this.getState().messages, textMessage("system", String(error))] });
      this.setState({ error: String(error) });
      return false;
    }
  }

  private async deliverCommandToSession(session: SessionInfo, text: string, machineId: string, options: { applyResult: boolean; streamingBehavior?: "steer" | "followUp" }): Promise<boolean> {
    // Commands are not inserted into the transcript optimistically: a builtin
    // command produces its own result line, and a runtime/skill command is
    // forwarded to the agent, which streams back the canonical (expanded)
    // message. Inserting the raw text here would leave a line that doesn't
    // converge with server history and disappears on reload. Surface the same
    // per-session sending indicator that send() uses for the pre-receipt window.
    this.markSendingPrompt(session.id, true);
    try {
      const result = await this.api.runCommand(session, text, machineId, options.streamingBehavior);
      if (options.applyResult && this.isSelectedSessionIdentity(session.id, machineId)) this.applyCommandResult(result);
      else if (result.type === "select" || result.type === "tree") this.setState({ error: `Queued command “${text}” needs input; open the session and run it again.` });
      this.markCachedNewSessionPersisted(session);
      return true;
    } catch (error) {
      if (this.getState().selectedSession?.id === session.id) this.setState({ messages: [...this.getState().messages, textMessage("system", String(error))] });
      this.setState({ error: String(error) });
      return false;
    } finally {
      this.markSendingPrompt(session.id, false);
    }
  }

  private dropNextQueuedSessionMessage(sessionId: string): void {
    this.dropQueuedSessionMessages(sessionId, 1);
  }

  private dropQueuedSessionMessages(sessionId: string, count: number): void {
    const state = this.getState();
    const current = state.clientQueuedSessionMessages[sessionId] ?? [];
    if (current.length === 0) return;
    const remaining = current.slice(count);
    this.setState({ clientQueuedSessionMessages: remaining.length === 0 ? omitKey(state.clientQueuedSessionMessages, sessionId) : { ...state.clientQueuedSessionMessages, [sessionId]: remaining } });
  }

  async respondToCommand(requestId: string, value: string) {
    const session = this.getState().selectedSession;
    if (!session) return;
    this.setState({ commandDialog: undefined });
    try {
      this.applyCommandResult(await this.api.respondToCommand(session, requestId, value, selectedMachineId(this.getState())));
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  cancelCommand() {
    this.setState({ commandDialog: undefined });
  }

  async navigateTree(targetId: string, summary: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const state = this.getState();
    const session = state.selectedSession;
    const tree = state.treeDialog;
    if (session === undefined || tree === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) {
      throw new Error("The session tree navigator is no longer available");
    }

    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    const cacheKey = machineSessionKey(machineId, session.id);
    let result: SessionTreeNavigateResult;
    try {
      result = await this.api.navigateTree(session, { targetId, expectedLeafId: tree.activeLeafId, summary }, machineId);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
      throw error;
    }

    if (result.cancelled) return result;

    const editorText = result.editorText ?? "";
    saveDraft(cacheKey, editorText);
    this.transcripts.discard(cacheKey);

    // A user can reselect the same session while the request is in flight. Its
    // sequence changes, but the server mutation still belongs to the selected
    // identity and requires a fresh authoritative branch read.
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;
    this.clearPendingUpdates();
    let authoritativeRefreshFailure: { error: unknown } | undefined;
    try {
      await this.selectSession(session, { updateUrl: false, preserveTreeDialog: true, propagateRefreshError: true });
    } catch (error) {
      authoritativeRefreshFailure = { error };
    }
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;

    try {
      await this.replacePromptEditorText?.({ machineId, sessionId: session.id, text: editorText });
    } catch (error) {
      if (this.isSelectedSessionIdentity(session.id, machineId)) this.setState({ error: String(error) });
      throw error;
    }
    if (authoritativeRefreshFailure !== undefined) {
      if (this.isSelectedSessionIdentity(session.id, machineId)) this.setState({ error: String(authoritativeRefreshFailure.error) });
      throw authoritativeRefreshFailure.error;
    }
    if (this.isSelectedSessionIdentity(session.id, machineId) && this.getState().treeDialog === tree) this.setState({ treeDialog: undefined });
    return result;
  }

  async forkFromTree(entryId: string): Promise<SessionTreeForkResult> {
    const state = this.getState();
    const session = state.selectedSession;
    const tree = state.treeDialog;
    if (session === undefined || tree === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) {
      throw new Error("The session tree navigator is no longer available");
    }

    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    const originalCacheKey = machineSessionKey(machineId, session.id);
    let result: SessionTreeForkResult;
    try {
      result = await this.api.forkTree(session, { entryId, expectedLeafId: tree.activeLeafId }, machineId);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
      throw error;
    }

    if (result.cancelled) return result;

    const forked = result.session;
    // The draft belongs to the forked session file; the original keeps its own.
    if (result.promptDraft !== undefined) saveDraft(machineSessionKey(machineId, forked.id), result.promptDraft);
    // The daemon replaced the runtime behind the original session identity with
    // the fork while the request was in flight, so any cached projection of the
    // original transcript is suspect; drop it so a later reselection reads the
    // untouched original file authoritatively.
    this.transcripts.discard(originalCacheKey);

    // The fork happened regardless, but the list/selection update belongs to
    // whoever owns the selection now; a changed selection may already reflect it.
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;
    const sessions = [forked, ...this.getState().sessions.filter((candidate) => candidate.id !== forked.id)];
    this.setState({ sessions, treeDialog: undefined });
    void this.selectSession(forked);
    return result;
  }

  async abortTreeNavigation(): Promise<void> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || state.treeDialog === undefined || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      await this.api.abort(session, machineId);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
      throw error;
    }
  }

  closeTreeDialog(): void {
    this.setState({ treeDialog: undefined });
  }

  applySessionStatus(status: SessionStatus): void {
    this.applyStatus(status);
  }

  async archiveSession(session = this.getState().selectedSession) {
    if (!session) return;
    const machineId = selectedMachineId(this.getState());
    try {
      const archivedAt = await this.archiveSessionCore(session);
      if (archivedAt !== undefined) this.inbox?.notifyArchived(machineId, session.id, archivedAt);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  /**
   * Replace a session's promoted-tab set. Applied optimistically so the band
   * responds instantly; a rejected write restores the previous set and the
   * server broadcast keeps every other client converged.
   */
  async setSessionTabs(session: SessionInfo, tabs: readonly string[]): Promise<void> {
    const previous = session.tabs ?? [];
    this.applySessionTabs(session.id, [...tabs]);
    try {
      await this.api.setTabs(session, tabs, selectedMachineId(this.getState()));
    } catch (error) {
      this.applySessionTabs(session.id, previous);
      this.setState({ error: String(error) });
    }
  }

  /** Pin or unpin a session. The server broadcasts `session.pinned`, so other
   * clients follow; this client applies the flag immediately. */
  async setSessionPinned(session: SessionInfo, pinned: boolean): Promise<void> {
    if (session.archived === true) return;
    try {
      if (pinned) await this.api.pin(session, selectedMachineId(this.getState()));
      else await this.api.unpin(session, selectedMachineId(this.getState()));
      this.applySessionPinned(session.id, pinned);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async archiveSessionWithDescendants(session = this.getState().selectedSession) {
    if (session === undefined || !isArchivableSessionInfo(session, this.statusForSession(session))) return;
    const machineId = selectedMachineId(this.getState());
    try {
      const response = await this.api.archiveWithDescendants(session, machineId);
      const archivedIds = response.sessionIds !== undefined && response.sessionIds.length > 0 ? response.sessionIds : [session.id];
      this.clearSessionLaunchRecoveryLifecycleState(archivedIds, machineId);
      const archivedAt = new Date().toISOString();
      const state = this.getState();
      const sessions = markSessionsArchived(state.sessions, archivedIds, archivedAt);
      const selectionChange = selectionAfterArchivingSessions(sessions, state.selectedSession?.id, archivedIds);
      this.setState({ sessions });
      this.inbox?.notifyBulkArchived(machineId, archivedIds, archivedAt);

      if (selectionChange.type === "select") await this.selectSession(selectionChange.session);
      else if (selectionChange.type === "clear") this.deselectSession({ forgetRememberedSelection: true });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async archiveSessions(sessions: readonly SessionInfo[]): Promise<void> {
    const candidates = uniqueSessionsById(sessions).filter((session) => isArchivableSessionInfo(session, this.statusForSession(session)));
    if (candidates.length === 0) return;

    try {
      const machineId = selectedMachineId(this.getState());
      const { succeededIds: archivedIds, failures, generatedAt } = await this.archiveSessionBatch(candidates, machineId);
      if (archivedIds.length > 0) {
        this.clearSessionLaunchRecoveryLifecycleState(archivedIds, machineId);
        const archivedAt = generatedAt ?? new Date().toISOString();
        const state = this.getState();
        const nextSessions = markSessionsArchived(state.sessions, archivedIds, archivedAt);
        const selectionChange = selectionAfterArchivingSessions(nextSessions, state.selectedSession?.id, archivedIds);
        this.setState({ sessions: nextSessions });
        this.inbox?.notifyBulkArchived(machineId, archivedIds, archivedAt);

        if (selectionChange.type === "select") await this.selectSession(selectionChange.session);
        else if (selectionChange.type === "clear") this.deselectSession({ forgetRememberedSelection: true });
      }
      this.applyBulkSessionFailures("Archive", failures);
    } catch (error) {
      this.setState({ error: `Archive failed: ${errorMessage(error)}` });
    }
  }

  async deleteArchivedSessions(sessions: readonly SessionInfo[]): Promise<void> {
    const candidates = uniqueSessionsById(sessions).filter((session) => session.archived === true);
    if (candidates.length === 0) return;

    const machineId = selectedMachineId(this.getState());
    try {
      const { succeededIds: deletedIds, failures } = await this.deleteArchivedSessionBatch(candidates, machineId);
      if (deletedIds.length > 0) {
        this.clearSessionLaunchRecoveryLifecycleState(deletedIds, machineId);
        const deletedIdSet = new Set(deletedIds);
        const state = this.getState();
        const nextSessions = state.sessions.filter((session) => !deletedIdSet.has(session.id));
        this.setState({ sessions: nextSessions });
        this.inbox?.notifyDeleted(machineId, deletedIds);
        if (state.selectedSession !== undefined && deletedIdSet.has(state.selectedSession.id)) {
          const next = nextSessions.find((session) => session.archived !== true) ?? nextSessions[0];
          if (next !== undefined) await this.selectSession(next);
          else this.deselectSession({ forgetRememberedSelection: true });
        }
      }
      this.applyBulkSessionFailures("Delete", failures);
    } catch (error) {
      this.setState({ error: `Delete failed: ${errorMessage(error)}` });
    }
  }

  private async archiveSessionBatch(sessions: readonly SessionInfo[], machineId: string): Promise<BulkSessionMutationResult> {
    const response = await this.api.archiveMany(sessions, machineId);
    return { succeededIds: response.archivedSessionIds, failures: bulkFailureMessages(response.failures), generatedAt: response.generatedAt };
  }

  private async deleteArchivedSessionBatch(sessions: readonly SessionInfo[], machineId: string): Promise<BulkSessionMutationResult> {
    const response = await this.api.deleteArchivedMany(sessions, machineId);
    return { succeededIds: response.deletedSessionIds, failures: bulkFailureMessages(response.failures) };
  }

  async applySessionCleanupResult(result: SessionCleanupExecuteResponse, machineId = selectedMachineId(this.getState())): Promise<void> {
    const archivedIds = result.archivedSessionIds;
    const deletedIds = result.deletedSessionIds;
    const affectedIds = [...archivedIds, ...deletedIds];
    this.clearSessionLaunchRecoveryLifecycleState(affectedIds, machineId);
    if (selectedMachineId(this.getState()) !== machineId) return;
    if (affectedIds.length > 0) {
      const state = this.getState();
      const deletedIdSet = new Set(deletedIds);
      const nextSessions = markSessionsArchived(state.sessions, archivedIds, result.generatedAt).filter((session) => !deletedIdSet.has(session.id));
      const selectedAffected = state.selectedSession !== undefined && affectedIds.includes(state.selectedSession.id);
      const selectedActivityAffected = state.activity !== undefined && affectedIds.includes(state.activity.sessionId);
      this.setState({
        sessions: nextSessions,
        sessionStatuses: omitKeys(state.sessionStatuses, affectedIds),
        sessionActivities: omitKeys(state.sessionActivities, affectedIds),
        ...(selectedAffected ? { status: undefined, pendingAsk: undefined, pendingDialogs: [], closedDialogs: [] } : {}),
        ...(selectedActivityAffected ? { activity: undefined } : {}),
      });
      if (archivedIds.length > 0) this.inbox?.notifyBulkArchived(machineId, archivedIds, result.generatedAt);
      if (deletedIds.length > 0) this.inbox?.notifyDeleted(machineId, deletedIds);

      if (state.selectedSession !== undefined && deletedIdSet.has(state.selectedSession.id)) {
        const next = nextSessions.find((session) => session.archived !== true) ?? nextSessions[0];
        if (next !== undefined) await this.selectSession(next);
        else this.deselectSession({ forgetRememberedSelection: true });
      } else {
        const selectionChange = selectionAfterArchivingSessions(nextSessions, state.selectedSession?.id, archivedIds);
        if (selectionChange.type === "select") await this.selectSession(selectionChange.session);
        else if (selectionChange.type === "clear") this.deselectSession({ forgetRememberedSelection: true });
      }
    }
    await this.refreshCurrentWorkspaceSessions(machineId);
  }

  async refreshCurrentWorkspaceSessions(machineId = selectedMachineId(this.getState())): Promise<void> {
    const workspace = this.getState().selectedWorkspace;
    if (workspace === undefined) return;
    try {
      const listedSessions = mergeCachedNewSessions(workspace.path, await this.api.sessions(workspace.path, machineId), machineId)
        .filter((session) => !this.isSuppressedCreatedSession(session, machineId));
      if (selectedMachineId(this.getState()) !== machineId || this.getState().selectedWorkspace?.id !== workspace.id) return;
      const sessions = this.mergePendingStartSessions(
        workspace.path,
        this.mergeCreationFailedSessionStarts(workspace.path, listedSessions, machineId),
        machineId,
      );
      const selectedSession = this.getState().selectedSession;
      this.setState({ sessions });
      if (selectedSession === undefined) return;
      const refreshedSelected = sessions.find((session) => session.id === selectedSession.id);
      if (refreshedSelected !== undefined) {
        if (refreshedSelected !== selectedSession) this.setState({ selectedSession: refreshedSelected });
        return;
      }
      const next = sessions.find((session) => session.archived !== true) ?? sessions[0];
      if (next !== undefined) await this.selectSession(next);
      else this.deselectSession({ forgetRememberedSelection: true });
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId && this.getState().selectedWorkspace?.id === workspace.id) this.setState({ error: String(error) });
    }
  }

  async deleteCachedNewSession(session = this.getState().selectedSession) {
    if (session === undefined || !isTransientNewSessionInfo(session, this.statusForSession(session))) return;
    const machineId = selectedMachineId(this.getState());
    const pendingStart = isClientPendingStartSessionInfo(session) ? this.pendingSessionStarts.get(session.id) : undefined;
    if (pendingStart !== undefined) {
      pendingStart.discarded = true;
      pendingStart.queuedSends = [];
      this.pendingSessionLaunchProjections.delete(machineSessionKey(machineId, session.id));
    }
    else {
      void this.api.stop(session, machineId).catch(() => {
        // Best-effort cleanup for transient sessions that may not exist server-side anymore.
      });
    }
    this.clearSessionLaunchRecoveryLifecycleState([session.id], machineId);
    forgetCachedNewSession(session.id, machineId);
    clearDraft(this.sessionCacheKey(session.id));
    const state = this.getState();
    const sessions = state.sessions.filter((candidate) => candidate.id !== session.id);
    this.setState({
      sessions,
      sessionStatuses: omitKey(state.sessionStatuses, session.id),
      sessionActivities: omitSessionActivity(state.sessionActivities, session.id),
      sendingPrompts: omitKey(state.sendingPrompts, session.id),
      clientQueuedSessionMessages: omitKey(state.clientQueuedSessionMessages, session.id),
    });
    this.inbox?.notifyDeleted(machineId, [session.id]);
    if (this.getState().selectedSession?.id !== session.id) return;
    const next = sessions.find((candidate) => candidate.archived !== true) ?? sessions[0];
    if (next !== undefined) await this.selectSession(next);
    else {
      this.clearActiveSession();
      this.updateUrl();
    }
  }

  async restoreSession(session = this.getState().selectedSession) {
    if (!session) return;
    try {
      await this.restoreSessionCore(session);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  /**
   * Archive a session, propagating API errors to the caller.
   *
   * Intentionally does NOT notify the inbox bridge — callers that route
   * through {@link SessionInboxController.archiveWithUndo} rely on that
   * controller notifying the global store itself after this method returns,
   * so invoking the bridge here would produce a duplicate notification.
   *
   * Use {@link archiveSession} for direct (non-inbox) archive paths where
   * the bridge should be notified by the caller.
   */
  async archiveSessionThrowing(session: SessionInfo): Promise<void> {
    const archivedAt = await this.archiveSessionCore(session);
    if (archivedAt === undefined) throw new Error("Session cannot be archived");
    // inbox?.notifyArchived intentionally omitted: archiveWithUndo calls
    // notifyArchived itself after this method returns.
  }

  /**
   * Restore a session from the archive. Propagates API errors to the caller.
   *
   * Designed for injection into {@link SessionInboxController.undoArchive},
   * which needs error propagation to detect "Session not found" and surface
   * a user-readable message.
   */
  async restoreSessionThrowing(session: SessionInfo): Promise<void> {
    await this.restoreSessionCore(session);
  }

  async reloadSession(session = this.getState().selectedSession) {
    if (session === undefined || !isArchivableSessionInfo(session, this.statusForSession(session))) return;
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.reloadSession(session, machineId);
      this.transcripts.discard(this.sessionCacheKey(session.id));
      if (this.getState().selectedSession?.id === session.id) {
        await this.selectSession(session, { updateUrl: false });
      }
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async detachParent(session = this.getState().selectedSession) {
    if (session?.parentSessionPath === undefined) return;
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.detachParent(session, machineId);
      const detached = { ...session };
      delete detached.parentSessionPath;
      this.replaceSession(detached);
      this.inbox?.notifySessionUpdated(machineId, detached);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async listModels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return [];
    try {
      return (await this.api.models(session, selectedMachineId(this.getState()))).models;
    } catch (error) {
      this.setState({ error: String(error) });
      return [];
    }
  }

  async setModel(provider: string, modelId: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    try {
      this.applyStatus(await this.api.setModel(session, provider, modelId, selectedMachineId(this.getState())));
      await this.refreshAvailableThinkingLevels();
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async cycleModel(direction: "forward" | "backward") {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    try {
      this.applyStatus(await this.api.cycleModel(session, direction, selectedMachineId(this.getState())));
      await this.refreshAvailableThinkingLevels();
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async listThinkingLevels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return [];
    try {
      return (await this.api.thinkingLevels(session, selectedMachineId(this.getState()))).levels;
    } catch (error) {
      this.setState({ error: String(error) });
      return [];
    }
  }

  /** Refresh the available thinking levels for the selected session's model. */
  async refreshAvailableThinkingLevels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) {
      if (this.getState().availableThinkingLevels.length > 0) this.setState({ availableThinkingLevels: [] });
      return;
    }
    const levels = await this.listThinkingLevels();
    if (this.getState().selectedSession?.id !== session.id) return;
    this.setState({ availableThinkingLevels: levels });
  }

  async setThinkingLevel(level: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    try {
      this.applyStatus(await this.api.setThinkingLevel(session, level, selectedMachineId(this.getState())));
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async cycleThinkingLevel() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    try {
      this.applyStatus(await this.api.cycleThinkingLevel(session, selectedMachineId(this.getState())));
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  async clearServerQueue() {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const status = await this.api.clearQueue(session, machineId);
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.applyStatus(status);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
    }
  }

  async dismissWarning(dismissId: string) {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const status = await this.api.dismissWarning(session, dismissId, machineId);
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.applyStatus(status);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
    }
  }

  /** Send the answers the user entered for the session's open ask. */
  submitAsk(askId: string, submission: AskDraftSubmission): Promise<void> {
    return this.closeOpenAsk(askId, async (session, machineId) => {
      const prepared = await this.prepareAskSubmission(session, machineId, submission);
      return this.api.submitAsk(session, askId, prepared, machineId);
    });
  }

  private async prepareAskSubmission(session: SessionInfo, machineId: string, submission: AskDraftSubmission): Promise<AskUserSubmission> {
    const attachments = submission.answers.flatMap((answer) => answer.attachments ?? []);
    if (attachments.length > MAX_PROMPT_ATTACHMENTS) throw new Error(`Ask answers can include up to ${String(MAX_PROMPT_ATTACHMENTS)} files`);
    this.validateAskSubmissionTextBudgets(submission);
    const saved = attachments.length === 0 ? [] : await this.api.saveAttachments(session, attachments, machineId);
    if (saved.length !== attachments.length) throw new Error("Attachment save returned an unexpected file count");

    const answers: AskUserSubmission["answers"] = [];
    let savedOffset = 0;
    for (const answer of submission.answers) {
      const { attachments: answerAttachments, ...wireAnswer } = answer;
      const attachmentCount = answerAttachments?.length ?? 0;
      const text = wireAnswer.otherText?.trim() ?? "";
      if (attachmentCount === 0) {
        if (text.length > ASK_USER_OTHER_TEXT_MAX_LENGTH) throw new Error(`Custom answer exceeds the ${ASK_USER_OTHER_TEXT_MAX_LENGTH.toLocaleString()}-character limit`);
        answers.push({ ...wireAnswer, ...(wireAnswer.otherText === undefined ? {} : { otherText: text }) });
        continue;
      }
      const paths = saved.slice(savedOffset, savedOffset + attachmentCount).map((file) => file.path);
      savedOffset += attachmentCount;
      const references = appendSavedAttachmentReferences("", paths);
      if (references.length > ASK_USER_OTHER_TEXT_MAX_LENGTH) throw new Error("Attached file references exceed the custom answer limit");
      const separatorLength = text === "" ? 0 : 2;
      const textBudget = ASK_USER_OTHER_TEXT_MAX_LENGTH - references.length - separatorLength;
      if (text.length > textBudget) throw new Error(`Custom answer and attached file references exceed the ${ASK_USER_OTHER_TEXT_MAX_LENGTH.toLocaleString()}-character limit`);
      answers.push({ ...wireAnswer, otherText: appendSavedAttachmentReferences(text, paths) });
    }
    return { answers };
  }

  private validateAskSubmissionTextBudgets(submission: AskDraftSubmission): void {
    for (const answer of submission.answers) {
      const attachmentCount = answer.attachments?.length ?? 0;
      const text = answer.otherText?.trim() ?? "";
      const referencesLength = maximumSavedAttachmentReferencesLength(attachmentCount);
      const separatorLength = text === "" || attachmentCount === 0 ? 0 : 2;
      const textBudget = ASK_USER_OTHER_TEXT_MAX_LENGTH - referencesLength - separatorLength;
      if (text.length > textBudget) {
        const message = attachmentCount === 0
          ? `Custom answer exceeds the ${ASK_USER_OTHER_TEXT_MAX_LENGTH.toLocaleString()}-character limit`
          : `Custom answer and attached file references exceed the ${ASK_USER_OTHER_TEXT_MAX_LENGTH.toLocaleString()}-character limit`;
        throw new Error(message);
      }
    }
  }

  /** Close the session's open ask without answering it. */
  cancelAsk(askId: string): Promise<void> {
    return this.closeOpenAsk(askId, (session, machineId) => this.api.cancelAsk(session, askId, machineId));
  }

  /** Send the value the user gave for one of the session's open extension dialogs. */
  answerDialog(dialogId: string, value: ExtensionDialogAnswer): Promise<void> {
    return this.closeOpenDialog(dialogId, (session, machineId) => this.api.answerDialog(session, dialogId, value, machineId));
  }

  /** Close one of the session's open extension dialogs without answering it. */
  cancelDialog(dialogId: string): Promise<void> {
    return this.closeOpenDialog(dialogId, (session, machineId) => this.api.cancelDialog(session, dialogId, machineId));
  }

  private async closeOpenDialog(dialogId: string, close: (session: SessionInfo, machineId: string) => Promise<ExtensionDialogCloseResponse>): Promise<void> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true) return;
    if (isClientPendingStartSessionInfo(session)) {
      await this.closePendingStartDialog(session, dialogId, close);
      return;
    }
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const response = await close(session, machineId);
      if (!this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) return;
      // When this call closed the dialog, its outcome is recorded right away so
      // the card shows what the user gave; the daemon's dialog.closed event
      // then finds the dialog already closed here and stays a no-op.
      const outcome: ExtensionDialogOutcome | undefined = response.outcome;
      if (outcome !== undefined) {
        const dialog = this.getState().pendingDialogs.find((pending) => pending.dialogId === outcome.dialogId);
        if (dialog !== undefined) this.recordClosedDialog({ dialog, reason: outcome.reason, ...(outcome.answer === undefined ? {} : { answer: outcome.answer }) });
      }
      // Both outcomes carry the recomputed status, so no follow-up status
      // request is needed to learn what the session's open dialogs are now.
      this.applyStatus(response.sessionStatus);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
    }
  }

  /**
   * Answer or cancel a `session_start` dialog from the startup view. The row
   * is still the pending start, but the dialog belongs to the constructing
   * backend session the startup events named, so the close goes out under the
   * real id — the only route the daemon can serve before readiness.
   */
  private async closePendingStartDialog(session: ClientPendingStartSessionInfo, dialogId: string, close: (session: SessionInfo, machineId: string) => Promise<ExtensionDialogCloseResponse>): Promise<void> {
    const pending = this.pendingSessionStarts.get(session.id);
    const backendSessionId = pending?.backendSessionId;
    // Without the real id there is no route to answer through — and no way a
    // dialog card could be on screen yet either.
    if (pending === undefined || backendSessionId === undefined) return;
    const selectionSeq = this.selectionSeq;
    try {
      const response = await close({ ...session, id: backendSessionId }, pending.machineId);
      if (selectionSeq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) return;
      // Same outcome-first ordering as the ready-session path: the card shows
      // what the user gave, and the daemon's dialog.closed frame then finds
      // the dialog already closed here and stays a no-op.
      const outcome: ExtensionDialogOutcome | undefined = response.outcome;
      if (outcome !== undefined) {
        const dialog = this.getState().pendingDialogs.find((candidate) => candidate.dialogId === outcome.dialogId);
        if (dialog !== undefined) this.recordClosedDialog({ dialog, reason: outcome.reason, ...(outcome.answer === undefined ? {} : { answer: outcome.answer }) });
      }
      this.applyPendingStartStatus(pending, response.sessionStatus);
    } catch (error) {
      if (selectionSeq === this.selectionSeq && this.getState().selectedSession?.id === session.id) this.setState({ error: String(error) });
    }
  }

  private async closeOpenAsk(askId: string, close: (session: SessionInfo, machineId: string) => Promise<AskUserCloseResponse>): Promise<void> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const response = await close(session, machineId);
      // The ask is gone either way: this call closed it, or it was already
      // closed elsewhere. Its draft has nothing left to protect, and the answers
      // now live in the daemon-owned outcome.
      clearAskDraft(machineSessionKey(machineId, session.id), askId);
      // Both outcomes carry the recomputed status, so no follow-up status
      // request is needed to learn what the session's open ask is now.
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.applyStatus(response.sessionStatus);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
    }
  }

  async stopActiveWork() {
    const state = this.getState();
    const session = state.selectedSession;
    if (!session) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const result = await this.api.abort(session, machineId);
      const text = result.restoredMessages.map((message) => message.text).join("\n\n");
      if (text === "") return;
      const cacheKey = machineSessionKey(machineId, session.id);
      const restoredDraft = [text, loadDraft(cacheKey)].filter((part) => part.trim() !== "").join("\n\n");
      saveDraft(cacheKey, restoredDraft);
      if (!this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) return;
      if (this.replacePromptEditorText === undefined) throw new Error("Queued messages could not be restored to the prompt editor");
      const restored = await this.replacePromptEditorText({ machineId, sessionId: session.id, text: restoredDraft });
      if (restored === false) throw new Error("Queued messages could not be restored to the prompt editor");
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.setState({ error: String(error) });
    }
  }

  refreshSelectedSession(sessionId = this.getState().selectedSession?.id): Promise<void> {
    const session = this.getState().selectedSession;
    if (sessionId === undefined || session?.id !== sessionId || session.archived === true || isClientPendingStartSessionInfo(session)) return Promise.resolve();
    const target: SelectedSessionRefreshTarget = {
      session,
      machineId: selectedMachineId(this.getState()),
      selectionSeq: this.selectionSeq,
    };
    return this.requestSelectedSessionRefresh(target).catch((error: unknown) => {
      if (this.isCurrentRefreshTarget(target)) {
        const selectedTarget = selectedChatTarget(target.machineId, target.session);
        const failure = this.recoverReadinessFailure(target.session, target.machineId, error);
        this.setState({ selectedChatLoad: selectedChatFailed(selectedTarget, this.currentSelectedChatReadability(selectedTarget), failure), error: failure });
      }
    });
  }

  private requestSelectedSessionRefresh(target: SelectedSessionRefreshTarget): Promise<void> {
    const key = machineSessionKey(target.machineId, target.session.id);
    return this.selectedSessionRefreshes.request(key, async () => {
      if (!this.isCurrentRefreshTarget(target)) return;
      this.flushPendingUpdates();
      const selectedTarget = selectedChatTarget(target.machineId, target.session);
      const transcriptRevision = this.transcriptRevision;
      this.transcripts.cancelCooperativeMerges();
      this.markSelectedChatRefreshing(selectedTarget);
      const statusPromise = this.api.status(target.session, target.machineId);
      const streamSnapshotPromise = this.api.streamSnapshot(target.session, target.machineId);
      const previewRequest = this.transcriptPreviewRequests.get(key);
      if (previewRequest !== undefined && this.currentSelectedChatReadability(selectedTarget) === "absent") {
        void previewRequest.then((page) => {
          if (!this.isCurrentRefreshTarget(target) || this.currentSelectedChatReadability(selectedTarget) !== "absent") return;
          const preview = transcriptViewFromHistory(page);
          this.reconcilePendingSessionLaunchProjection(target.machineId, target.session.id, preview.messages, preview.messagePageStart);
          this.setState({ ...preview, selectedChatLoad: selectedChatPreviewReadable(selectedTarget), isLoadingEarlierMessages: false });
        }).catch(() => undefined);
      }
      const historyPromise = previewRequest === undefined
        ? this.api.messages(target.session, { limit: MESSAGE_PAGE_SIZE }, target.machineId)
        : Promise.race([previewRequest.catch(() => undefined), nextTask()]).then(() => this.api.messages(target.session, { limit: MESSAGE_PAGE_SIZE }, target.machineId));
      void this.notifications?.refreshSelectedSession(target.session, target.machineId).catch(() => undefined);

      const historyViewPromise = historyPromise.then(async (page) => {
        if (!this.isCurrentRefreshTarget(target)) return undefined;
        const merge = await this.transcripts.mergeHistoryCooperatively(key, page);
        if (merge.kind === "superseded" || !this.isCurrentRefreshTarget(target)) return undefined;
        this.flushPendingUpdates();
        const history = transcriptRevision === this.transcriptRevision ? merge.view : this.currentTranscriptView();
        this.reconcilePendingSessionLaunchProjection(target.machineId, target.session.id, history.messages, history.messagePageStart);
        this.setState({ ...(history === merge.view ? merge.view : {}), selectedChatLoad: selectedChatFreshReadable(selectedTarget), isLoadingEarlierMessages: false });
        return { history, transcriptRevision, canonicalPage: page };
      });
      const statusResultPromise = statusPromise.then(
        (status) => ({ ok: true, status }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
      const streamSnapshotResultPromise = streamSnapshotPromise.then(
        (streamSnapshot) => ({ ok: true, streamSnapshot }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );

      const historyResult = await historyViewPromise;
      if (historyResult === undefined || !this.isCurrentRefreshTarget(target)) return;
      const [statusResult, streamSnapshotResult] = await Promise.all([statusResultPromise, streamSnapshotResultPromise]);
      this.flushPendingUpdates();
      if (!streamSnapshotResult.ok) throw streamSnapshotResult.error;
      const { streamSnapshot } = streamSnapshotResult;
      // Seed the in-flight partial assistant message on top of committed history
      // and record the snapshot's sequence as the watermark. Buffered/live events
      // with `seq <= watermark` are already reflected here and are dropped by
      // `applyEvent`; later events (`seq > watermark`) stream in on top. The
      // partial is seeded into the in-memory transcript only, never the raw
      // history cache, so it never persists.
      const transcriptStayedCurrent = historyResult.transcriptRevision === this.transcriptRevision;
      const history = transcriptStayedCurrent ? historyResult.history : this.currentTranscriptView();
      this.liveMessagePageEnd = Math.max(this.liveMessagePageEnd, history.messagePageEnd);
      const latestTranscriptSeq = this.latestTranscriptSeq?.sessionId === target.session.id ? this.latestTranscriptSeq.seq : 0;
      const snapshotCoversLatestEvent = streamSnapshot.seq >= latestTranscriptSeq;
      const messages = transcriptStayedCurrent
        ? this.transcripts.seedStreamingPartial(history.messages, streamSnapshot.partial, this.liveMessagePageEnd)
        : snapshotCoversLatestEvent
          ? this.transcripts.reconcileStreamingPartial(history.messages, streamSnapshot.partial, this.liveMessagePageEnd)
          : history.messages;
      const watermarkSeq = Math.max(streamSnapshot.seq, latestTranscriptSeq);
      this.streamWatermark = { sessionId: target.session.id, seq: watermarkSeq };
      this.latestTranscriptSeq = { sessionId: target.session.id, seq: watermarkSeq };
      if (!statusResult.ok) {
        if (messages !== history.messages) this.setState({ ...history, messages });
        throw statusResult.error;
      }
      const { status } = statusResult;
      this.setState({
        ...history,
        messages,
        selectedChatLoad: selectedChatLiveReady(selectedTarget),
        status,
        activity: this.getState().sessionActivities[target.session.id],
      });
      this.applyStatus(status);
      if (previewRequest === undefined) {
        const rawHistory = this.transcripts.rawHistoryPage(key);
        if (transcriptStayedCurrent && rawHistory !== undefined && rawHistory.messages.length <= MESSAGE_PAGE_SIZE) this.transcripts.schedulePersist(key);
        this.transcriptPreviewRequests.delete(key);
      } else {
        const persistenceRevision = this.transcriptRevision;
        void previewRequest.then((previewPage) => {
          if (this.transcriptPreviewRequests.get(key) !== previewRequest) return;
          this.transcriptPreviewRequests.delete(key);
          const previewMatchesCanonical = previewPage.start === historyResult.canonicalPage.start && previewPage.total === historyResult.canonicalPage.total;
          if (previewMatchesCanonical && transcriptStayedCurrent && persistenceRevision === this.transcriptRevision && this.isCurrentRefreshTarget(target)) this.transcripts.schedulePersistedPage(key, previewPage);
        }).catch(() => {
          if (this.transcriptPreviewRequests.get(key) !== previewRequest) return;
          this.transcriptPreviewRequests.delete(key);
          if (transcriptStayedCurrent && persistenceRevision === this.transcriptRevision && this.isCurrentRefreshTarget(target)) this.transcripts.schedulePersist(key);
        });
      }
      await this.flushReadinessSends(target.session, target.machineId);
    });
  }

  private markSelectedChatRefreshing(target: SelectedChatTarget): void {
    const state = this.getState();
    if (state.selectedChatLoad.kind === "cached-readable" || state.selectedChatLoad.kind === "preview-readable" || state.selectedChatLoad.kind === "fresh-readable") return;
    if (state.selectedChatLoad.kind === "loading-without-content" || state.selectedChatLoad.kind === "loading-with-readable-history") return;
    const readability = this.currentSelectedChatReadability(target);
    this.setState({ selectedChatLoad: selectedChatLoading(target, readability) });
  }

  private currentSelectedChatReadability(target: SelectedChatTarget): SelectedChatReadability {
    const state = this.getState();
    if ("target" in state.selectedChatLoad && selectedChatTargetsEqual(state.selectedChatLoad.target, target)) {
      return selectedChatReadability(state.selectedChatLoad);
    }
    return this.transcripts.rawHistoryPage(machineSessionKey(target.machineId, target.sessionId)) === undefined ? "absent" : "cached";
  }

  private hasStreamWatermark(): boolean {
    return this.streamWatermark !== undefined;
  }

  private isCurrentRefreshTarget(target: SelectedSessionRefreshTarget): boolean {
    return this.isCurrentSessionSelection(target.session.id, target.machineId, target.selectionSeq);
  }

  private isCurrentSessionSelection(sessionId: string, machineId: string, selectionSeq: number): boolean {
    return selectionSeq === this.selectionSeq && this.isSelectedSessionIdentity(sessionId, machineId);
  }

  private currentTranscriptView(): ChatTranscriptView {
    const state = this.getState();
    return {
      messages: state.messages,
      messagePageStart: state.messagePageStart,
      messagePageEnd: state.messagePageEnd,
      messagePageTotal: state.messagePageTotal,
    };
  }

  private isSelectedSessionReference(session: Pick<SessionInfo, "id" | "cwd">, machineId: string): boolean {
    if (this.disposed) return false;
    const state = this.getState();
    return selectedMachineId(state) === machineId
      && state.selectedSession?.id === session.id
      && state.selectedSession.cwd === session.cwd;
  }

  private isSelectedSessionIdentity(sessionId: string, machineId: string): boolean {
    const selected = this.getState().selectedSession;
    return selected !== undefined
      && this.isSelectedSessionReference(selected, machineId)
      && selected.id === sessionId
      && selected.archived !== true
      && !isClientPendingStartSessionInfo(selected);
  }

  private applyBulkSessionFailures(action: string, failures: readonly string[]): void {
    if (failures.length === 0) return;
    this.setState({ error: `${action} failed for ${String(failures.length)} session${failures.length === 1 ? "" : "s"}: ${failures.join("; ")}` });
  }

  private clearSessionLaunchRecoveryLifecycleState(sessionIds: readonly string[], machineId: string): void {
    const affectedIds: string[] = [];
    for (const sessionId of new Set(sessionIds)) {
      let affected = this.pendingSessionLaunchProjections.delete(machineSessionKey(machineId, sessionId));
      const record = this.sessionLaunchRecoveries.get(sessionId);
      if (record?.recovery.destination.machineId === machineId) {
        this.sessionLaunchRecoveries.delete(sessionId);
        affected = true;
      }
      if (affected) affectedIds.push(sessionId);
    }
    if (affectedIds.length === 0) return;

    const state = this.getState();
    if (selectedMachineId(state) !== machineId) return;
    const clearsSelectedActivity = state.activity !== undefined && affectedIds.includes(state.activity.sessionId);
    this.setState({
      clientQueuedSessionMessages: omitKeys(state.clientQueuedSessionMessages, affectedIds),
      sessionActivities: omitKeys(state.sessionActivities, affectedIds),
      sendingPrompts: omitKeys(state.sendingPrompts, affectedIds),
      ...(clearsSelectedActivity ? { activity: undefined } : {}),
    });
  }

  /**
   * Core archive logic shared by archiveSession and archiveSessionThrowing.
   * Handles transient sessions, archivability checks, the API call, state
   * update, and selection-change navigation. Throws on API error.
   *
   * Returns the archivedAt ISO timestamp on a successful archive, or
   * undefined when no archive was performed (transient session deleted or
   * not archivable). Does NOT call inbox.notifyArchived — callers decide.
   */
  private async archiveSessionCore(session: SessionInfo): Promise<string | undefined> {
    const status = this.statusForSession(session);
    if (isTransientNewSessionInfo(session, status)) {
      await this.deleteCachedNewSession(session);
      return undefined;
    }
    if (!isArchivableSessionInfo(session, status)) return undefined;
    const machineId = selectedMachineId(this.getState());
    await this.api.archive(session, machineId);
    this.clearSessionLaunchRecoveryLifecycleState([session.id], machineId);
    const archivedAt = new Date().toISOString();
    const state = this.getState();
    // The server mutation belongs to the captured machine/workspace. Never
    // project its completion into a machine or workspace selected meanwhile.
    if (selectedMachineId(state) !== machineId || !optionalSessionPathEquals(state.selectedWorkspace?.path, session.cwd)) {
      return archivedAt;
    }
    const sessions = markSessionArchived(state.sessions, session.id, archivedAt);
    const selectedSessionId = state.selectedSession?.id === session.id
      && sessionPathsEqual(state.selectedSession.cwd, session.cwd)
      ? state.selectedSession.id
      : undefined;
    const selectionChange = selectionAfterArchivingSession(sessions, selectedSessionId, session.id);
    this.setState({ sessions });
    if (selectionChange.type === "select") await this.selectSession(selectionChange.session);
    else if (selectionChange.type === "clear") this.deselectSession({ forgetRememberedSelection: true });
    return archivedAt;
  }

  /**
   * Core restore logic shared by restoreSession and restoreSessionThrowing.
   * Handles the API call, state update, inbox notification, and re-selection
   * when the restored session is currently selected. Throws on API error.
   */
  private async restoreSessionCore(session: SessionInfo): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    await this.api.restore(session, machineId);
    if (selectedMachineId(this.getState()) !== machineId) return;
    const restored = { ...session };
    delete restored.archived;
    delete restored.archivedAt;
    if (optionalSessionPathEquals(this.getState().selectedWorkspace?.path, restored.cwd)) this.replaceSession(restored);
    this.inbox?.notifyRestored(machineId, restored);
    const selected = this.getState().selectedSession;
    if (selected?.id === restored.id && sessionPathsEqual(selected.cwd, restored.cwd)) await this.selectSession(restored);
  }

  private setPendingSessionLaunchProjection(machineId: string, sessionId: string, queued: FirstPromptQueuedSend): void {
    this.pendingSessionLaunchProjections.set(machineSessionKey(machineId, sessionId), {
      queued,
      message: pendingSessionLaunchChatMessage(queued),
      initialPreviewPending: true,
      canonicalMessage: undefined,
      receiptReconciliationPending: false,
      receiptReconciliationQueuedMessages: undefined,
      receiptCheckedTexts: new Set<string>(),
    });
  }

  private markPendingSessionLaunchInitialPreviewConsumed(machineId: string, sessionId: string): void {
    const key = machineSessionKey(machineId, sessionId);
    const projection = this.pendingSessionLaunchProjections.get(key);
    if (projection === undefined) return;
    projection.initialPreviewPending = false;
    if (projection.canonicalMessage !== undefined) this.pendingSessionLaunchProjections.delete(key);
  }

  private reconcilePendingSessionLaunchProjection(
    machineId: string,
    sessionId: string | undefined,
    messages: readonly ReturnType<typeof textMessage>[],
    messageStart = 0,
  ): void {
    if (sessionId === undefined) return;
    const key = machineSessionKey(machineId, sessionId);
    const projection = this.pendingSessionLaunchProjections.get(key);
    if (projection === undefined) return;
    if (messageStart > 0) {
      this.pendingSessionLaunchProjections.delete(key);
      return;
    }
    if (projection.queued.type === "prompt") {
      const match = canonicalMessagesFindPrompt(messages, projection.queued.deliveredText ?? projection.queued.text);
      if (match !== undefined) {
        if (projection.initialPreviewPending) projection.canonicalMessage = match;
        else this.pendingSessionLaunchProjections.delete(key);
      }
      return;
    }
    const receipt = projection.queued.deliveryReceipt;
    if (receipt === undefined) return;
    if (projection.receiptReconciliationPending) {
      projection.receiptReconciliationQueuedMessages = messages;
      return;
    }
    projection.receiptReconciliationPending = true;
    void canonicalMessagesFindDeliveryReceipt(messages, receipt, projection.receiptCheckedTexts).then((match) => {
      if (this.pendingSessionLaunchProjections.get(key) !== projection) return;
      projection.receiptReconciliationPending = false;
      if (match !== undefined) {
        if (projection.initialPreviewPending) {
          projection.canonicalMessage = match;
          this.onPendingSessionLaunchProjectionChange?.();
        } else {
          this.pendingSessionLaunchProjections.delete(key);
          this.onPendingSessionLaunchProjectionChange?.();
        }
        return;
      }
      const queuedMessages = projection.receiptReconciliationQueuedMessages;
      projection.receiptReconciliationQueuedMessages = undefined;
      if (queuedMessages !== undefined && queuedMessages !== messages) {
        this.reconcilePendingSessionLaunchProjection(machineId, sessionId, queuedMessages);
      }
    }).catch(() => {
      if (this.pendingSessionLaunchProjections.get(key) !== projection) return;
      const queuedMessages = projection.receiptReconciliationQueuedMessages;
      projection.receiptReconciliationPending = false;
      projection.receiptReconciliationQueuedMessages = undefined;
      projection.receiptCheckedTexts.clear();
      if (queuedMessages !== undefined && queuedMessages !== messages) {
        this.reconcilePendingSessionLaunchProjection(machineId, sessionId, queuedMessages);
      }
    });
  }

  private movePendingSessionLaunchPrompt(machineId: string, fromSessionId: string, toSessionId: string): void {
    const fromKey = machineSessionKey(machineId, fromSessionId);
    const projection = this.pendingSessionLaunchProjections.get(fromKey);
    this.pendingSessionLaunchProjections.delete(fromKey);
    if (projection !== undefined) this.pendingSessionLaunchProjections.set(machineSessionKey(machineId, toSessionId), projection);
  }

  private sessionCacheKey(sessionId: string): string {
    return machineSessionKey(selectedMachineId(this.getState()), sessionId);
  }

  private statusForSession(session: SessionInfo | undefined): SessionStatus | undefined {
    if (session === undefined) return undefined;
    const state = this.getState();
    if (state.status?.sessionId === session.id && state.selectedSession?.id === session.id) return state.status;
    return state.sessionStatuses[session.id];
  }

  private workspaceSelectionKey(cwd: string): string {
    return `${selectedMachineId(this.getState())}:${cwd}`;
  }

  private replaceSession(session: SessionInfo) {
    const current = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map((candidate) => candidate.id === session.id ? session : candidate),
      selectedSession: current?.id === session.id ? session : current,
    });
  }

  private createPendingSessionStart(destination: SessionLaunchDestination): PendingSessionStart {
    const { workspaceId, cwd, machineId } = destination;
    const tempId = `pending-session-${String(++this.pendingSessionStartSeq)}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const session: ClientPendingStartSessionInfo = {
      id: tempId,
      path: `pi-web://pending-session/${tempId}`,
      cwd,
      persisted: false,
      name: "New session",
      created: now,
      modified: now,
      messageCount: 0,
      firstMessage: "",
      clientPendingStart: true,
      machineId,
    };
    return { tempId, workspaceId, cwd, machineId, session, queuedSends: [], discarded: false };
  }

  private insertPendingSessionPreservingSelection(pending: PendingSessionStart): void {
    if (!this.isCurrentPendingStart(pending)) return;
    const state = this.getState();
    const activity = creatingPendingSessionActivity(pending.tempId);
    this.setState({
      sessions: [pending.session, ...state.sessions.filter((candidate) => candidate.id !== pending.tempId)],
      sessionActivities: { ...state.sessionActivities, [pending.tempId]: activity },
    });
  }

  private insertAndSelectPendingSession(session: ClientPendingStartSessionInfo): void {
    const state = this.getState();
    this.selectClientPendingStartSession(session, {
      activity: creatingPendingSessionActivity(session.id),
      sessions: [session, ...state.sessions.filter((candidate) => candidate.id !== session.id)],
    });
  }

  private selectClientPendingStartSession(session: ClientPendingStartSessionInfo, options?: { updateUrl?: boolean | undefined; activity?: SessionActivity | undefined; sessions?: SessionInfo[] | undefined }): void {
    this.sessionSelection.rememberSession({ ...session, cwd: this.workspaceSelectionKey(session.cwd) });
    this.selectionSeq += 1;
    this.socket.close();
    this.notifications?.clearSelectedSession();
    this.streamWatermark = undefined;
    this.latestTranscriptSeq = undefined;
    this.clearPendingUpdates();
    const state = this.getState();
    const pendingStart = this.pendingSessionStarts.get(session.id);
    const recoveryRecord = this.sessionLaunchRecoveries.get(session.id);
    const creationFailedActivity = recoveryRecord?.recovery.stage === "creationFailed" && recoveryRecord.creationFailureMessage !== undefined
      ? failedPendingSessionActivity(session.id, recoveryRecord.creationFailureMessage, recoveryRecord.queuedSends.length)
      : undefined;
    const activity = options?.activity ?? creationFailedActivity ?? state.sessionActivities[session.id] ?? (pendingStart !== undefined ? creatingPendingSessionActivity(session.id) : undefined);
    const failedStart = pendingStart === undefined && activity?.phase === "error"
      ? `Failed to start session: ${activity.detail ?? activity.label}`
      : undefined;
    const recoveredQueuedMessages = recoveryRecord?.recovery.stage === "creationFailed"
      ? recoveryRecord.queuedSends.map(queuedSessionMessagePreview)
      : undefined;
    this.setState({
      ...(options?.sessions === undefined ? {} : { sessions: options.sessions }),
      selectedSession: session,
      selectedChatLoad: failedStart === undefined
        ? selectedChatLoading(selectedChatTarget(session.machineId, session))
        : selectedChatFailed(selectedChatTarget(session.machineId, session), "absent", failedStart),
      messages: [],
      messagePageStart: 0,
      messagePageEnd: 0,
      messagePageTotal: 0,
      isLoadingEarlierMessages: false,
      status: undefined,
      activity,
      pendingAsk: undefined,
      pendingDialogs: [],
      closedDialogs: [],
      availableThinkingLevels: [],
      treeDialog: undefined,
      ...(activity === undefined ? {} : { sessionActivities: { ...state.sessionActivities, [session.id]: activity } }),
      ...(recoveredQueuedMessages === undefined ? {} : { clientQueuedSessionMessages: { ...state.clientQueuedSessionMessages, [session.id]: recoveredQueuedMessages } }),
      error: failedStart ?? "",
    });
    // Re-selecting the row mid-startup re-establishes the constructing
    // session's subscription; the close above dropped it with the old selection.
    if (pendingStart?.backendSessionId !== undefined) this.connectPendingStartSocket(pendingStart);
    if (options?.updateUrl !== false) this.updateUrl();
  }

  private async resolvePendingSessionStart(tempId: string, session: SessionInfo): Promise<void> {
    const pending = this.pendingSessionStarts.get(tempId);
    if (pending === undefined) return;
    this.pendingSessionStarts.delete(tempId);
    this.sessionLaunchRecoveries.delete(tempId);
    const queuedSends = pending.queuedSends.splice(0);
    const releasedCreatedSessions = this.takeSuppressedCreatedSessionsFor(pending.cwd, pending.machineId, session.id);
    if (pending.discarded) {
      this.pendingSessionLaunchProjections.delete(machineSessionKey(pending.machineId, tempId));
      clearDraft(machineSessionKey(pending.machineId, tempId));
      this.setState({ clientQueuedSessionMessages: omitKey(this.getState().clientQueuedSessionMessages, tempId) });
      this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      void this.api.stop(session, pending.machineId).catch(() => {
        // Best-effort cleanup for a backend session whose temporary UI row was discarded before creation finished.
      });
      return;
    }

    rememberCachedNewSession(session, pending.machineId);
    this.movePendingSessionLaunchPrompt(pending.machineId, tempId, session.id);
    moveDraft(machineSessionKey(pending.machineId, tempId), machineSessionKey(pending.machineId, session.id));
    const cachedSession = markCachedNewSessionInfo(session, pending.machineId);
    if (!this.isCurrentPendingStart(pending)) {
      this.setState({ clientQueuedSessionMessages: omitKey(this.getState().clientQueuedSessionMessages, tempId) });
      await this.flushQueuedPendingSends(cachedSession, pending.machineId, queuedSends, sessionLaunchDestination(pending));
      return;
    }

    const state = this.getState();
    const wasSelected = state.selectedSession?.id === tempId;
    this.setState({
      sessions: replacePendingSessionInList(state.sessions, tempId, cachedSession),
      sessionActivities: omitSessionActivity(state.sessionActivities, tempId),
      sendingPrompts: moveRecordKey(state.sendingPrompts, tempId, cachedSession.id),
      clientQueuedSessionMessages: moveRecordKey(state.clientQueuedSessionMessages, tempId, cachedSession.id),
      ...(wasSelected ? { selectedSession: cachedSession, selectedChatLoad: selectedChatLoading(selectedChatTarget(pending.machineId, cachedSession)), status: state.sessionStatuses[cachedSession.id], activity: state.sessionActivities[cachedSession.id], pendingAsk: state.sessionStatuses[cachedSession.id]?.pendingAsk, pendingDialogs: state.sessionStatuses[cachedSession.id]?.pendingDialogs ?? [], closedDialogs: [], error: "" } : {}),
    });
    this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
    if (wasSelected) {
      this.updateUrl({ replace: true });
      await this.selectSession(cachedSession, { updateUrl: false });
    }
    await this.flushQueuedPendingSends(cachedSession, pending.machineId, queuedSends, sessionLaunchDestination(pending));
  }

  private async failPendingSessionStart(tempId: string, error: unknown): Promise<boolean> {
    const pending = this.pendingSessionStarts.get(tempId);
    if (pending === undefined) return false;
    const identifiedCreatedSession = pending.backendSessionId === undefined
      ? undefined
      : this.suppressedCreatedSessions.get(pending.backendSessionId);
    if (identifiedCreatedSession?.machineId === pending.machineId
      && sessionPathsEqual(identifiedCreatedSession.session.cwd, pending.cwd)) {
      await this.resolvePendingSessionStart(tempId, identifiedCreatedSession.session);
      return true;
    }
    this.pendingSessionStarts.delete(tempId);
    const wasDiscarded = pending.discarded;
    if (wasDiscarded) this.pendingSessionLaunchProjections.delete(machineSessionKey(pending.machineId, tempId));
    // The pending start is dead: stop routing its dialog frames (a card on the
    // failed row could never be answered) and drop the early-subscribed socket
    // so it stops reconnecting against a session that may not exist.
    pending.discarded = true;
    if (this.getState().selectedSession?.id === tempId) this.socket.close();
    const releasedCreatedSessions = this.takeSuppressedCreatedSessionsFor(pending.cwd, pending.machineId);
    const isCurrentPendingStart = this.isCurrentPendingStart(pending);
    const message = errorMessage(error);
    const failure = `Failed to start session: ${message}`;
    const initialPrompt = pending.queuedSends.find(isInitialPromptSend);
    if (!wasDiscarded && initialPrompt !== undefined) {
      this.sessionLaunchRecoveries.set(tempId, {
        recovery: {
          stage: "creationFailed",
          sessionId: tempId,
          destination: { machineId: pending.machineId, workspaceId: pending.workspaceId, cwd: pending.cwd },
          retrying: false,
          ...recoverySubmissionProjection(initialPrompt),
        },
        queuedSends: pending.queuedSends,
        pending,
        creationFailureMessage: message,
      });
    }
    if (wasDiscarded || !isCurrentPendingStart) {
      if (isCurrentPendingStart) this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      return false;
    }
    const state = this.getState();
    const activity = failedPendingSessionActivity(tempId, message, pending.queuedSends.length);
    const hasPendingRow = state.sessions.some((session) => session.id === tempId);
    this.setState({
      sessions: hasPendingRow ? state.sessions : [pending.session, ...state.sessions],
      sessionActivities: { ...state.sessionActivities, [tempId]: activity },
      activity: state.selectedSession?.id === tempId ? activity : state.activity,
      // Open cards on the failed row are dead: the create is gone, so no
      // answer could ever reach the daemon. Settled outcomes stay as history.
      ...(state.selectedSession?.id === tempId ? {
        selectedChatLoad: selectedChatFailed(selectedChatTarget(pending.machineId, pending.session), "absent", failure),
        pendingDialogs: [],
      } : {}),
      error: failure,
    });
    this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
    return false;
  }

  private isCurrentSessionLaunchDestination(destination: SessionLaunchDestination): boolean {
    const state = this.getState();
    return selectedMachineId(state) === destination.machineId
      && state.selectedWorkspace?.id === destination.workspaceId
      && sessionPathsEqual(state.selectedWorkspace.path, destination.cwd);
  }

  private isCurrentPendingStart(pending: PendingSessionStart): boolean {
    return this.isCurrentSessionLaunchDestination(sessionLaunchDestination(pending));
  }

  private hasPendingStartFor(cwd: string, machineId: string): boolean {
    return Array.from(this.pendingSessionStarts.values()).some((pending) => sessionPathsEqual(pending.cwd, cwd) && pending.machineId === machineId);
  }

  private isSuppressedCreatedSession(session: SessionInfo, machineId: string): boolean {
    const suppressed = this.suppressedCreatedSessions.get(session.id);
    return suppressed !== undefined
      && sessionPathsEqual(suppressed.session.cwd, session.cwd)
      && suppressed.machineId === machineId;
  }

  private takeSuppressedCreatedSessionsFor(cwd: string, machineId: string, resolvedSessionId?: string): SessionInfo[] {
    if (resolvedSessionId !== undefined) this.suppressedCreatedSessions.delete(resolvedSessionId);
    if (this.hasPendingStartFor(cwd, machineId)) return [];
    const released: SessionInfo[] = [];
    for (const [sessionId, suppressed] of this.suppressedCreatedSessions) {
      if (!sessionPathsEqual(suppressed.session.cwd, cwd) || suppressed.machineId !== machineId) continue;
      this.suppressedCreatedSessions.delete(sessionId);
      released.push(suppressed.session);
    }
    return released;
  }

  private applyReleasedCreatedSessions(sessions: readonly SessionInfo[], machineId: string): void {
    if (sessions.length === 0 || selectedMachineId(this.getState()) !== machineId) return;
    const state = this.getState();
    if (state.selectedWorkspace === undefined) return;
    const workspacePath = state.selectedWorkspace.path;
    const existingIds = new Set(state.sessions.map((session) => session.id));
    const released = sessions.filter((session) => sessionPathsEqual(session.cwd, workspacePath) && !existingIds.has(session.id));
    if (released.length === 0) return;
    this.setState({ sessions: [...released.reverse(), ...state.sessions] });
  }

  private mergePendingStartSessions(cwd: string, sessions: SessionInfo[], machineId: string): SessionInfo[] {
    const pending = this.getState().sessions.filter((session): session is ClientPendingStartSessionInfo => isClientPendingStartSessionInfo(session) && sessionPathsEqual(session.cwd, cwd) && session.machineId === machineId);
    if (pending.length === 0) return sessions;
    const pendingIds = new Set(pending.map((session) => session.id));
    return [...pending, ...sessions.filter((session) => !pendingIds.has(session.id))];
  }

  private async recreateCachedNewSession(session: SessionInfo, options?: { updateUrl?: boolean | undefined }): Promise<void> {
    try {
      const machineId = selectedMachineId(this.getState());
      const replacement = await this.api.startSession(session.cwd, machineId);
      rememberCachedNewSession(replacement, machineId);
      moveDraft(this.sessionCacheKey(session.id), this.sessionCacheKey(replacement.id));
      forgetCachedNewSession(session.id, machineId);
      const cachedReplacement = markCachedNewSessionInfo(replacement, machineId);
      this.setState({ sessions: [cachedReplacement, ...this.getState().sessions.filter((candidate) => candidate.id !== session.id)], error: "" });
      await this.selectSession(cachedReplacement, { updateUrl: false });
      this.updateUrl(options?.updateUrl === false ? { replace: true } : undefined);
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private markCachedNewSessionPersisted(session: SessionInfo): void {
    if (!isCachedNewSessionInfo(session)) return;
    const latest = this.getState().sessions.find((candidate) => candidate.id === session.id) ?? session;
    this.replaceSession(stripCachedNewSessionMarker(latest));
  }

  private applyCommandResult(result: CommandResult) {
    if (result.type === "select") {
      this.setState({ commandDialog: result });
      return;
    }
    if (result.type === "tree") {
      this.setState({ treeDialog: result.tree });
      return;
    }
    const message = result.type === "unsupported" ? result.message : result.message;
    if (message !== undefined && message !== "") this.setState({ messages: [...this.getState().messages, textMessage(result.type === "unsupported" ? "system" : "tool", message)] });
    if (result.type === "done" && result.session) {
      if (result.promptDraft !== undefined) saveDraft(this.sessionCacheKey(result.session.id), result.promptDraft);
      const current = this.getState().selectedSession;
      const sessions = [result.session, ...this.getState().sessions.filter((session) => session.id !== result.session?.id)];
      this.setState({ sessions, selectedSession: current?.id === result.session.id ? result.session : current });
      if (current?.id !== result.session.id) void this.selectSession(result.session);
    }
  }

  private applyCreatedSession(session: SessionInfo) {
    const state = this.getState();
    const machineId = selectedMachineId(state);
    // A session created in another workspace is not listed here, but it may be a
    // child of one that is: keep that parent's cross-workspace child count live
    // instead of leaving it stale until the next listing.
    if (state.selectedWorkspace === undefined || !sessionPathsEqual(state.selectedWorkspace.path, session.cwd)) {
      const patch = childElsewhereCountPatch(state, session);
      if (patch !== undefined) this.setState(patch);
      return;
    }
    if (state.sessions.some((candidate) => candidate.id === session.id)) return;
    if (this.hasPendingStartFor(session.cwd, machineId)) {
      this.suppressedCreatedSessions.set(session.id, { session, machineId });
      return;
    }
    this.setState({ sessions: [session, ...state.sessions] });
  }

  private applyActivity(activity: SessionActivity) {
    this.setState({
      sessionActivities: { ...this.getState().sessionActivities, [activity.sessionId]: activity },
      activity: this.getState().selectedSession?.id === activity.sessionId ? activity : this.getState().activity,
    });
  }

  private applyStatus(status: SessionStatus) {
    const state = this.getState();
    const isSelected = state.selectedSession?.id === status.sessionId;
    const clearsStaleActivity = state.sessionActivities[status.sessionId]?.phase === "active" && !isSessionActive(status);
    this.setState({
      sessionStatuses: { ...state.sessionStatuses, [status.sessionId]: status },
      ...sessionMessageCountPatch(state, status.sessionId, status.messageCount),
      ...(clearsStaleActivity ? { sessionActivities: omitSessionActivity(state.sessionActivities, status.sessionId) } : {}),
      status: isSelected ? status : state.status,
      activity: isSelected && clearsStaleActivity ? undefined : state.activity,
      // The daemon owns whether an ask is open, so every status it publishes is
      // authoritative for the selected session's card, including its removal.
      ...(isSelected ? { pendingAsk: status.pendingAsk } : {}),
      // Same for extension dialogs: the status projection is authoritative for
      // the open list. Closed-card outcomes are event/response-driven instead,
      // so a status without the dialog simply drops it from the open list.
      ...(isSelected ? { pendingDialogs: status.pendingDialogs ?? [] } : {}),
    });
  }

  private applyOpenedDialog(dialog: PendingExtensionDialog): void {
    const state = this.getState();
    if (state.selectedSession === undefined) return;
    // Events apply exactly once, so an id already on screen means this frame
    // was already reflected (e.g. a rehydrated open) and must not duplicate
    // the card.
    if (state.pendingDialogs.some((pending) => pending.dialogId === dialog.dialogId)) return;
    this.setState({ pendingDialogs: [...state.pendingDialogs, dialog] });
  }

  private applyClosedDialog(dialogId: string, reason: ExtensionDialogCloseReason, answer: ExtensionDialogAnswer | undefined): void {
    // A close for a dialog that is not on screen is already reflected here
    // (e.g. the answering browser's own response landed first), so it must not
    // clear or duplicate other cards.
    const dialog = this.getState().pendingDialogs.find((pending) => pending.dialogId === dialogId);
    if (dialog === undefined) return;
    this.recordClosedDialog({ dialog, reason, ...(answer === undefined ? {} : { answer }) });
  }

  private recordClosedDialog(closed: ClosedExtensionDialog): void {
    const state = this.getState();
    if (state.closedDialogs.some((entry) => entry.dialog.dialogId === closed.dialog.dialogId)) return;
    this.setState({
      pendingDialogs: state.pendingDialogs.filter((pending) => pending.dialogId !== closed.dialog.dialogId),
      closedDialogs: [...state.closedDialogs, closed],
    });
  }

  /** Drop a closed dialog's transient outcome card (e.g. the user dismissed it). */
  dismissClosedDialog(dialogId: string): void {
    const state = this.getState();
    if (!state.closedDialogs.some((entry) => entry.dialog.dialogId === dialogId)) return;
    this.setState({ closedDialogs: state.closedDialogs.filter((entry) => entry.dialog.dialogId !== dialogId) });
  }

  private applyOpenedAsk(ask: PendingAskUser): void {
    const state = this.getState();
    if (state.selectedSession === undefined) return;
    // A superseded ask keeps its draft: the read-only record of an ask the user
    // never submitted must still be able to show what they had typed.
    this.setState({ pendingAsk: ask });
  }

  private applyClosedAsk(askId: string): void {
    // A close for an ask that is not the one on screen is already reflected here
    // (typically the supersede half of an open), so it must not clear the card.
    if (this.getState().pendingAsk?.askId !== askId) return;
    this.setState({ pendingAsk: undefined });
  }

  private applySessionPinned(sessionId: string, pinned: boolean) {
    const repin = (session: SessionInfo) => {
      if (session.id !== sessionId) return session;
      const next = { ...session };
      if (pinned) next.pinned = true;
      else delete next.pinned;
      return next;
    };
    const selectedSession = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map(repin),
      selectedSession: selectedSession === undefined ? undefined : repin(selectedSession),
    });
  }

  private applySessionTabs(sessionId: string, tabs: readonly string[]) {
    const retab = (session: SessionInfo) => {
      if (session.id !== sessionId) return session;
      const next = { ...session };
      if (tabs.length > 0) next.tabs = [...tabs];
      else delete next.tabs;
      return next;
    };
    const selectedSession = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map(retab),
      selectedSession: selectedSession === undefined ? undefined : retab(selectedSession),
    });
  }

  private applySessionName(sessionId: string, name: string | undefined) {
    const rename = (session: SessionInfo) => {
      if (session.id !== sessionId) return session;
      const next = { ...session };
      if (name === undefined || name === "") delete next.name;
      else next.name = name;
      return next;
    };
    const selectedSession = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map(rename),
      selectedSession: selectedSession === undefined ? undefined : rename(selectedSession),
    });
  }

  private applyEvent(event: SessionUiEvent, ignoreStreamWatermark = false) {
    // Notification revisions use their own join snapshot. Handle them before the
    // transcript watermark so a notification event sharing an already-seeded
    // transcript sequence cannot be lost.
    if (event.type === "notifications.inbox") {
      this.notifications?.applyInboxEvent(selectedMachineId(this.getState()), event);
      return;
    }
    if (event.type === "processes.update" || event.type === "processes.output") {
      this.onManagedProcessesEvent?.(event);
      return;
    }
    // Drop events already reflected in the seeded join snapshot (committed
    // history + partial). Everything past the watermark applies exactly once,
    // so live content streams directly on top of the seeded partial.
    if (!ignoreStreamWatermark && this.isStreamEventBelowWatermark(event)) return;
    this.recordTranscriptSequence(event);

    // Status and activity arrive once per token (the server republishes them on
    // every transcript event). Buffer them alongside high-frequency transcript
    // deltas so the host component renders at most once per animation frame
    // instead of once per token. Coalescing these here is what keeps the prompt
    // editor's DOM stable during streaming, so in-progress touch gestures (e.g.
    // the iOS long-press edit/paste callout) are not interrupted by a re-render.
    if (event.type === "status.update") {
      this.queueStatusUpdate(event.status);
      return;
    }
    if (event.type === "activity.update") {
      this.queueActivityUpdate(event.activity);
      return;
    }
    if (isHighFrequencyTranscriptEvent(event)) {
      this.queueTranscriptEvent(event);
      return;
    }

    this.flushPendingUpdates();
    // Ask frames are applied after the buffered status they were published with,
    // so the card follows the daemon's own open/close order.
    if (event.type === "ask.opened") {
      this.applyOpenedAsk(event.ask);
      return;
    }
    if (event.type === "ask.closed") {
      this.applyClosedAsk(event.askId);
      return;
    }
    if (event.type === "dialog.opened") {
      this.applyOpenedDialog(event.dialog);
      return;
    }
    if (event.type === "dialog.closed") {
      this.applyClosedDialog(event.dialogId, event.reason, event.answer);
      return;
    }
    const state = this.getState();
    const transcript = this.transcripts.applyLiveEvent(state.messages, event, this.liveMessagePageEnd);
    if (commitsTranscriptMessage(event)) this.liveMessagePageEnd += 1;
    if (transcript) {
      this.transcriptRevision += 1;
      this.reconcilePendingSessionLaunchProjection(selectedMachineId(state), state.selectedSession?.id, transcript, state.messagePageStart);
      this.setState({ messages: transcript });
    } else if (event.type === "session.name") {
      this.applySessionName(event.sessionId, event.name);
    }
  }

  private queueTranscriptEvent(event: SessionUiEvent): void {
    this.pendingTranscriptEvents.push(event);
    this.schedulePendingFlush();
  }

  private queueStatusUpdate(status: SessionStatus): void {
    this.pendingStatusBySession.set(status.sessionId, status);
    this.schedulePendingFlush();
  }

  private queueActivityUpdate(activity: SessionActivity): void {
    this.pendingActivityBySession.set(activity.sessionId, activity);
    this.schedulePendingFlush();
  }

  // Session startup progress arrives while the daemon is still constructing the
  // session, so the target row is resolved by exact identity only: a session id
  // the browser already knows (an open), else the correlation token this browser
  // minted for its own create and the daemon echoed back. Matching neither means
  // the row is not one this browser shows — an agent's or another tab's session is
  // *deliberately* absent while a create is pending — so it is ignored rather than
  // guessed at. A resolved row goes through the normal activity buffer, rendering
  // like any other activity and staying batched per frame.
  private queueStartupProgress(event: SessionStartupProgressEvent): void {
    if (this.getState().sessions.some((session) => session.id === event.activity.sessionId)) {
      this.queueActivityUpdate(event.activity);
      return;
    }
    const pending = event.startupToken === undefined ? undefined : this.pendingSessionStarts.get(event.startupToken);
    if (pending === undefined || pending.discarded) return;
    this.learnPendingStartBackendSession(pending, event.activity.sessionId);
    // An idle startup phase means the daemon has nothing left to attribute, so
    // restore this row's own generic wording rather than clearing the text of a
    // creation request that has not returned yet.
    this.queueActivityUpdate(event.activity.phase === "idle"
      ? creatingPendingSessionActivity(pending.tempId)
      : pendingStartActivity(event.activity, pending.tempId));
  }

  private learnPendingStartBackendSession(pending: PendingSessionStart, sessionId: string): void {
    if (sessionId === "" || pending.backendSessionId !== undefined) return;
    pending.backendSessionId = sessionId;
    if (this.getState().selectedSession?.id === pending.tempId) this.connectPendingStartSocket(pending);
  }

  /**
   * Subscribe the selected pending-start row to its constructing session.
   * `session_start` dialogs park the create request until answered, so waiting
   * for readiness to subscribe would make them unanswerable; the per-session
   * event channel and (on this daemon version) the status route both serve a
   * session whose startup is still waiting on the user.
   */
  private connectPendingStartSocket(pending: PendingSessionStart): void {
    const backendSessionId = pending.backendSessionId;
    if (backendSessionId === undefined || pending.discarded) return;
    const ref: SessionRef = { id: backendSessionId, cwd: pending.cwd };
    this.socket.connect(
      ref,
      (event) => { this.applyPendingStartEvent(pending, event); },
      () => { this.resyncPendingStartDialogs(pending); },
      pending.machineId,
    );
    this.resyncPendingStartDialogs(pending);
  }

  /**
   * Recover dialogs that opened before this subscription connected (or during
   * a reconnect gap) from the daemon's status projection. The HTTP snapshot is
   * unordered against socket frames — dialogs the socket already opened or
   * closed are newer than anything it can say about them — so only genuinely
   * unknown opens are adopted, never a wholesale replace. A daemon that
   * predates mid-startup status answers 404 until readiness: tolerated, since
   * everything that opens from here still arrives as an event.
   */
  private resyncPendingStartDialogs(pending: PendingSessionStart): void {
    const backendSessionId = pending.backendSessionId;
    if (backendSessionId === undefined) return;
    void this.api.status({ id: backendSessionId, cwd: pending.cwd }, pending.machineId).then(
      (status) => {
        // Guard before applying: this unordered snapshot can land after the
        // readiness swap made the real session selected, and a stale replace
        // must not clobber the socket's fresher dialog state.
        if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
        this.applyStatus(status);
        const state = this.getState();
        const knownIds = new Set<string>([
          ...state.pendingDialogs.map((pendingDialog) => pendingDialog.dialogId),
          ...state.closedDialogs.map((closed) => closed.dialog.dialogId),
        ]);
        const recovered = (status.pendingDialogs ?? []).filter((recoveredDialog) => !knownIds.has(recoveredDialog.dialogId));
        if (recovered.length > 0) this.setState({ pendingDialogs: [...state.pendingDialogs, ...recovered] });
      },
      () => undefined,
    );
  }

  /**
   * Route a constructing session's events onto its pending-start row. Only
   * dialog frames and their status reconciliation apply here: everything else
   * (transcript, activity, naming) is re-fetched authoritatively by the
   * readiness join, and routing it onto a temporary row would pollute state
   * keyed for a session that does not exist yet. Frames that arrive after the
   * row stopped being the selected pending start belong to the selection flow
   * that took over.
   */
  private applyPendingStartEvent(pending: PendingSessionStart, event: SessionUiEvent): void {
    if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
    if (event.type === "dialog.opened") {
      this.applyOpenedDialog(event.dialog);
      return;
    }
    if (event.type === "dialog.closed") {
      this.applyClosedDialog(event.dialogId, event.reason, event.answer);
      return;
    }
    if (event.type === "status.update") this.applyPendingStartStatus(pending, event.status);
  }

  /**
   * Apply a constructing session's status from an ordered channel (the
   * socket's own status frame, or a dialog close response): the daemon's
   * projection is authoritative there, so the open list is replaced wholesale,
   * exactly as applyStatus does for a ready session. The per-session map stays
   * truthful too — the readiness swap seeds the selected status from it.
   */
  private applyPendingStartStatus(pending: PendingSessionStart, status: SessionStatus): void {
    this.applyStatus(status);
    if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
    this.setState({ pendingDialogs: status.pendingDialogs ?? [] });
  }

  private schedulePendingFlush(): void {
    if (this.pendingFrame !== undefined) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = undefined;
      this.flushPendingUpdates();
    });
  }

  // Apply buffered transcript deltas, activity, and status in one task. Activity
  // is applied before status to mirror the server's publish order, so an idle
  // status can clear the now-stale active activity it supersedes. Status and
  // activity are last-write-wins per session, so iterating the maps applies only
  // the latest buffered value per session. These writes run in a single task, so
  // Lit batches them into one render.
  flushPendingUpdates(): void {
    if (this.pendingTranscriptEvents.length > 0) {
      const events = this.pendingTranscriptEvents;
      this.pendingTranscriptEvents = [];
      let messages = this.getState().messages;
      for (const event of events) {
        messages = this.transcripts.applyLiveEvent(messages, event, this.liveMessagePageEnd) ?? messages;
        if (commitsTranscriptMessage(event)) this.liveMessagePageEnd += 1;
      }
      if (messages !== this.getState().messages) {
        this.transcriptRevision += 1;
        this.reconcilePendingSessionLaunchProjection(selectedMachineId(this.getState()), this.getState().selectedSession?.id, messages, this.getState().messagePageStart);
        this.setState({ messages });
      }
    }
    if (this.pendingActivityBySession.size > 0) {
      const activities = Array.from(this.pendingActivityBySession.values());
      this.pendingActivityBySession.clear();
      for (const activity of activities) this.applyActivity(activity);
    }
    if (this.pendingStatusBySession.size > 0) {
      const statuses = Array.from(this.pendingStatusBySession.values());
      this.pendingStatusBySession.clear();
      for (const status of statuses) this.applyStatus(status);
    }
    // Apply buffered machine-global status and activity deltas in one write.
    this.inbox?.flushPendingSessionStateToGlobal();
  }

  private clearPendingUpdates(): void {
    this.pendingTranscriptEvents = [];
    this.pendingStatusBySession.clear();
    this.pendingActivityBySession.clear();
    if (this.pendingFrame === undefined) return;
    cancelAnimationFrame(this.pendingFrame);
    this.pendingFrame = undefined;
  }

  // Watermark filter for join-time exactly-once application. An event is below
  // the watermark when it belongs to the selected session's seeded snapshot
  // (`seq <= watermark.seq`); such events are already reflected in the committed
  // history + seeded partial and must be dropped. Events with no `seq` (which
  // should not occur on the per-session socket) are never dropped.
  private recordTranscriptSequence(event: SessionUiEvent): void {
    if (!isTranscriptContentEvent(event) || event.seq === undefined) return;
    const sessionId = this.getState().selectedSession?.id;
    if (sessionId === undefined) return;
    const current = this.latestTranscriptSeq;
    if (current?.sessionId === sessionId && current.seq >= event.seq) return;
    this.latestTranscriptSeq = { sessionId, seq: event.seq };
  }

  private isStreamEventBelowWatermark(event: SessionUiEvent): boolean {
    const watermark = this.streamWatermark;
    if (watermark === undefined || watermark.sessionId !== this.getState().selectedSession?.id) return false;
    return event.seq !== undefined && event.seq <= watermark.seq;
  }
}

function omitSessionActivity(activities: Record<string, SessionActivity>, sessionId: string): Record<string, SessionActivity> {
  return omitKey(activities, sessionId);
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

function omitKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (keys.length === 0) return record;
  const removed = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([id]) => !removed.has(id)));
}

function moveRecordKey<T>(record: Record<string, T>, fromKey: string, toKey: string): Record<string, T> {
  if (fromKey === toKey || !(fromKey in record)) return record;
  const value = record[fromKey];
  if (value === undefined) return record;
  return { ...omitKey(record, fromKey), [toKey]: value };
}

function replacePendingSessionInList(sessions: readonly SessionInfo[], pendingSessionId: string, resolvedSession: SessionInfo): SessionInfo[] {
  const next: SessionInfo[] = [];
  let inserted = false;
  for (const session of sessions) {
    if (session.id === pendingSessionId) {
      if (!inserted) {
        next.push(resolvedSession);
        inserted = true;
      }
      continue;
    }
    if (session.id === resolvedSession.id) continue;
    next.push(session);
  }
  if (!inserted) return [resolvedSession, ...next];
  return next;
}

export function isClientPendingStartSessionInfo(session: SessionInfo | undefined): session is ClientPendingStartSessionInfo {
  return session !== undefined && "clientPendingStart" in session && session.clientPendingStart === true;
}

/**
 * Re-label a startup report onto the browser's own pending create row.
 *
 * The daemon's startup marker is dropped: this row stands for a create the user
 * asked for and is waiting on, which the browser has always reported as active
 * work in progress, rather than for a session the daemon is opening. Only the
 * phase text is borrowed, so the row keeps its own `creating · ` appearance.
 */
function pendingStartActivity(activity: SessionActivity, sessionId: string): SessionActivity {
  return {
    sessionId,
    phase: activity.phase,
    label: activity.label,
    ...(activity.detail === undefined ? {} : { detail: activity.detail }),
    at: activity.at,
  };
}

function creatingPendingSessionActivity(sessionId: string): SessionActivity {
  return {
    sessionId,
    phase: "active",
    label: "Creating session",
    detail: "Starting session",
    at: new Date().toISOString(),
  };
}

function failedPendingSessionActivity(sessionId: string, message: string, queuedCount = 0): SessionActivity {
  const queuedDetail = queuedCount > 0 ? ` · ${String(queuedCount)} queued ${queuedCount === 1 ? "message" : "messages"} kept below` : "";
  return {
    sessionId,
    phase: "error",
    label: "Session creation failed",
    detail: `${message}${queuedDetail}`,
    at: new Date().toISOString(),
  };
}

const INITIAL_PROMPT_RETRY_ACTIVITY_LABEL = "Sending first prompt";
const INITIAL_PROMPT_CONFIRMED_UNSENT_ACTIVITY_LABEL = "First prompt was not sent";
const INITIAL_PROMPT_AMBIGUOUS_ACTIVITY_LABEL = "First prompt delivery is unclear";
const INITIAL_PROMPT_RECOVERY_ACTIVITY_LABELS = new Set([
  INITIAL_PROMPT_CONFIRMED_UNSENT_ACTIVITY_LABEL,
  INITIAL_PROMPT_AMBIGUOUS_ACTIVITY_LABEL,
]);

function failedInitialPromptActivity(sessionId: string, stage: SessionLaunchRecovery["stage"]): SessionActivity {
  const confirmedUnsent = stage === "promptConfirmedUnsent";
  return {
    sessionId,
    phase: "error",
    label: confirmedUnsent ? INITIAL_PROMPT_CONFIRMED_UNSENT_ACTIVITY_LABEL : INITIAL_PROMPT_AMBIGUOUS_ACTIVITY_LABEL,
    detail: confirmedUnsent
      ? "The session was created, but its first prompt was confirmed unsent."
      : "The session was created, but the first prompt may have been accepted. Inspect the transcript before sending it again.",
    at: new Date().toISOString(),
  };
}

function sessionLaunchDestinationForWorkspace(workspace: Workspace, machineId: string): SessionLaunchDestination {
  return { machineId, workspaceId: workspace.id, cwd: workspace.path };
}

function sessionLaunchDestinationIsValid(destination: SessionLaunchDestination): boolean {
  return destination.machineId.trim().length > 0
    && destination.workspaceId.trim().length > 0
    && destination.cwd.trim().length > 0;
}

function sessionLaunchDestination(pending: PendingSessionStart): SessionLaunchDestination {
  return { machineId: pending.machineId, workspaceId: pending.workspaceId, cwd: pending.cwd };
}

function isInitialPromptRecoveryActivity(activity: SessionActivity | undefined): boolean {
  return activity?.phase === "error" && INITIAL_PROMPT_RECOVERY_ACTIVITY_LABELS.has(activity.label);
}

function isInitialPromptRetryActivity(activity: SessionActivity | undefined): boolean {
  return activity?.phase === "active"
    && activity.label === INITIAL_PROMPT_RETRY_ACTIVITY_LABEL
    && activity.detail === "Retry in progress";
}

function firstPromptSubmissionIsEmpty(submission: FirstPromptSubmission): boolean {
  return submission.text.trim() === "" && (submission.attachments === undefined || submission.attachments.length === 0);
}

function appendSavedAttachmentReferences(text: string, paths: readonly string[]): string {
  const references = paths.map((path) => fileCompletionInsertText(path, false)).join(" ");
  return text === "" ? references : `${text}

${references}`;
}

function recoverySubmissionProjection(queued: FirstPromptQueuedSend): Pick<SessionLaunchRecovery, "attachments" | "delivery"> {
  return recoveryAttachmentProjection(queued);
}

function claimedRecoveryDraftQueueBookkeeping(queued: FirstPromptQueuedSend): ClaimedSessionLaunchRecoveryDraft["queued"] {
  if (queued.type === "promptResource") {
    return {
      type: queued.type,
      id: queued.id,
      identity: { ...queued.identity },
      ...(queued.streamingBehavior === undefined ? {} : { streamingBehavior: queued.streamingBehavior }),
      delivery: queued.delivery,
      purpose: queued.purpose,
      ...(queued.retryAttempts === undefined ? {} : { retryAttempts: queued.retryAttempts }),
      ...(queued.deliveryReceipt === undefined ? {} : { deliveryReceipt: queued.deliveryReceipt }),
    };
  }
  return {
    type: queued.type,
    id: queued.id,
    ...(queued.streamingBehavior === undefined ? {} : { streamingBehavior: queued.streamingBehavior }),
    delivery: queued.delivery,
    ...(queued.purpose === undefined ? {} : { purpose: queued.purpose }),
    ...(queued.deliveryReceipt === undefined ? {} : { deliveryReceipt: queued.deliveryReceipt }),
  };
}

function payloadFreeClaimedRecovery(recovery: SessionLaunchRecovery, queued: FirstPromptQueuedSend): SessionLaunchRecovery {
  return {
    stage: recovery.stage,
    sessionId: recovery.sessionId,
    destination: recovery.destination,
    retrying: recovery.retrying,
    ...(recovery.requiresPromptResourceValidation === undefined ? {} : { requiresPromptResourceValidation: recovery.requiresPromptResourceValidation }),
    delivery: queued.delivery,
    ...recoveryAttachmentProjection(queued),
  };
}

function queuedRecoveryDraftFromSnapshot(bookkeeping: ClaimedSessionLaunchRecoveryDraft["queued"], snapshot: SessionLaunchRecoveryDraftSnapshot): FirstPromptQueuedSend {
  const attachments = snapshot.attachments === undefined ? undefined : snapshot.attachments.map((attachment) => ({ ...attachment }));
  if (bookkeeping.type === "promptResource" && promptResourceIdentityApplies(snapshot.text, bookkeeping.identity)) {
    return {
      ...bookkeeping,
      identity: { ...bookkeeping.identity },
      text: snapshot.text,
      attachments,
      delivery: snapshot.delivery ?? bookkeeping.delivery,
      purpose: "initialPrompt",
    };
  }
  return {
    type: "prompt",
    id: bookkeeping.id,
    ...(bookkeeping.streamingBehavior === undefined ? {} : { streamingBehavior: bookkeeping.streamingBehavior }),
    text: snapshot.text,
    attachments,
    delivery: snapshot.delivery ?? bookkeeping.delivery,
    purpose: "initialPrompt",
  };
}

function queuedPromptNeedsValidation(queued: FirstPromptQueuedSend): boolean {
  return queued.type === "promptResource"
    ? (queued.retryAttempts ?? 0) > 0
    : parseLeadingSlashCommand(queued.text).kind !== "not-command";
}

function promptResourceIdentityApplies(text: string, identity: PromptResourceCommandIdentity): boolean {
  const parsed = parseLeadingSlashCommand(text);
  return parsed.kind === "command" && parsed.name === identity.name;
}

function insertQueuedRecoveryDraft(queue: QueuedPendingSessionSend[], index: number, queued: FirstPromptQueuedSend): void {
  const withoutDuplicate = queue.filter((candidate) => candidate.id !== queued.id);
  const insertionIndex = Math.max(0, Math.min(index, withoutDuplicate.length));
  queue.splice(0, queue.length, ...withoutDuplicate.slice(0, insertionIndex), queued, ...withoutDuplicate.slice(insertionIndex));
}

function recoveryWithQueuedSubmission(recovery: SessionLaunchRecovery, queued: FirstPromptQueuedSend): SessionLaunchRecovery {
  return {
    stage: recovery.stage,
    sessionId: recovery.sessionId,
    destination: recovery.destination,
    retrying: recovery.retrying,
    ...(queuedPromptNeedsValidation(queued) ? { requiresPromptResourceValidation: true } : {}),
    ...recoverySubmissionProjection(queued),
  };
}

function recoveryAttachmentProjection(queued: FirstPromptQueuedSend): Pick<SessionLaunchRecovery, "attachments" | "delivery"> {
  return queued.attachments === undefined || queued.attachments.length === 0
    ? {}
    : {
        delivery: queued.delivery,
        attachments: queued.attachments.map(promptAttachmentMetadata),
      };
}

function promptAttachmentMetadata(attachment: PromptAttachment): NonNullable<SessionLaunchRecovery["attachments"]>[number] {
  return {
    ...(attachment.name === undefined ? {} : { name: attachment.name }),
    mimeType: attachment.mimeType,
    size: base64ByteLength(attachment.data),
  };
}

async function initialPromptRecoveryAccepted(page: MessagePage, queued: QueuedPendingSessionSend | undefined): Promise<boolean> {
  if (queued?.type === "promptResource") {
    return queued.deliveryReceipt !== undefined ? await canonicalTranscriptContainsDeliveryReceipt(page, queued.deliveryReceipt) : false;
  }
  return queued?.type === "prompt" ? canonicalTranscriptContainsPrompt(page, queued.deliveredText ?? queued.text) : false;
}

async function queuedInitialPromptAccepted(page: MessagePage, queued: Extract<QueuedPendingSessionSend, { type: "prompt" | "promptResource" }>): Promise<boolean> {
  if (queued.type === "promptResource") {
    return queued.deliveryReceipt !== undefined ? await canonicalTranscriptContainsDeliveryReceipt(page, queued.deliveryReceipt) : false;
  }
  return canonicalTranscriptContainsPrompt(page, queued.deliveredText ?? queued.text);
}

function canonicalTranscriptContainsPrompt(page: MessagePage, prompt: string): boolean {
  return canonicalMessagesFindPrompt(normalizeMessages(page.messages), prompt) !== undefined;
}

function canonicalMessagesFindPrompt(messages: readonly ReturnType<typeof textMessage>[], prompt: string): ReturnType<typeof textMessage> | undefined {
  return messages.find((message) => {
    if (message.role !== "user") return false;
    if (message.promptText === prompt) return true;
    return canonicalUserMessageText(message) === prompt;
  });
}

async function canonicalTranscriptContainsDeliveryReceipt(page: MessagePage, receipt: string): Promise<boolean> {
  return await canonicalMessagesFindDeliveryReceipt(normalizeMessages(page.messages), receipt, new Set<string>()) !== undefined;
}

async function canonicalMessagesFindDeliveryReceipt(
  messages: readonly ReturnType<typeof textMessage>[],
  receipt: string,
  checkedTexts: Set<string>,
): Promise<ReturnType<typeof textMessage> | undefined> {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const texts = message.promptText === undefined ? [canonicalUserMessageText(message)] : [message.promptText, canonicalUserMessageText(message)];
    for (const text of texts) {
      if (checkedTexts.has(text)) continue;
      checkedTexts.add(text);
      if (await fingerprintPromptResourceDeliveryText(text) === receipt) return message;
    }
  }
  return undefined;
}

function canonicalUserMessageText(message: { parts: readonly { type: string; text?: string | undefined }[] }): string {
  return message.parts.map((part) => part.type === "text" ? part.text ?? "" : "").join("");
}

function canonicalSessionIsBlankAndIdle(page: MessagePage, status: SessionStatus): boolean {
  return page.total === 0 && page.messages.length === 0 && canonicalStatusIsIdle(status);
}

function canonicalStatusIsIdle(status: SessionStatus): boolean {
  return !status.isStreaming
    && !status.isCompacting
    && !status.isBashRunning
    && status.pendingMessageCount === 0
    && status.queuedMessages.length === 0;
}

function isInitialPromptSend(queued: QueuedPendingSessionSend): queued is Extract<QueuedPendingSessionSend, { type: "prompt" | "promptResource" }> & { purpose: "initialPrompt" } {
  return (queued.type === "prompt" || queued.type === "promptResource") && queued.purpose === "initialPrompt";
}

function queuedSessionMessagePreview(queued: QueuedPendingSessionSend): QueuedSessionMessage {
  if (queued.type === "prompt" || queued.type === "promptResource") {
    const text = isInitialPromptSend(queued) ? initialPromptPreviewText(queued.attachments) : queuedPromptPreviewText(queued.text, queued.attachments);
    return { kind: queued.streamingBehavior === "steer" ? "steer" : "followUp", text };
  }
  return { kind: "followUp", text: queued.text };
}

function pendingSessionLaunchChatMessage(queued: FirstPromptQueuedSend): ReturnType<typeof textMessage> {
  const parts: ReturnType<typeof textMessage>["parts"] = [];
  if (queued.text !== "") parts.push({ type: "text", text: queued.text });
  if (queued.delivery === "inline") {
    parts.push(...(queued.attachments ?? [])
      .filter((attachment) => attachment.kind === "image")
      .map((attachment) => ({ type: "image" as const, mimeType: attachment.mimeType, data: attachment.data })));
  }
  const summarizedAttachments = queued.attachments?.filter((attachment) => queued.delivery !== "inline" || attachment.kind !== "image");
  const attachmentText = queuedAttachmentSummary(summarizedAttachments);
  if (attachmentText !== undefined) parts.push({ type: "text", text: attachmentText });
  return { role: "user", parts };
}

function initialPromptPreviewText(attachments: PromptAttachment[] | undefined): string {
  const attachmentText = queuedAttachmentSummary(attachments);
  return attachmentText === undefined ? "[First prompt queued]" : `[First prompt queued]\n\n${attachmentText}`;
}

function queuedPromptPreviewText(text: string, attachments: PromptAttachment[] | undefined): string {
  const attachmentText = queuedAttachmentSummary(attachments);
  if (attachmentText === undefined) return text;
  const trimmed = text.trim();
  return trimmed === "" ? attachmentText : `${text}\n\n${attachmentText}`;
}

function queuedAttachmentSummary(attachments: PromptAttachment[] | undefined): string | undefined {
  if (attachments === undefined || attachments.length === 0) return undefined;
  const names = attachments.map((attachment) => attachment.name?.trim()).filter((name): name is string => name !== undefined && name !== "");
  const count = attachments.length;
  const label = `${String(count)} ${count === 1 ? "attachment" : "attachments"}`;
  if (names.length === 0) return `[${label} queued]`;
  const shownNames = names.slice(0, 3).join(", ");
  const suffix = names.length > 3 ? `, +${String(names.length - 3)} more` : "";
  return `[${label} queued: ${shownNames}${suffix}]`;
}

function uniqueSessionsById(sessions: readonly SessionInfo[]): SessionInfo[] {
  const seen = new Set<string>();
  const unique: SessionInfo[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    unique.push(session);
  }
  return unique;
}

function bulkFailureMessages(failures: readonly SessionBulkFailure[]): string[] {
  return failures.map((failure) => `${failure.sessionId}: ${failure.error}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalSessionPathEquals(path: string | undefined, expected: string): boolean {
  return path !== undefined && sessionPathsEqual(path, expected);
}

/**
 * State patch incrementing the cross-workspace child count of the listed parent
 * of `createdSession`, or undefined when that parent is not in view.
 *
 * Exported for testing: it encodes when a session created in another workspace
 * is relevant to the current listing at all.
 */
export function childElsewhereCountPatch(state: AppState, createdSession: SessionInfo): Pick<Partial<AppState>, "sessions"> | undefined {
  const parentPath = createdSession.parentSessionPath;
  if (parentPath === undefined || parentPath === "") return undefined;
  // The created session's parent path and the listed session's own path reach the
  // browser from different server producers, so they are compared tolerantly.
  const isParent = (candidate: SessionInfo) => sessionPathsEqual(candidate.path, parentPath);
  if (!state.sessions.some(isParent)) return undefined;
  return {
    sessions: state.sessions.map((candidate) => isParent(candidate)
      ? { ...candidate, childSessionsElsewhere: (candidate.childSessionsElsewhere ?? 0) + 1 }
      : candidate),
  };
}

function sessionMessageCountPatch(state: AppState, sessionId: string, messageCount: number | undefined): Pick<Partial<AppState>, "sessions" | "selectedSession"> {
  if (messageCount === undefined) return {};

  const sessionsChanged = state.sessions.some((session) => session.id === sessionId && session.messageCount !== messageCount);
  const sessions = sessionsChanged
    ? state.sessions.map((session) => session.id === sessionId ? { ...session, messageCount } : session)
    : undefined;
  const selectedSession = state.selectedSession?.id === sessionId && state.selectedSession.messageCount !== messageCount
    ? { ...state.selectedSession, messageCount }
    : state.selectedSession;

  return {
    ...(sessions === undefined ? {} : { sessions }),
    ...(selectedSession !== state.selectedSession ? { selectedSession } : {}),
  };
}

function isTranscriptContentEvent(event: SessionUiEvent): boolean {
  return event.type === "message.append"
    || event.type === "assistant.delta"
    || event.type === "assistant.thinking.delta"
    || event.type === "tool.start"
    || event.type === "tool.update"
    || event.type === "tool.end"
    || event.type === "shell.start"
    || event.type === "shell.chunk"
    || event.type === "shell.end"
    || event.type === "message.end"
    || event.type === "command.output"
    || event.type === "session.error";
}

function commitsTranscriptMessage(event: SessionUiEvent): boolean {
  // `message.append` is the optimistic projection of the same raw message that
  // its later `message.end` commits. Advancing on both would skip one raw index.
  return event.type === "message.end" && event.message !== undefined;
}

function isHighFrequencyTranscriptEvent(event: SessionUiEvent): boolean {
  return event.type === "assistant.delta" || event.type === "assistant.thinking.delta" || event.type === "shell.chunk";
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => { globalThis.setTimeout(resolve, 0); });
}

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("session not found");
}

