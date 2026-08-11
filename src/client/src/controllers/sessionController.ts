import { api as defaultApi, type AskUserCloseResponse, type AskUserSubmission, type CommandResult, type ExtensionDialogAnswer, type ExtensionDialogCloseReason, type ExtensionDialogCloseResponse, type ExtensionDialogOutcome, type MessagePage, type PendingAskUser, type PendingExtensionDialog, type PromptAttachment, type QueuedSessionMessage, type SessionActivity, type SessionBulkFailure, type SessionCleanupExecuteResponse, type SessionInfo, type SessionRef, type SessionStatus, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type Workspace } from "../api";
import type { AppState, ClosedExtensionDialog } from "../appState";
import { forgetCachedNewSession, isCachedNewSessionInfo, markCachedNewSessionInfo, mergeCachedNewSessions, rememberCachedNewSession, stripCachedNewSessionMarker } from "../cachedNewSessions";
import { normalizeMessages, textMessage } from "../chatMessages";
import { machineSessionKey } from "../machineKeys";
import { clearDraft, loadDraft, moveDraft, saveDraft } from "../promptDraftStorage";
import { clearAskDraft } from "../askDrafts";
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
import { InMemorySessionSelectionMemory, markSessionArchived, markSessionsArchived, selectPreferredSession, selectionAfterArchivingSession, selectionAfterArchivingSessions, shouldDeselectAfterArchivedCollapse, type SessionSelectionMemory } from "./sessionSelection";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import type { SessionInboxBridge } from "./sessionInboxController";
import { sessionPathsEqual } from "../sessionPaths";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";

const MESSAGE_PAGE_SIZE = 100;

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
}

export interface SelectedSessionReady {
  machineId: string;
  session: SessionInfo;
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
  onManagedProcessesEvent?: (event: Extract<SharedSessionUiEvent, { type: "processes.update" | "processes.output" }> | { type: "processes.refresh" }) => void;
}

interface BulkSessionMutationResult {
  succeededIds: string[];
  failures: string[];
  generatedAt?: string;
}

type ClientPendingStartSessionInfo = SessionInfo & { clientPendingStart: true; machineId: string };

type QueuedPendingSessionSendInput =
  | { type: "prompt"; text: string; streamingBehavior?: "steer" | "followUp" | undefined; attachments?: PromptAttachment[] | undefined; delivery: PromptAttachmentDelivery; purpose?: "initialPrompt" }
  | { type: "shell"; text: string }
  | { type: "command"; text: string };

type QueuedPendingSessionSend = QueuedPendingSessionSendInput & { id: string };

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

export interface SessionLaunchRecovery {
  readonly stage: "creationFailed" | "promptConfirmedUnsent" | "promptDeliveryAmbiguous";
  readonly sessionId: string;
  readonly destination: SessionLaunchDestination;
  readonly prompt: string;
  readonly retrying: boolean;
}

interface PendingSessionStart {
  tempId: string;
  workspaceId: string;
  cwd: string;
  machineId: string;
  session: ClientPendingStartSessionInfo;
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

interface SessionLaunchRecoveryRecord {
  recovery: SessionLaunchRecovery;
  queuedSends: QueuedPendingSessionSend[];
  pending?: PendingSessionStart;
  session?: SessionInfo;
  creationFailureMessage?: string;
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
  private readonly onManagedProcessesEvent: SessionControllerDependencies["onManagedProcessesEvent"];
  private selectionSeq = 0;
  private guidanceMutationSeq = 0;
  private disposed = false;
  // Join-time stream watermark for the selected session. `seq` is the
  // `SessionEventHub` sequence captured together with the seeded partial by the
  // stream snapshot: buffered/live events with `seq <= seq` are already reflected
  // in the committed history + seeded partial and must be dropped, so every event
  // applies exactly once. Reset whenever the selection changes.
  private streamWatermark: { sessionId: string; seq: number } | undefined;
  private pendingTranscriptEvents: SessionUiEvent[] = [];
  private pendingStatusBySession = new Map<string, SessionStatus>();
  private pendingActivityBySession = new Map<string, SessionActivity>();
  private pendingFrame: number | undefined;
  private pendingSessionStartSeq = 0;
  private pendingQueuedSendSeq = 0;
  private readonly pendingSessionStarts = new Map<string, PendingSessionStart>();
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
    else if (event.type === "session.startup") this.queueStartupProgress(event);
  }

  dispose() {
    this.disposed = true;
    this.selectionSeq += 1;
    this.socket.close();
    this.clearPendingUpdates();
    for (const queue of this.readinessQueuedSends.values()) this.restoreReadinessQueueDraft(queue);
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
    const machineId = selectedMachineId(this.getState());
    const pending = this.createPendingSessionStart(workspace, machineId);
    this.pendingSessionStarts.set(pending.tempId, pending);
    this.insertAndSelectPendingSession(pending.session);
    await this.startPendingSession(pending);
  }

  async launchSession(firstPrompt: string): Promise<void> {
    const workspace = this.getState().selectedWorkspace;
    if (workspace === undefined || firstPrompt.trim() === "") return;
    const machineId = selectedMachineId(this.getState());
    const pending = this.createPendingSessionStart(workspace, machineId);
    this.pendingSessionStarts.set(pending.tempId, pending);
    this.insertAndSelectPendingSession(pending.session);
    this.enqueuePendingSessionSend(pending.session, { type: "prompt", text: firstPrompt, delivery: "inline", purpose: "initialPrompt" });
    await this.startPendingSession(pending);
  }

  getSessionLaunchRecovery(sessionId: string): SessionLaunchRecovery | undefined {
    return this.sessionLaunchRecoveries.get(sessionId)?.recovery;
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
    if (record?.recovery.stage !== "creationFailed"
      || replacementSessionId === failedSessionId
      || state.selectedSession?.id !== replacementSessionId
      || !state.sessions.some((session) => session.id === replacementSessionId)) return;
    this.sessionLaunchRecoveries.delete(failedSessionId);
    clearDraft(machineSessionKey(record.recovery.destination.machineId, failedSessionId));
    this.setState({
      sessions: state.sessions.filter((session) => session.id !== failedSessionId),
      sessionStatuses: omitKey(state.sessionStatuses, failedSessionId),
      sessionActivities: omitSessionActivity(state.sessionActivities, failedSessionId),
      sendingPrompts: omitKey(state.sendingPrompts, failedSessionId),
      clientQueuedSessionMessages: omitKey(state.clientQueuedSessionMessages, failedSessionId),
    });
    this.inbox?.notifyDeleted(record.recovery.destination.machineId, [failedSessionId]);
  }

  async retrySessionLaunch(sessionId: string): Promise<void> {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record === undefined || record.recovery.retrying) return;

    if (record.recovery.stage === "creationFailed" && record.pending !== undefined) {
      record.recovery = { ...record.recovery, retrying: true };
      record.pending.discarded = false;
      delete record.pending.backendSessionId;
      this.pendingSessionStarts.set(sessionId, record.pending);
      this.applySessionLaunchRetryActivity(sessionId, "Creating session");
      await this.startPendingSession(record.pending);
      return;
    }

    if (record.recovery.stage !== "promptConfirmedUnsent" || record.session === undefined) return;
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
    const replaced = await this.replacePromptEditorText({
      machineId: record.recovery.destination.machineId,
      sessionId,
      text: record.recovery.prompt,
    });
    if (replaced === false || this.sessionLaunchRecoveries.get(sessionId) !== record) return;
    const retainedQueuedSends = record.queuedSends.slice(1);
    this.sessionLaunchRecoveries.delete(sessionId);
    this.dropNextQueuedSessionMessage(sessionId);
    this.clearInitialPromptRecoveryProjection(sessionId);
    await this.flushQueuedPendingSends(record.session, record.recovery.destination.machineId, retainedQueuedSends, record.recovery.destination);
  }

  async refreshSessionLaunchRecovery(sessionId: string): Promise<void> {
    const record = this.sessionLaunchRecoveries.get(sessionId);
    if (record?.recovery.stage !== "promptDeliveryAmbiguous" || record.session === undefined) return;
    const { machineId } = record.recovery.destination;
    try {
      const [page, status] = await Promise.all([
        this.api.messages(record.session, { limit: MESSAGE_PAGE_SIZE }, machineId),
        this.api.status(record.session, machineId),
      ]);
      if (this.sessionLaunchRecoveries.get(sessionId) !== record || !this.isSelectedSessionIdentity(sessionId, machineId)) return;
      const history = this.transcripts.mergeHistory(machineSessionKey(machineId, sessionId), page);
      this.setState(history);
      this.applyStatus(status);
      if (canonicalTranscriptContainsPrompt(page, record.recovery.prompt)) {
        const retainedQueuedSends = record.queuedSends.slice(1);
        this.sessionLaunchRecoveries.delete(sessionId);
        this.dropNextQueuedSessionMessage(sessionId);
        this.clearInitialPromptRecoveryProjection(sessionId);
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

  private clearInitialPromptRecoveryProjection(sessionId: string): void {
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

  private async startPendingSession(pending: PendingSessionStart): Promise<void> {
    try {
      const session = await this.api.startSession(pending.cwd, pending.machineId, pending.tempId);
      await this.resolvePendingSessionStart(pending.tempId, session);
    } catch (error) {
      this.failPendingSessionStart(pending.tempId, error);
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
    this.socket.close();
    this.streamWatermark = undefined;
    this.clearPendingUpdates();
    const machineId = selectedMachineId(this.getState());
    this.notifications?.prepareSelectedSession(session, machineId);
    const transcriptKey = this.sessionCacheKey(session.id);
    const target = selectedChatTarget(machineId, session);
    const cached = this.transcripts.cachedView(transcriptKey);
    const hasCachedHistory = this.transcripts.rawHistoryPage(transcriptKey) !== undefined;
    const previewPending = this.transcriptPreviewRequests.has(transcriptKey);
    const showCachedImmediately = hasCachedHistory && !previewPending;
    const openingView = showCachedImmediately ? cached : transcriptViewFromHistory(undefined);
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
        const history = this.transcripts.mergeHistory(transcriptKey, page);
        this.setState({ ...history, selectedChatLoad: selectedChatReadOnly(target, "fresh"), isLoadingEarlierMessages: false, status: undefined, activity: undefined, pendingAsk: undefined, pendingDialogs: [], closedDialogs: [] });
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
    const state = this.getState();
    const session = state.selectedSession;
    if (!session || state.isLoadingEarlierMessages || state.messagePageStart <= 0) return;
    this.setState({ isLoadingEarlierMessages: true });
    try {
      const page = await this.api.messages(session, { before: state.messagePageStart, limit: MESSAGE_PAGE_SIZE }, selectedMachineId(this.getState()));
      if (this.getState().selectedSession?.id !== session.id) return;
      const key = this.sessionCacheKey(session.id);
      const history = this.transcripts.mergeHistory(key, page);
      this.setState(history);
      this.transcripts.schedulePersist(key);
    } catch (error) {
      this.setState({ error: String(error) });
    } finally {
      if (this.getState().selectedSession?.id === session.id) this.setState({ isLoadingEarlierMessages: false });
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
    if (!hasAttachments && trimmed.startsWith("/")) return this.runCommand(text);
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

  async runCommand(text: string) {
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
    await this.deliverCommandToSession(session, text, machineId, { applyResult: true });
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
    const state = this.getState();
    const current = state.clientQueuedSessionMessages[session.id] ?? [];
    const activity = creatingPendingSessionActivity(session.id, pending.queuedSends.length);
    this.setState({
      clientQueuedSessionMessages: { ...state.clientQueuedSessionMessages, [session.id]: [...current, queuedSessionMessagePreview(queued)] },
      sessionActivities: { ...state.sessionActivities, [session.id]: activity },
      activity: state.selectedSession?.id === session.id ? activity : state.activity,
      error: "",
    });
  }

  private async flushQueuedPendingSends(session: SessionInfo, machineId: string, queuedSends: readonly QueuedPendingSessionSend[], destination?: SessionLaunchDestination): Promise<void> {
    for (const [index, queued] of queuedSends.entries()) {
      const delivered = await this.deliverQueuedPendingSend(session, machineId, queued);
      if (delivered) {
        this.dropNextQueuedSessionMessage(session.id);
        continue;
      }
      if (!isInitialPromptSend(queued)) {
        this.dropQueuedSessionMessages(session.id, queuedSends.length - index);
        return;
      }
      if (destination === undefined) return;
      const stage = await this.reconcileInitialPromptDelivery(session, machineId, queued.text);
      if (stage === "accepted") {
        this.markCachedNewSessionPersisted(session);
        this.dropNextQueuedSessionMessage(session.id);
        this.clearInitialPromptRecoveryProjection(session.id);
        continue;
      }
      const recovery: SessionLaunchRecovery = {
        stage,
        sessionId: session.id,
        destination,
        prompt: queued.text,
        retrying: false,
      };
      this.sessionLaunchRecoveries.set(session.id, { recovery, queuedSends: queuedSends.slice(index), session });
      this.applyInitialPromptRecoveryActivity(recovery);
      return;
    }
  }

  private async reconcileInitialPromptDelivery(session: SessionInfo, machineId: string, prompt: string): Promise<"accepted" | "promptConfirmedUnsent" | "promptDeliveryAmbiguous"> {
    try {
      const [page, status] = await Promise.all([
        this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, machineId),
        this.api.status(session, machineId),
      ]);
      if (canonicalTranscriptContainsPrompt(page, prompt)) return "accepted";
      return canonicalSessionIsBlankAndIdle(page, status) ? "promptConfirmedUnsent" : "promptDeliveryAmbiguous";
    } catch {
      return "promptDeliveryAmbiguous";
    }
  }

  private applyInitialPromptRecoveryActivity(recovery: SessionLaunchRecovery): void {
    const activity = failedInitialPromptActivity(recovery.sessionId, recovery.stage);
    const state = this.getState();
    this.setState({
      sessionActivities: { ...state.sessionActivities, [recovery.sessionId]: activity },
      activity: state.selectedSession?.id === recovery.sessionId ? activity : state.activity,
      error: recovery.stage === "promptConfirmedUnsent"
        ? "The first prompt was not sent. You can retry it."
        : "The first prompt may have been accepted. Inspect the transcript before you send it again.",
    });
  }

  private async deliverQueuedPendingSend(session: SessionInfo, machineId: string, queued: QueuedPendingSessionSend): Promise<boolean> {
    if (queued.type === "prompt") return this.deliverPromptToSession(session, queued.text, queued.streamingBehavior, queued.attachments, queued.delivery, machineId, { markSending: true });
    if (queued.type === "shell") return this.deliverShellToSession(session, queued.text, machineId, { optimisticLine: true });
    return this.deliverCommandToSession(session, queued.text, machineId, { applyResult: true });
  }

  private async deliverPromptToSession(session: SessionInfo, text: string, streamingBehavior: "steer" | "followUp" | undefined, attachments: PromptAttachment[] | undefined, delivery: PromptAttachmentDelivery, machineId: string, options: { markSending: boolean }): Promise<boolean> {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    if (options.markSending) this.markSendingPrompt(session.id, true);
    try {
      if (hasAttachments && delivery === "folder") {
        const saved = await this.api.saveAttachments(session, attachments, machineId);
        const references = saved.map((file) => fileCompletionInsertText(file.path, false)).join(" ");
        const body = text === "" ? references : `${text}\n\n${references}`;
        await this.api.prompt(session, body, streamingBehavior, machineId);
      } else {
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

  private async deliverCommandToSession(session: SessionInfo, text: string, machineId: string, options: { applyResult: boolean }): Promise<boolean> {
    // Commands are not inserted into the transcript optimistically: a builtin
    // command produces its own result line, and a runtime/skill command is
    // forwarded to the agent, which streams back the canonical (expanded)
    // message. Inserting the raw text here would leave a line that doesn't
    // converge with server history and disappears on reload. Surface the same
    // per-session sending indicator that send() uses for the pre-receipt window.
    this.markSendingPrompt(session.id, true);
    try {
      const result = await this.api.runCommand(session, text, machineId);
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

  async setGuidance(entryId: string, enabled: boolean): Promise<boolean> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) return false;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    const mutationSeq = ++this.guidanceMutationSeq;
    try {
      const status = await this.api.setGuidance(session, entryId, enabled, machineId);
      if (!this.isCurrentSessionSelection(session.id, machineId, selectionSeq) || mutationSeq !== this.guidanceMutationSeq) return false;
      const confirmedGuidanceIds = status.activeGuidanceIds ?? [];
      const pendingStatus = this.pendingStatusBySession.get(status.sessionId);
      if (pendingStatus !== undefined) {
        this.pendingStatusBySession.set(status.sessionId, { ...pendingStatus, activeGuidanceIds: confirmedGuidanceIds });
      }
      const currentStatus = this.getState().status;
      this.applyStatus(currentStatus?.sessionId === status.sessionId
        ? { ...currentStatus, activeGuidanceIds: confirmedGuidanceIds }
        : status);
      return true;
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq) && mutationSeq === this.guidanceMutationSeq) {
        this.setState({ error: String(error) });
      }
      return false;
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
  submitAsk(askId: string, submission: AskUserSubmission): Promise<void> {
    return this.closeOpenAsk(askId, (session, machineId) => this.api.submitAsk(session, askId, submission, machineId));
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
      this.markSelectedChatRefreshing(selectedTarget);
      const historyPromise = this.api.messages(target.session, { limit: MESSAGE_PAGE_SIZE }, target.machineId);
      const statusPromise = this.api.status(target.session, target.machineId);
      const streamSnapshotPromise = this.api.streamSnapshot(target.session, target.machineId);
      const previewRequest = this.transcriptPreviewRequests.get(key);
      if (previewRequest !== undefined && this.currentSelectedChatReadability(selectedTarget) === "absent") {
        void previewRequest.then((page) => {
          if (!this.isCurrentRefreshTarget(target) || this.currentSelectedChatReadability(selectedTarget) !== "absent") return;
          const preview = transcriptViewFromHistory(page);
          this.setState({ ...preview, selectedChatLoad: selectedChatPreviewReadable(selectedTarget), isLoadingEarlierMessages: false });
        }).catch(() => undefined);
      }
      void this.notifications?.refreshSelectedSession(target.session, target.machineId).catch(() => undefined);

      const historyViewPromise = historyPromise.then((page) => {
        if (!this.isCurrentRefreshTarget(target)) return undefined;
        const history = this.transcripts.mergeHistory(key, page);
        this.setState({ ...history, selectedChatLoad: selectedChatFreshReadable(selectedTarget), isLoadingEarlierMessages: false });
        this.transcripts.schedulePersist(key);
        return history;
      });
      const statusResultPromise = statusPromise.then(
        (status) => ({ ok: true, status }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
      const streamSnapshotResultPromise = streamSnapshotPromise.then(
        (streamSnapshot) => ({ ok: true, streamSnapshot }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );

      const history = await historyViewPromise;
      if (history === undefined || !this.isCurrentRefreshTarget(target)) return;
      const [statusResult, streamSnapshotResult] = await Promise.all([statusResultPromise, streamSnapshotResultPromise]);
      if (!streamSnapshotResult.ok) throw streamSnapshotResult.error;
      const { streamSnapshot } = streamSnapshotResult;
      // Seed the in-flight partial assistant message on top of committed history
      // and record the snapshot's sequence as the watermark. Buffered/live events
      // with `seq <= watermark` are already reflected here and are dropped by
      // `applyEvent`; later events (`seq > watermark`) stream in on top. The
      // partial is seeded into the in-memory transcript only, never the raw
      // history cache, so it never persists.
      const messages = this.transcripts.seedStreamingPartial(history.messages, streamSnapshot.partial);
      this.streamWatermark = { sessionId: target.session.id, seq: streamSnapshot.seq };
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
      await this.flushReadinessSends(target.session, target.machineId);
      this.transcriptPreviewRequests.delete(key);
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

  private isSelectedSessionIdentity(sessionId: string, machineId: string): boolean {
    if (this.disposed) return false;
    const state = this.getState();
    const selected = state.selectedSession;
    return selectedMachineId(state) === machineId
      && selected?.id === sessionId
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
      const record = this.sessionLaunchRecoveries.get(sessionId);
      if (record?.recovery.destination.machineId !== machineId) continue;
      this.sessionLaunchRecoveries.delete(sessionId);
      affectedIds.push(sessionId);
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

  private createPendingSessionStart(workspace: Workspace, machineId: string): PendingSessionStart {
    const tempId = `pending-session-${String(++this.pendingSessionStartSeq)}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const session: ClientPendingStartSessionInfo = {
      id: tempId,
      path: `pi-web://pending-session/${tempId}`,
      cwd: workspace.path,
      persisted: false,
      name: "New session",
      created: now,
      modified: now,
      messageCount: 0,
      firstMessage: "",
      clientPendingStart: true,
      machineId,
    };
    return { tempId, workspaceId: workspace.id, cwd: workspace.path, machineId, session, queuedSends: [], discarded: false };
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
    this.clearPendingUpdates();
    const state = this.getState();
    const pendingStart = this.pendingSessionStarts.get(session.id);
    const recoveryRecord = this.sessionLaunchRecoveries.get(session.id);
    const creationFailedActivity = recoveryRecord?.recovery.stage === "creationFailed" && recoveryRecord.creationFailureMessage !== undefined
      ? failedPendingSessionActivity(session.id, recoveryRecord.creationFailureMessage, recoveryRecord.queuedSends.length)
      : undefined;
    const activity = options?.activity ?? creationFailedActivity ?? state.sessionActivities[session.id] ?? (pendingStart !== undefined ? creatingPendingSessionActivity(session.id, pendingStart.queuedSends.length) : undefined);
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
      clearDraft(machineSessionKey(pending.machineId, tempId));
      this.setState({ clientQueuedSessionMessages: omitKey(this.getState().clientQueuedSessionMessages, tempId) });
      this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      void this.api.stop(session, pending.machineId).catch(() => {
        // Best-effort cleanup for a backend session whose temporary UI row was discarded before creation finished.
      });
      return;
    }

    rememberCachedNewSession(session, pending.machineId);
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
      ...(wasSelected ? { selectedSession: cachedSession, selectedChatLoad: selectedChatLoading(selectedChatTarget(pending.machineId, cachedSession)), status: state.sessionStatuses[cachedSession.id], activity: state.sessionActivities[cachedSession.id], pendingAsk: state.sessionStatuses[cachedSession.id]?.pendingAsk, pendingDialogs: state.sessionStatuses[cachedSession.id]?.pendingDialogs ?? [], closedDialogs: [] } : {}),
      error: "",
    });
    this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
    if (wasSelected) {
      this.updateUrl({ replace: true });
      await this.selectSession(cachedSession, { updateUrl: false });
    }
    await this.flushQueuedPendingSends(cachedSession, pending.machineId, queuedSends, sessionLaunchDestination(pending));
  }

  private failPendingSessionStart(tempId: string, error: unknown): void {
    const pending = this.pendingSessionStarts.get(tempId);
    if (pending === undefined) return;
    this.pendingSessionStarts.delete(tempId);
    const wasDiscarded = pending.discarded;
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
          prompt: initialPrompt.text,
          retrying: false,
        },
        queuedSends: pending.queuedSends,
        pending,
        creationFailureMessage: message,
      });
    }
    if (wasDiscarded || !isCurrentPendingStart) {
      if (isCurrentPendingStart) this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      return;
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
  }

  private isCurrentPendingStart(pending: PendingSessionStart): boolean {
    const state = this.getState();
    return selectedMachineId(state) === pending.machineId && state.selectedWorkspace?.id === pending.workspaceId;
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
    const transcript = this.transcripts.applyLiveEvent(this.getState().messages, event);
    if (transcript) {
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
      ? creatingPendingSessionActivity(pending.tempId, pending.queuedSends.length)
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
      for (const event of events) messages = this.transcripts.applyLiveEvent(messages, event) ?? messages;
      if (messages !== this.getState().messages) this.setState({ messages });
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

function isClientPendingStartSessionInfo(session: SessionInfo | undefined): session is ClientPendingStartSessionInfo {
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

function creatingPendingSessionActivity(sessionId: string, queuedCount = 0): SessionActivity {
  return {
    sessionId,
    phase: "active",
    label: "Creating session",
    detail: queuedCount > 0 ? `${String(queuedCount)} queued ${queuedCount === 1 ? "message" : "messages"} will send when the backend session is ready` : "Waiting for the backend session to be ready",
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

function canonicalTranscriptContainsPrompt(page: MessagePage, prompt: string): boolean {
  return normalizeMessages(page.messages).some((message) => {
    if (message.role !== "user") return false;
    if (message.promptText === prompt) return true;
    return message.parts.map((part) => part.type === "text" ? part.text : "").join("") === prompt;
  });
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

function isInitialPromptSend(queued: QueuedPendingSessionSend): queued is Extract<QueuedPendingSessionSend, { type: "prompt" }> & { purpose: "initialPrompt" } {
  return queued.type === "prompt" && queued.purpose === "initialPrompt";
}

function queuedSessionMessagePreview(queued: QueuedPendingSessionSend): QueuedSessionMessage {
  if (queued.type === "prompt") {
    return { kind: queued.streamingBehavior === "steer" ? "steer" : "followUp", text: queuedPromptPreviewText(queued.text, queued.attachments) };
  }
  return { kind: "followUp", text: queued.text };
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

function isHighFrequencyTranscriptEvent(event: SessionUiEvent): boolean {
  return event.type === "assistant.delta" || event.type === "assistant.thinking.delta" || event.type === "shell.chunk";
}

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("session not found");
}

