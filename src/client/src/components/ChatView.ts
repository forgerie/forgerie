import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { chatTurns, foldMetaSources, groupChatMessages, latestChatResponseStart, summarizeChatGroup, type ChatGroup, type ChatTurn } from "../chatGroups";
import { livenessStep } from "../chatLiveness";
import type { SessionActivityIndicator } from "../sessionStatusStrip";
import { splitChatNotice } from "../chatNotices";
import "./TranscriptLivenessView";
import { writeClipboardText } from "../clipboard";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { sessionActivityIndicator } from "../sessionStatusStrip";
import { anchoredTurnKey, followModeAfterReaderPullback, followModeAfterScroll, followModeAfterTurnOpened, FOLLOW_FREE, FOLLOW_TAIL, type ChatFollowMode } from "../chatFollowMode";
import { ChatScrollController, distanceFromScrollBottom, isNearScrollBottom, type ChatAnchorScrollPosition, type ChatScrollRestoreResult } from "../chatScrollPosition";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus, SessionWarningSeverity } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { selectedChatHasReadableHistory, selectedChatNoTarget, selectedChatReadability, type SelectedChatLoad } from "../selectedChatLoad";
import { notificationAnnouncementLabel, type SelectedSessionNotificationView } from "../sessionNotifications";
import type { SessionLaunchRecovery } from "../controllers/sessionController";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./FormattedText";
import "./ToolExecutionView";

const messageTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export interface QueuedMessageSection {
  source: "client" | "server";
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
}

export interface ChatInitialReadingTarget {
  readonly kind: "latest-response";
  readonly id: string;
}

type ImageLoadScrollSettlement =
  | { readonly kind: "inactive" }
  | { readonly kind: "anchor"; readonly sessionId: string; readonly position: ChatAnchorScrollPosition };

const INACTIVE_IMAGE_LOAD_SCROLL_SETTLEMENT: ImageLoadScrollSettlement = { kind: "inactive" };

export function chatQueuedMessageSections(
  clientQueued: QueuedSessionMessage[],
  serverQueued: QueuedSessionMessage[],
  sessionLaunchRecovery?: SessionLaunchRecovery,
): QueuedMessageSection[] {
  const recoveryClientQueued = sessionLaunchRecovery !== undefined && clientQueued.length === 0
    ? [{ kind: "followUp" as const, text: sessionLaunchRecovery.prompt }]
    : clientQueued;
  const clientSection = sessionLaunchRecovery === undefined
    ? { source: "client" as const, heading: "Queued until session starts", detail: "Will send once the backend session is ready", messages: recoveryClientQueued }
    : { source: "client" as const, heading: "First prompt needs attention", detail: "Resolve it before later queued messages can continue", messages: recoveryClientQueued };
  return [
    recoveryClientQueued.length === 0 ? undefined : clientSection,
    serverQueued.length === 0 ? undefined : { source: "server", heading: "Queued messages", detail: `${String(serverQueued.length)} pending`, messages: serverQueued },
  ].filter((section): section is QueuedMessageSection => section !== undefined);
}

export type ChatSessionLaunchRecoveryActionKind = "retry" | "changeDestination" | "refresh" | "restore";

export interface ChatSessionLaunchRecoveryPresentation {
  heading: string;
  detail: string;
  actions: { kind: ChatSessionLaunchRecoveryActionKind; label: string; disabled: boolean }[];
}

/** Derive truthful, stage-specific recovery copy and controls from the controller contract. */
export function chatSessionLaunchRecoveryPresentation(recovery: SessionLaunchRecovery): ChatSessionLaunchRecoveryPresentation {
  if (recovery.stage === "creationFailed") {
    return {
      heading: "Session creation failed",
      detail: "The session was not created, so the first prompt was not sent. Any later queued messages wait behind it.",
      actions: [
        { kind: "retry", label: recovery.retrying ? "Retrying…" : "Retry", disabled: recovery.retrying },
        { kind: "changeDestination", label: "Change destination", disabled: recovery.retrying },
      ],
    };
  }
  if (recovery.stage === "promptConfirmedUnsent") {
    return {
      heading: "First prompt not sent",
      detail: "The session exists, but the first prompt was confirmed unsent. Any later queued messages wait behind it.",
      actions: [{ kind: "retry", label: recovery.retrying ? "Retrying…" : "Retry", disabled: recovery.retrying }],
    };
  }
  return {
    heading: "First prompt delivery unconfirmed",
    detail: "The session exists, but Forgerie cannot verify whether the first prompt was accepted. Any later queued messages wait behind it.",
    actions: [
      { kind: "refresh", label: "Refresh transcript", disabled: false },
      { kind: "restore", label: "Restore to editor", disabled: false },
    ],
  };
}

export type ChatImagePart = Extract<ChatPart, { type: "image" }>;
type ProcessNotificationPart = Extract<ChatPart, { type: "processNotification" }>;

function processNotificationPresentation(kind: ProcessNotificationPart["kind"]): { symbol: string; className: string; label: string } {
  if (kind === "success") return { symbol: "✓", className: "success", label: "Process succeeded" };
  if (kind === "failure" || kind === "crash") return { symbol: "✖", className: "error", label: "Process failed" };
  if (kind === "killed") return { symbol: "⏹", className: "", label: "Process stopped" };
  return { symbol: "ℹ", className: "", label: "Process update" };
}

/** Derive the `<img>` source URL and alt text for a rendered image part. */
export function chatImagePartSource(part: ChatImagePart): { src: string; alt: string } {
  return { src: `data:${part.mimeType};base64,${part.data}`, alt: "attached image" };
}

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? "tool output" : `${toolName} output`;
}

/** The stable scroll-anchor/render key for a top-level message at `index`. */
export function chatMessageAnchorKey(index: number): string {
  return `m:${String(index)}`;
}

/** The stable scroll-anchor/render key for a collapsed event group starting at `startIndex`. */
export function chatGroupAnchorKey(startIndex: number): string {
  return `g:${String(startIndex)}`;
}

/** The stable scroll-anchor key for an event inside a group at `index`. */
export function chatEventAnchorKey(index: number): string {
  return `e:${String(index)}`;
}

/** The stable scroll-marker id emitted before an event group ending at `endIndex`. */
export function chatGroupScrollMarkerId(endIndex: number): string {
  return `g:${String(endIndex)}`;
}

/** The CSS class list for an event-group `<details>`, distinguishing the live tail. */
export function chatMessageGroupClassName(live: boolean): string {
  return live ? "msg event-group live" : "msg event-group";
}

/** Whether a queued-message section shows the server clear-queue action. */
export function chatQueuedSectionShowsClearAction(section: QueuedMessageSection, hasClearHandler: boolean): boolean {
  return section.source === "server" && hasClearHandler;
}

/** A rendered session-warning row derived from live status warnings. */
export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

/** Derive one severity-tagged warning row per live status warning, in order. */
export function chatSessionWarningRows(status: SessionStatus | undefined): ChatSessionWarningRow[] {
  return (status?.warnings ?? []).map((warning) => ({
    severity: warning.severity,
    severityClass: `session-warning ${warning.severity}`,
    message: warning.message,
    ...(warning.source === undefined ? {} : { source: warning.source }),
    ...(warning.path === undefined ? {} : { path: warning.path }),
    ...(warning.dismiss === undefined ? {} : { dismissId: warning.dismiss.id }),
  }));
}

export function chatMessageMetadataLabel(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp);
  const model = chatMessageModelLabel(message);
  const parts = [time, model, message.meta?.thinkingLevel].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? "No Pi message metadata available" : parts.join(" · ");
}

function formatMessageTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return messageTimestampFormatter.format(date);
}

function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property() sessionId = "";
  @property() sessionTitle = "";
  @property() selectedMachineId = "local";
  @property() sessionCwd = "";
  @property({ attribute: false }) selectedLoad: SelectedChatLoad = selectedChatNoTarget();
  @property({ type: Number }) messageStart = 0;
  @property({ type: Number }) messageEnd = 0;
  @property({ type: Number }) messageTotal = 0;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) loadingMore = false;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Number }) pendingMessageCount = 0;
  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];
  @property({ attribute: false }) sessionLaunchRecovery?: SessionLaunchRecovery;
  @property({ attribute: false }) onSessionLaunchRecoveryAction?: (sessionId: string, action: ChatSessionLaunchRecoveryActionKind) => void;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ attribute: false }) pendingAsk?: PendingAskUser;
  @property({ attribute: false }) askDraftSessionId = "";
  @property({ attribute: false }) onSubmitAsk?: (askId: string, submission: AskUserSubmission) => void | Promise<void>;
  @property({ attribute: false }) pendingDialogs: PendingExtensionDialog[] = [];
  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];
  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onDismissClosedDialog?: ExtensionDialogDismissCallback;
  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;
  @property({ attribute: false }) onClearServerQueue?: () => void;
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  @property({ attribute: false }) onRetry?: () => void;
  @property({ attribute: false }) onSelectedLoadPaint?: (load: SelectedChatLoad) => void;
  @property({ attribute: false }) initialReadingTarget: ChatInitialReadingTarget | undefined;
  @property({ attribute: false }) onInitialReadingTargetApplied?: (target: ChatInitialReadingTarget) => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query(".chat-load-retry") private retryButton?: HTMLButtonElement;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @state() private followMode: ChatFollowMode = FOLLOW_TAIL;
  /**
   * The turn whose reserved space is still standing.
   *
   * It outlives the anchor on purpose. Taking the space back the moment the
   * reader returns to the tail would pull the reply they are reading up the
   * screen; the space is only reclaimed when the next turn opens and takes it.
   */
  @state() private reservedTurnKey: string | undefined;
  @state() private zoomedImage: { src: string; alt: string } | undefined = undefined;
  @state() private expandedMetaKey: string | undefined;
  /** ISO time the current stretch of work began; undefined while idle. */
  @state() private activeSince: string | undefined;
  @state() private copiedMessageKey: string | undefined;
  private imageZoomModalRegistration: RenderedModalRegistration | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollController = new ChatScrollController();
  private suppressScrollSave = false;
  private suppressLoadMoreRequests = false;
  private loadMoreCheckFrame: number | undefined;
  private scrollToBottomFrame: number | undefined;
  private alignAnchoredTurnFrame: number | undefined;
  private scrollToOpenAskFrame: number | undefined;
  private scrollToOpenDialogFrame: number | undefined;
  private initialReadingTargetFrame: number | undefined;
  private initialReadingTargetFrameTargetId: string | undefined;
  private applyingInitialReadingTargetId: string | undefined;
  private appliedInitialReadingTargetId: string | undefined;
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private turnsCache: ChatTurn[] = [];
  private foldMetaCache = new Map<number, ChatLine>();
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private readonly messageCopyTextCache = new WeakMap<ChatLine, string>();
  private lastScrollTop = 0;
  private lastClientHeight = 0;
  private selectedLoadPaintToken = 0;
  private selectedLoadPaintFrame: number | undefined;
  private selectedLoadPaintTask: number | undefined;
  /**
   * The offset the transcript last put the scroller at itself.
   *
   * A scroll event carries no hint about who caused it, and an anchored turn
   * must ignore its own alignment: aligning a turn lands the scroller at the
   * foot of the reserved space, which is indistinguishable from the reader
   * choosing to return to the tail unless the transcript remembers the offset
   * it wrote.
   */
  private selfScrollTop: number | undefined;
  private lastSeenTurnKey: string | undefined;
  private lastSeenTurnCount = 0;
  private turnTrackingReady = false;
  private sentFromHere = false;
  private touchStartY: number | undefined;
  private pendingScrollRestoreSessionId: string | undefined;
  private pendingScrollRestorePosition: ChatAnchorScrollPosition | undefined;
  private imageLoadScrollSettlement: ImageLoadScrollSettlement = INACTIVE_IMAGE_LOAD_SCROLL_SETTLEMENT;
  private defaultScrollRestoreDeferred = false;
  private restoreScrollFrame: number | undefined;
  private prependRestoreToken = 0;
  @state() private loadMoreRequested = false;
  private retryFocusPending = false;
  private readonly onViewportResize = () => {
    if (this.followMode.kind === "tail" && this.initialReadingTarget === undefined && !this.defaultScrollRestoreDeferred) this.scrollToBottom();
    else if (this.followMode.kind === "turn") this.alignAnchoredTurn();
    else this.lastClientHeight = this.chat?.clientHeight ?? 0;
  };
  private readonly onImageLoad = (): void => {
    if (this.restoreSettlingScrollAnchor()) return;
    if (this.followMode.kind === "tail" && this.initialReadingTarget === undefined && !this.defaultScrollRestoreDeferred) this.scrollToBottom();
    else if (this.followMode.kind === "turn") this.alignAnchoredTurn();
  };
  private readonly openImageZoom = (src: string, alt: string): void => {
    this.zoomedImage = { src, alt };
  };
  private readonly closeImageZoom = (): void => {
    if (this.zoomedImage !== undefined) this.zoomedImage = undefined;
  };
  private readonly onImageZoomDialogClick = (event: MouseEvent): void => {
    if (event.target === this.imageZoomDialog) this.closeImageZoom();
  };
  private readonly onPageHide = () => {
    this.saveScrollPosition();
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  protected override firstUpdated(): void {
    this.lastClientHeight = this.chat?.clientHeight ?? 0;
    this.scheduleSelectedLoadPaintReport();
  }

  override disconnectedCallback(): void {
    this.saveScrollPosition();
    this.scrollController.dispose();
    this.releaseImageZoomModal();
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    if (this.scrollToBottomFrame !== undefined) cancelAnimationFrame(this.scrollToBottomFrame);
    if (this.alignAnchoredTurnFrame !== undefined) cancelAnimationFrame(this.alignAnchoredTurnFrame);
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
    if (this.initialReadingTargetFrame !== undefined) {
      cancelAnimationFrame(this.initialReadingTargetFrame);
      this.initialReadingTargetFrame = undefined;
      this.initialReadingTargetFrameTargetId = undefined;
    }
    this.cancelSelectedLoadPaintReport();
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private savePreviousSessionScrollPosition(previousSessionId: unknown): void {
    if (typeof previousSessionId !== "string" || previousSessionId === "" || previousSessionId === this.sessionId) return;
    this.saveScrollPosition(previousSessionId);
  }

  private prepareSessionUiState(): void {
    this.disclosures.syncSession(this.sessionId);
    this.scrollController.clearScheduledSave();
    this.suppressScrollSave = false;
    this.suppressLoadMoreRequests = false;
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.imageLoadScrollSettlement = INACTIVE_IMAGE_LOAD_SCROLL_SETTLEMENT;
    this.defaultScrollRestoreDeferred = false;
    this.retryFocusPending = false;
    this.prependRestoreToken += 1;
    this.selfScrollTop = undefined;
    this.turnTrackingReady = false;
    this.lastSeenTurnCount = 0;
    this.sentFromHere = false;
    this.reservedTurnKey = undefined;
    this.applyingInitialReadingTargetId = undefined;
    this.appliedInitialReadingTargetId = undefined;
    if (this.alignAnchoredTurnFrame !== undefined) {
      cancelAnimationFrame(this.alignAnchoredTurnFrame);
      this.alignAnchoredTurnFrame = undefined;
    }
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
    if (this.initialReadingTargetFrame !== undefined) {
      cancelAnimationFrame(this.initialReadingTargetFrame);
      this.initialReadingTargetFrame = undefined;
      this.initialReadingTargetFrameTargetId = undefined;
    }
    this.cancelSelectedLoadPaintReport();
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    this.trackActiveSince();
    if (changed.has("sessionId")) {
      this.activeSince = undefined;
      this.savePreviousSessionScrollPosition(changed.get("sessionId"));
      this.prepareSessionUiState();
      this.trackActiveSince();
    }
    if (changed.has("isSendingPrompt") && this.isSendingPrompt) this.sentFromHere = true;
    if (changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) {
      if (this.followMode.kind === "tail" && !this.didChatHeightChange() && !this.isNearBottom()) this.followMode = FOLLOW_FREE;
    }
    this.trackOpenedTurn();
  }

  /**
   * A turn opening at the foot of the transcript takes the reading position.
   *
   * A transcript arriving all at once is not a turn opening: a session restores
   * to where its reader left it, which is the whole point of saving that
   * position. Only growth from a transcript that was already on screen counts --
   * or the first turn of a session that had none.
   */
  private trackOpenedTurn(): void {
    const turns = this.turns();
    const last = turns[turns.length - 1];
    const key = last === undefined ? undefined : this.turnRenderKey(last);
    const seen = this.lastSeenTurnCount;
    if (!this.turnTrackingReady) {
      this.turnTrackingReady = true;
      this.lastSeenTurnKey = key;
      this.lastSeenTurnCount = turns.length;
      return;
    }
    if (key === undefined || key === this.lastSeenTurnKey) return;
    this.lastSeenTurnKey = key;
    this.lastSeenTurnCount = turns.length;
    if (seen === 0 && turns.length > 1) return;
    if (last?.openedByIndex === undefined) return;
    const sentFromHere = this.sentFromHere;
    this.sentFromHere = false;
    const next = followModeAfterTurnOpened(this.followMode, key, sentFromHere);
    if (next.kind !== "turn") return;
    this.followMode = next;
    this.reservedTurnKey = key;
  }

  protected override update(changed: Map<string, unknown>): void {
    const prependAnchor = this.isPrependingMessages(changed) ? this.capturePrependScrollAnchor() : undefined;
    super.update(changed);
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    if (changed.has("sessionId")) {
      this.cancelSelectedLoadPaintReport();
      this.restoreScrollPosition();
    }
    const openedAsk = changed.has("pendingAsk") && this.isNewPendingAsk(changed.get("pendingAsk"));
    const openedDialog = changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs"));
    const following = this.followMode.kind !== "free";
    const contentChanged = changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs");
    // The form uses the transcript scroller. Start a new long form at question
    // one rather than applying the usual live-tail scroll and landing at its end.
    if (!changed.has("sessionId") && openedAsk && following) {
      this.cancelImageLoadScrollSettlement();
      this.scrollToOpenAsk();
    } else if (!changed.has("sessionId") && openedDialog && following) {
      this.cancelImageLoadScrollSettlement();
      this.scrollToOpenDialog();
    } else if (!changed.has("sessionId") && this.followMode.kind === "turn" && (contentChanged || changed.has("followMode"))) {
      this.cancelImageLoadScrollSettlement();
      this.alignAnchoredTurn();
    } else if (!changed.has("sessionId") && contentChanged && this.followMode.kind === "tail" && this.initialReadingTarget === undefined && !this.defaultScrollRestoreDeferred) {
      this.cancelImageLoadScrollSettlement();
      this.scrollToBottom();
    }
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.continuePendingScrollRestore();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    if (changed.has("zoomedImage")) this.syncImageZoomDialog();
    if (changed.has("selectedMachineId") || changed.has("sessionCwd")) {
      this.cancelSelectedLoadPaintReport();
      if (!changed.has("selectedLoad")) this.scheduleSelectedLoadPaintReport();
    }
    if (changed.has("selectedLoad")) {
      this.restoreRetryFocusAfterRetry();
      this.scheduleSelectedLoadPaintReport();
    }
    if (changed.has("initialReadingTarget") || changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("selectedLoad")) {
      if (this.initialReadingTarget === undefined && this.defaultScrollRestoreDeferred && selectedChatHasReadableHistory(this.currentSelectedLoad())) this.restoreScrollPosition();
      else this.scheduleInitialReadingTarget();
    }
  }

  private scheduleInitialReadingTarget(): void {
    const target = this.initialReadingTarget;
    if (target === undefined
      || target.id === this.appliedInitialReadingTargetId
      || target.id === this.applyingInitialReadingTargetId
      || selectedChatReadability(this.currentSelectedLoad()) !== "fresh"
      || this.loadingMore) return;

    if (this.initialReadingTargetFrame !== undefined) {
      if (this.initialReadingTargetFrameTargetId === target.id) return;
      cancelAnimationFrame(this.initialReadingTargetFrame);
      this.initialReadingTargetFrame = undefined;
      this.initialReadingTargetFrameTargetId = undefined;
    }
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.initialReadingTargetFrameTargetId = target.id;
    this.initialReadingTargetFrame = requestAnimationFrame(() => {
      this.initialReadingTargetFrame = undefined;
      this.initialReadingTargetFrameTargetId = undefined;
      void this.applyInitialReadingTarget(target);
    });
  }

  private async applyInitialReadingTarget(target: ChatInitialReadingTarget): Promise<void> {
    if (this.initialReadingTarget?.id !== target.id || target.id === this.appliedInitialReadingTargetId) return;
    this.applyingInitialReadingTargetId = target.id;
    let restartAfterRender = false;
    try {
      let response = latestChatResponseStart(this.groupedMessages());
      if (response === undefined) {
        const latestTurn = this.turns().at(-1);
        if (latestTurn?.openedByIndex === undefined && this.hasMore) {
          this.requestLoadMore();
          return;
        }
        this.restoreDefaultScrollPosition(this.sessionId);
        this.finishInitialReadingTarget(target);
        return;
      }

      const turnKey = this.turnRenderKey(response.turn);
      if (this.reservedTurnKey !== turnKey) {
        this.reservedTurnKey = turnKey;
        await this.updateComplete;
        if (!this.isCurrentInitialReadingTarget(target)) return;
        const currentResponse = latestChatResponseStart(this.groupedMessages());
        if (currentResponse === undefined || this.turnRenderKey(currentResponse.turn) !== turnKey) {
          if (currentResponse !== undefined) this.reservedTurnKey = this.turnRenderKey(currentResponse.turn);
          restartAfterRender = true;
          return;
        }
        response = currentResponse;
      }

      const anchorId = this.groupRenderKeyFor(response.group);
      const anchor = this.scrollAnchorElements().find((element) => element.dataset["scrollAnchorId"] === anchorId);
      const chat = this.chat;
      if (chat === undefined || anchor === undefined) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop += anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        this.syncScrollMetrics();
        this.followMode = this.isNearBottom() ? FOLLOW_TAIL : FOLLOW_FREE;
      });
      this.imageLoadScrollSettlement = {
        kind: "anchor",
        sessionId: this.sessionId,
        position: {
          mode: "anchor",
          anchorId,
          offset: anchor.getBoundingClientRect().top - chat.getBoundingClientRect().top,
        },
      };
      this.cancelPrependRestore();
      this.finishInitialReadingTarget(target);
    } finally {
      if (this.applyingInitialReadingTargetId === target.id) this.applyingInitialReadingTargetId = undefined;
      if (restartAfterRender) this.scheduleInitialReadingTarget();
    }
  }

  private isCurrentInitialReadingTarget(target: ChatInitialReadingTarget): boolean {
    return this.initialReadingTarget?.id === target.id;
  }

  private finishInitialReadingTarget(target: ChatInitialReadingTarget): void {
    this.defaultScrollRestoreDeferred = false;
    this.appliedInitialReadingTargetId = target.id;
    this.onInitialReadingTargetApplied?.(target);
  }

  private scheduleSelectedLoadPaintReport(): void {
    const load = this.currentSelectedLoad();
    if (load.kind === "no-target") {
      this.cancelSelectedLoadPaintReport();
      return;
    }
    const { selectedMachineId, sessionId, sessionCwd } = this;
    const token = ++this.selectedLoadPaintToken;
    this.cancelSelectedLoadPaintCallbacks();
    this.selectedLoadPaintFrame = requestAnimationFrame(() => {
      this.selectedLoadPaintFrame = undefined;
      this.selectedLoadPaintTask = window.setTimeout(() => {
        this.selectedLoadPaintTask = undefined;
        if (this.selectedLoadPaintToken !== token || !this.isConnected) return;
        if (this.selectedMachineId !== selectedMachineId || this.sessionId !== sessionId || this.sessionCwd !== sessionCwd || this.selectedLoad !== load) return;
        this.onSelectedLoadPaint?.(load);
      }, 0);
    });
  }

  private cancelSelectedLoadPaintReport(): void {
    this.selectedLoadPaintToken += 1;
    this.cancelSelectedLoadPaintCallbacks();
  }

  private cancelSelectedLoadPaintCallbacks(): void {
    if (this.selectedLoadPaintFrame !== undefined) {
      cancelAnimationFrame(this.selectedLoadPaintFrame);
      this.selectedLoadPaintFrame = undefined;
    }
    if (this.selectedLoadPaintTask !== undefined) {
      window.clearTimeout(this.selectedLoadPaintTask);
      this.selectedLoadPaintTask = undefined;
    }
  }

  private syncImageZoomDialog(): void {
    const dialog = this.imageZoomDialog;
    if (dialog === undefined) return;
    if (this.zoomedImage !== undefined) {
      if (this.imageZoomModalRegistration === undefined) {
        const registration = registerRenderedModal({
          element: dialog,
          nativeTopLayer: true,
          focus: () => {
            const close = this.renderRoot.querySelector<HTMLElement>(".image-zoom-close");
            (close ?? dialog).focus();
          },
        });
        this.imageZoomModalRegistration = registration;
        try {
          if (!dialog.open) dialog.showModal();
        } catch (error) {
          this.imageZoomModalRegistration = undefined;
          registration.unregister();
          throw error;
        }
      }
      this.imageZoomModalRegistration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseImageZoomModal();
  }

  private releaseImageZoomModal(): void {
    const registration = this.imageZoomModalRegistration;
    this.imageZoomModalRegistration = undefined;
    registration?.unregister();
  }

  override render() {
    const groups = this.groupedMessages();
    const liveTailGroup = this.isSessionLive() ? groups[groups.length - 1] : undefined;
    const turns = this.turns();
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class="chat-wrap">
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
          ${this.renderEmptyLoadState(turns.length)}
          ${this.renderHistoryBoundary()}
          ${this.renderReadableLoadNotice()}
          ${repeat(turns, (turn) => this.turnRenderKey(turn), (turn, index) => this.renderTurn(turn, liveTailGroup, index === turns.length - 1))}
          ${turns.length === 0 ? this.renderRunningTurnTail() : null}
        </div>
      </div>
      ${this.renderImageZoom()}
    `;
  }

  private renderTopNotices() {
    const warnings = this.renderWarnings();
    return warnings === null ? null : html`<div class="top-notices">${warnings}</div>`;
  }

  private renderNotificationLiveRegions() {
    const announcements = this.notificationInbox?.sessionId === this.sessionId ? this.notificationInbox.announcements : [];
    const polite = announcements.filter((announcement) => announcement.severity !== "error");
    const assertive = announcements.filter((announcement) => announcement.severity === "error");
    return html`
      <div class="visually-hidden notification-live" aria-live="polite" aria-atomic="false">${repeat(polite, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
      <div class="visually-hidden notification-live" aria-live="assertive" aria-atomic="false">${repeat(assertive, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
    `;
  }

  private renderEmptyLoadState(turnCount: number) {
    const load = this.currentSelectedLoad();
    if (turnCount !== 0) return null;
    if (load.kind === "loading-without-content") {
      return html`
        <section class="chat-load-state empty opening" role="status" aria-live="polite" aria-atomic="true">
          <strong>Opening ${this.chatTitle()}</strong>
          <span>Preparing the transcript.</span>
        </section>
      `;
    }
    if (load.kind === "failed" && !selectedChatHasReadableHistory(load)) {
      return this.renderChatLoadFailure("chat-load-state empty failure");
    }
    if (this.messageTotal === 0 && (load.kind === "fresh-readable" || load.kind === "read-only" || load.kind === "live-ready")) {
      return html`
        <section class="chat-empty-state">
          <strong>No messages yet.</strong>
          <span>This transcript is empty.</span>
        </section>
      `;
    }
    return null;
  }

  private renderReadableLoadNotice() {
    const load = this.currentSelectedLoad();
    if (load.kind === "loading-with-readable-history") {
      return this.renderUpdatingLoadNotice("Updating transcript", "Keeping the readable history on screen.");
    }
    if (load.kind === "cached-readable") {
      return this.renderUpdatingLoadNotice("Showing cached transcript", "Checking for fresh history.");
    }
    if (load.kind === "preview-readable") {
      return this.renderUpdatingLoadNotice("Showing quick transcript preview", "Loading complete history.");
    }
    if (load.kind === "fresh-readable") {
      if (this.messages.length === 0 && this.messageTotal === 0) return null;
      return this.renderUpdatingLoadNotice("Transcript ready", "Opening live controls.");
    }
    if (load.kind === "failed" && selectedChatHasReadableHistory(load)) return this.renderChatLoadFailure("chat-load-state inline failure");
    if (load.kind === "read-only") {
      return html`<div class="chat-load-state inline read-only"><strong>Read-only transcript</strong><span>Archived sessions cannot use live controls.</span></div>`;
    }
    return null;
  }

  private renderUpdatingLoadNotice(heading: string, detail: string) {
    return html`<div class="chat-load-state inline updating" role="status" aria-live="polite" aria-atomic="true"><strong>${heading}</strong><span>${detail}</span></div>`;
  }

  private renderChatLoadFailure(className: string) {
    const load = this.currentSelectedLoad();
    const detail = load.kind === "failed" && load.error !== "" ? load.error : "The selected session did not finish opening.";
    return html`
      <section class=${className} role="alert">
        <strong>Could not finish opening ${this.chatTitle()}</strong>
        <span>${detail}</span>
        ${this.onRetry === undefined ? null : html`<button type="button" class="chat-load-retry" @click=${() => { this.retrySelectedChat(); }}>Retry</button>`}
      </section>
    `;
  }

  private retrySelectedChat(): void {
    if (this.onRetry === undefined) return;
    this.retryFocusPending = true;
    this.onRetry();
  }

  private restoreRetryFocusAfterRetry(): void {
    if (!this.retryFocusPending) return;
    const load = this.currentSelectedLoad();
    if (load.kind === "failed") {
      this.retryFocusPending = false;
      this.retryButton?.focus();
      return;
    }
    if (load.kind === "live-ready" || load.kind === "read-only") this.retryFocusPending = false;
  }

  private currentSelectedLoad(): SelectedChatLoad {
    const load = this.selectedLoad;
    if (load.kind === "no-target") return load;
    return load.target.machineId === this.selectedMachineId
      && load.target.sessionId === this.sessionId
      && load.target.cwd === this.sessionCwd
      ? load
      : selectedChatNoTarget();
  }

  private chatTitle(): string {
    return this.sessionTitle === "" ? this.sessionId : this.sessionTitle;
  }


  private renderWarnings() {
    const rows = chatSessionWarningRows(this.status);
    if (!this.warningsVisible || rows.length === 0) return null;
    return html`
      <aside class="session-warnings" role="alert" aria-live="polite">
        ${this.onToggleWarnings === undefined ? null : html`
          <div class="session-warnings-controls">
            <button
              type="button"
              class="session-warnings-collapse"
              title="Minimise warnings"
              aria-label="Minimise warnings"
              @click=${this.handleToggleWarnings}
            >
              <svg class="session-warnings-collapse-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
              <span>Minimise</span>
            </button>
          </div>
        `}
        ${rows.map((row) => {
          const dismissId = row.dismissId;
          return html`
          <div class=${row.severityClass}>
            <div class="session-warning-head">
              ${renderSessionWarningIcon(row.severity, "session-warning-icon")}
              ${row.source === undefined ? null : html`<span class="session-warning-source">${row.source}</span>`}
            </div>
            <div class="session-warning-body">
              <p class="session-warning-message">${row.message}</p>
              ${row.path === undefined ? null : html`<p class="session-warning-path">${row.path}</p>`}
            </div>
            ${dismissId === undefined ? null : html`
              <button
                type="button"
                class="session-warning-dismiss"
                title="Don't show this warning again"
                aria-label="Dismiss warning"
                @click=${() => { this.onDismissWarning?.(dismissId); }}
              >×</button>
            `}
          </div>
        `;
        })}
      </aside>
    `;
  }

  private renderImageZoom() {
    return html`
      <dialog class="image-zoom" @click=${this.onImageZoomDialogClick} @close=${this.closeImageZoom} @cancel=${this.closeImageZoom}>
        ${this.zoomedImage === undefined ? null : html`
          <button type="button" class="image-zoom-close" aria-label="Close image" @click=${this.closeImageZoom}>×</button>
          <img class="image-zoom-full" src=${this.zoomedImage.src} alt=${this.zoomedImage.alt} />
        `}
      </dialog>
    `;
  }

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(this.messages, this.messageStart);
    this.turnsCache = chatTurns(this.groupedMessagesCache);
    this.foldMetaCache = foldMetaSources(this.groupedMessagesCache);
    return this.groupedMessagesCache;
  }

  private turns(): ChatTurn[] {
    this.groupedMessages();
    return this.turnsCache;
  }

  /**
   * A turn is a box, not just a run of siblings, so the reading position has
   * something to hold at the top of the viewport and the last turn can reserve
   * the space its reply streams into.
   */
  private renderTurn(turn: ChatTurn, liveTailGroup: ChatGroup | undefined, last: boolean) {
    const key = this.turnRenderKey(turn);
    return html`
      <section class="turn" data-turn-key=${key}>
        <div class=${last && key === this.reservedTurnKey ? "turn-body reserved" : "turn-body"}>
          ${repeat(turn.groups, (group) => this.groupRenderKeyFor(group), (group) => this.renderGroup(group, group === liveTailGroup))}
          ${last ? this.renderRunningTurnTail() : null}
        </div>
      </section>
    `;
  }

  /**
   * What the running turn is still doing, and what it is waiting on.
   *
   * These belong to the turn above them, so they render inside it rather than
   * after it. Outside, the space an opening turn reserves fell between the
   * question and its own status line, stranding the line against the foot of the
   * screen. Queued prompts ride along: they are the only thing left that would
   * have been marooned down there.
   */
  private renderRunningTurnTail() {
    return html`
      ${this.renderQueuedMessages()}
      ${this.renderSessionActivity()}
      ${this.renderTranscriptLiveness()}
      ${this.renderOpenAsk()}
      ${this.renderExtensionDialogs()}
    `;
  }

  private renderGroup(group: ChatGroup, live: boolean) {
    if (group.kind === "group") return this.renderMessageGroup(group.messages, group.startIndex, group.endIndex, live);
    if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, group.toolName);
    return this.renderMessage(group.message, group.index);
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private renderQueuedMessages() {
    const serverQueued = this.status?.queuedMessages ?? [];
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, serverQueued, this.sessionLaunchRecovery)
      .map((section) => this.renderQueuedMessageList(section))}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const canClear = chatQueuedSectionShowsClearAction(section, this.onClearServerQueue !== undefined);
    const hasFirstPromptRecovery = section.source === "client" && this.sessionLaunchRecovery !== undefined;
    return html`
      <aside class="queued-messages" aria-live="polite">
        <div class="queued-header">
          <div class="queued-heading">
            <strong>${section.heading}</strong>
            <small>${section.detail}</small>
          </div>
          ${canClear ? html`
            <button type="button" class="queued-clear-button" title="Clear queued messages without stopping active work" @click=${this.handleClearServerQueue}>Clear queue</button>
          ` : null}
        </div>
        ${section.messages.map((message, index) => html`
          <div class=${hasFirstPromptRecovery && index === 0 ? "queued-message first-prompt-recovery" : "queued-message"}>
            <span class="queued-kind">${hasFirstPromptRecovery && index === 0
              ? "First prompt"
              : `${message.kind === "steer" ? "Steer" : "Follow-up"} ${String(index + 1)}`}</span>
            <formatted-text .text=${message.text}></formatted-text>
            ${hasFirstPromptRecovery && index === 0 ? this.renderSessionLaunchRecovery() : null}
          </div>
        `)}
      </aside>
    `;
  }

  private renderSessionLaunchRecovery() {
    const recovery = this.sessionLaunchRecovery;
    if (recovery === undefined) return null;
    const presentation = chatSessionLaunchRecoveryPresentation(recovery);
    const renderedSessionId = this.sessionId;
    return html`
      <section class="session-launch-recovery" aria-label="First prompt recovery">
        <strong>${presentation.heading}</strong>
        <p>${presentation.detail}</p>
        <div class="session-launch-recovery-actions">
          ${presentation.actions.map((action) => html`
            <button
              type="button"
              data-recovery-action=${action.kind}
              ?disabled=${action.disabled}
              @click=${() => { this.activateSessionLaunchRecovery(action.kind, renderedSessionId); }}
            >${action.label}</button>
          `)}
        </div>
      </section>
    `;
  }

  private activateSessionLaunchRecovery(action: ChatSessionLaunchRecoveryActionKind, sessionId: string): void {
    this.onSessionLaunchRecoveryAction?.(sessionId, action);
  }

  private renderOpenAsk() {
    if (this.pendingAsk === undefined) return null;
    return html`
      <ask-user-card
        class="open-ask-card"
        data-scroll-anchor-id=${`ask:${this.pendingAsk.askId}`}
        .ask=${this.pendingAsk}
        .draftSessionId=${this.askDraftSessionId}
        .onSubmit=${this.onSubmitAsk}
      ></ask-user-card>
    `;
  }

  private renderExtensionDialogs() {
    const open = this.pendingDialogs[0];
    if (open === undefined && this.closedDialogs.length === 0) return null;
    const queuedCount = this.pendingDialogs.length - 1;
    return html`
      ${repeat(
        this.closedDialogs,
        (closed) => closed.dialog.dialogId,
        (closed) => html`
          <extension-dialog-card
            class="closed-dialog-card"
            data-scroll-anchor-id=${`closed-dialog:${closed.dialog.dialogId}`}
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
          data-scroll-anchor-id=${`dialog:${open.dialogId}`}
          .dialog=${open}
          .onAnswer=${this.onAnswerDialog}
          .onCancel=${this.onCancelDialog}
        ></extension-dialog-card>
        ${queuedCount > 0
          ? html`<p class="queued-dialogs" role="status">${String(queuedCount)} more extension ${queuedCount === 1 ? "dialog" : "dialogs"} queued</p>`
          : null}
      `}
    `;
  }

  /**
   * The transcript's own answer to "is it running?".
   *
   * On constrained panes the status bar and every other chrome band are gone,
   * so an idle session and a dead one would look identical without this line.
   * It reuses `sessionActivityIndicator` rather than deriving state a second
   * time, so it can never disagree with the status bar where both are visible.
   *
   * Compaction is excluded: `renderSessionActivity` already narrates it in
   * more detail, and two notices for one condition reads as a stutter.
   */
  private renderTranscriptLiveness() {
    if (this.isCompacting) return null;
    const indicator = this.livenessIndicator();
    if (indicator?.active !== true) return null;
    return html`<transcript-liveness
      .startedAt=${this.activeSince ?? ""}
      .step=${livenessStep(this.messages, this.activity, indicator.text)}
    ></transcript-liveness>`;
  }

  private livenessIndicator(): SessionActivityIndicator | undefined {
    return sessionActivityIndicator({ status: this.status, activity: this.activity, isSendingPrompt: this.isSendingPrompt });
  }

  /**
   * When the current stretch of work began.
   *
   * Not `activity.at`: the activity feed republishes on every tool event, so its
   * timestamp is the last thing that happened, and elapsed time computed from it
   * sits at zero for as long as the agent keeps reporting. This latches the
   * first moment the session went active and holds it until it goes idle.
   */
  private trackActiveSince(): void {
    const active = this.livenessIndicator()?.active === true && !this.isCompacting;
    if (active === (this.activeSince !== undefined)) return;
    this.activeSince = active ? new Date().toISOString() : undefined;
  }

  private renderSessionActivity() {
    if (!this.isCompacting) return null;
    return html`
      <aside class="session-activity compacting" aria-live="polite">
        <strong>Compacting history…</strong>
        <span>The agent is summarizing earlier context. New prompts will be queued until compaction finishes.</span>
        ${this.pendingMessageCount > 0 ? html`<small>${this.pendingMessageCount} queued ${this.pendingMessageCount === 1 ? "message" : "messages"}</small>` : null}
      </aside>
    `;
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>Loading earlier messages…</span>${range}</div>`;
    if (this.hasMore) return html`
      <div class="history-boundary">
        <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested} @click=${() => { this.requestLoadMore(); }}>Load earlier messages</button>
        <span>Scroll up to load earlier messages</span>
        ${range}
      </div>
    `;
    if (this.messages.length) return html`<div class="history-boundary"><span>Beginning of session</span>${range}</div>`;
    return null;
  }

  private historyRangeLabel() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const from = this.messageStart + 1;
    const to = this.loadedRawMessageEnd();
    const total = Math.max(this.messageTotal, to);
    return html`<small>Showing messages ${from}–${to} of ${total}</small>`;
  }

  private loadedRawMessageEnd(): number {
    return Math.max(this.messageEnd, this.messageStart + this.messages.length);
  }

  private renderMessage(message: ChatLine, index: number) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    const askUserRecordOnly = this.isAskUserRecordOnlyMessage(message);
    const shellClass = toolOnly ? "msg tool-execution-shell" : "msg ask-user-record-shell";
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class=${toolOnly || askUserRecordOnly ? shellClass : `msg ${message.role}`} data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${toolOnly || askUserRecordOnly ? null : this.renderMessageHeader(message, String(index))}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${this.renderMessageHeader(message, String(index), label)}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private isToolExecutionOnlyMessage(message: ChatLine): boolean {
    return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "toolExecution");
  }

  private isAskUserRecordOnlyMessage(message: ChatLine): boolean {
    return message.parts.length > 0 && message.parts.every((part) => part.type === "askUserRecord");
  }

  /**
   * `live` marks the tail group of a running turn. It selects the group's label
   * and its stable disclosure key, but no longer forces the group open: tool
   * activity streaming into view is the transcript's main source of noise, and
   * the liveness line already reports that work is happening and what it is.
   */
  private renderMessageGroup(messages: ChatLine[], startIndex: number, endIndex: number, live: boolean) {
    const disclosureKey = this.groupDisclosureKey(startIndex, endIndex, live);
    const open = this.disclosures.isOpen(disclosureKey, false);
    return html`
      ${this.renderScrollMarker(this.groupScrollMarkerId(endIndex))}
      <details class=${chatMessageGroupClassName(live)} data-index=${startIndex} data-scroll-anchor-id=${this.groupAnchorKey(startIndex)} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event); }}>
        <summary><span>${summarizeChatGroup(messages)}</span>${this.renderFoldMeta(startIndex)}</summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex) : null}
      </details>
    `;
  }

  private renderMessageGroupBody(messages: ChatLine[], startIndex: number) {
    return html`
      <div class="group-body">
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset} data-scroll-anchor-id=${this.eventAnchorKey(startIndex + offset)}>
              ${toolOnly ? null : this.renderMessageHeader(message, `${String(startIndex)}:${String(offset)}`)}
              ${message.parts.map((part) => this.renderPart(part, message))}
            </section>
          `;
        })}
      </div>
    `;
  }

  private renderScrollMarker(markerId: string) {

    return html`<span class="scroll-marker" data-marker-id=${markerId} aria-hidden="true"></span>`;
  }

  /** A failure reads as a short signal phrase plus plain detail, not a red block. */
  private renderSystemNotice(text: string) {
    const notice = splitChatNotice(text);
    if (notice.lead === "") return html`<p class="part system-notice" dir="auto">${notice.detail}</p>`;
    return html`<p class="part system-notice" dir="auto"><span class="system-notice-lead">${notice.lead}</span> ${notice.detail}</p>`;
  }

  /**
   * A message carries no metadata of its own. The turn's time and model ride on
   * the activity fold that closes the turn, where one line describes the whole
   * answer instead of repeating a constant above every paragraph.
   */
  private renderMessageHeader(message: ChatLine, key: string, label: string = message.role) {
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
        <div class="msg-header-trailing">${this.renderMessageActions(message, key)}</div>
      </div>
    `;
  }

  /** The turn's time and model, sitting opposite its step count. */
  private renderFoldMeta(startIndex: number) {
    const source = this.foldMetaCache.get(startIndex);
    if (source === undefined) return null;
    const meta = this.messageMetaLabel(source);
    const key = `fold:${String(startIndex)}`;
    const expanded = this.expandedMetaKey === key;
    return html`<span
      class=${expanded ? "msg-meta expanded" : "msg-meta"}
      role="button"
      tabindex="0"
      title=${meta}
      aria-label=${meta}
      aria-expanded=${String(expanded)}
      @click=${(event: Event) => { event.preventDefault(); event.stopPropagation(); this.expandedMetaKey = expanded ? undefined : key; }}
      @keydown=${(event: KeyboardEvent) => { event.stopPropagation(); this.onMetaKeydown(event, key, expanded); }}
    >${meta}</span>`;
  }

  private renderMessageActions(message: ChatLine, key: string) {
    if (!this.isCopyableMessage(message)) return null;
    const copied = this.copiedMessageKey === key;
    return html`
      <div class="msg-actions" aria-label="Message actions">
        <button type="button" class="msg-action" title=${copied ? "Copied" : "Copy message"} aria-label=${`${copied ? "Copied" : "Copy"} ${message.role} message`} @click=${(event: MouseEvent) => { void this.copyMessage(message, key, event); }}>
          <span aria-hidden="true">${copied ? "✓" : "⧉"}</span>
        </button>
      </div>
    `;
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
  }

  private isCopyableMessage(message: ChatLine): boolean {
    return (message.role === "user" || message.role === "assistant") && this.messageCopyText(message) !== "";
  }

  private messageCopyText(message: ChatLine): string {
    const cached = this.messageCopyTextCache.get(message);
    if (cached !== undefined) return cached;
    const text = message.parts
      .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter((partText) => partText !== "")
      .join("\n\n");
    this.messageCopyTextCache.set(message, text);
    return text;
  }

  private async copyMessage(message: ChatLine, key: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const copied = await writeClipboardText(this.messageCopyText(message));
    if (!copied) return;
    this.copiedMessageKey = key;
    window.setTimeout(() => {
      if (this.copiedMessageKey === key) this.copiedMessageKey = undefined;
    }, 1200);
  }


  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private renderPart(part: ChatPart, message?: ChatLine) {
    if (part.type === "text" && message?.role === "bash") return html`<pre class="part shell-output">${part.text}</pre>`;
    if (part.type === "text" && message?.role === "system") return this.renderSystemNotice(part.text);
    if (part.type === "text") return html`<formatted-text class="part" .text=${part.text}></formatted-text>`;
    if (part.type === "thinking") return html`<details class="part"><summary>thinking</summary><formatted-text .text=${part.text}></formatted-text></details>`;
    if (part.type === "skillInvocation") return html`
      <details class="part skill-invocation">
        <summary><b>[skill]</b> ${part.name}</summary>
        <small>${part.location}</small>
        <formatted-text .text=${part.content}></formatted-text>
      </details>
    `;
    if (part.type === "skillRead") return html`
      <div class="part skill-read">
        <strong>Loaded ${part.name}</strong>
        <small>read ${part.path}</small>
      </div>
    `;
    if (part.type === "askUserRecord") return html`
      <ask-user-card
        class="part"
        .outcome=${part.outcome}
        .draftSessionId=${this.askDraftSessionId}
      ></ask-user-card>
    `;
    if (part.type === "processNotification") {
      const presentation = processNotificationPresentation(part.kind);
      return html`
        <div class="part process-notification ${presentation.className}">
          <div class="process-notification-header">
            <span class="status-affordance" aria-label=${presentation.label} title=${presentation.label}>${presentation.symbol}</span>
            <strong>${part.processName}</strong>
            <span class="summary">${part.summary}</span>
            ${part.exitCode !== undefined ? html`<span class="exit-code">exit ${part.exitCode}</span>` : null}
          </div>
          <details class="raw-disclosure">
            <summary>raw content</summary>
            <pre class="raw-content">${part.rawContent}</pre>
          </details>
        </div>
      `;
    }
    if (part.type === "image") {
      const { src, alt } = chatImagePartSource(part);
      return html`<img class="part chat-image" src=${src} alt=${alt} loading="lazy" role="button" tabindex="0" title="Click to enlarge" @load=${this.onImageLoad} @click=${() => { this.openImageZoom(src, alt); }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openImageZoom(src, alt); } }} />`;
    }
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part}></tool-execution-view>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        <formatted-text .text=${part.text}></formatted-text>
      </details>
    `;
    return null;
  }

  private onGroupToggle(key: string, event: Event) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (this.disclosures.applyToggle(key, details.open, false)) this.requestUpdate();
  }

  private onScroll() {
    this.requestLoadMoreIfNeeded();
    if (this.updateFollowModeFromScroll() === "reader") this.cancelImageLoadScrollSettlement();
    if (!this.suppressScrollSave) this.scheduleScrollPositionSave();
  }

  private onWheel(event: WheelEvent) {
    this.cancelImageLoadScrollSettlement();
    if (event.deltaY < 0) this.followMode = followModeAfterReaderPullback(this.followMode, this.canScrollUp());
  }

  private onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0]?.clientY;
  }

  private onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY;
    if (this.touchStartY !== undefined && y !== undefined && y !== this.touchStartY) this.cancelImageLoadScrollSettlement();
    if (this.touchStartY !== undefined && y !== undefined && y > this.touchStartY) this.followMode = followModeAfterReaderPullback(this.followMode, this.canScrollUp());
  }

  private updateFollowModeFromScroll(): "component" | "reader" | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    if (this.didChatHeightChange()) {
      this.lastClientHeight = chat.clientHeight;
      if (this.followMode.kind === "tail" && this.initialReadingTarget === undefined && !this.defaultScrollRestoreDeferred) {
        this.scrollToBottom();
        return "component";
      }
      if (this.followMode.kind === "turn") {
        this.alignAnchoredTurn();
        return "component";
      }
    }
    const driver = this.selfScrollTop !== undefined && Math.abs(chat.scrollTop - this.selfScrollTop) < 1 ? "component" : "reader";
    if (driver === "reader") this.selfScrollTop = undefined;
    this.followMode = followModeAfterScroll(this.followMode, {
      atBottom: this.isAtBottom(),
      nearBottom: this.isNearBottom(),
      scrollingUp: chat.scrollTop < this.lastScrollTop,
    }, driver);
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
    return driver;
  }

  private didChatHeightChange(): boolean {
    const chat = this.chat;
    return chat !== undefined && this.lastClientHeight !== 0 && chat.clientHeight !== this.lastClientHeight;
  }

  private isPrependingMessages(changed: Map<string, unknown>): boolean {
    const oldMessageStart = changed.get("messageStart");
    return typeof oldMessageStart === "number" && this.messageStart < oldMessageStart;
  }

  private requestLoadMoreIfNeeded(): void {
    if (this.loadMoreCheckFrame !== undefined) return;
    this.loadMoreCheckFrame = requestAnimationFrame(() => {
      this.loadMoreCheckFrame = undefined;
      if (this.suppressLoadMoreRequests) return;
      const chat = this.chat;
      if (!chat) return;
      if (shouldRequestEarlierMessages({
        hasMore: this.hasMore,
        loadingMore: this.loadingMore || this.loadMoreRequested,
        canRequest: this.onLoadMore !== undefined,
        scrollTop: chat.scrollTop,
        scrollHeight: chat.scrollHeight,
        clientHeight: chat.clientHeight,
      })) this.requestLoadMore();
    });
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested) return;
    if (!this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return isNearScrollBottom(chat);
  }

  private isAtBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return distanceFromScrollBottom(chat) < 2;
  }

  private canScrollUp(): boolean {
    const chat = this.chat;
    return chat !== undefined && chat.scrollTop > 0;
  }

  private scrollToBottom() {
    if (this.scrollToBottomFrame !== undefined) return;
    this.scrollToBottomFrame = requestAnimationFrame(() => {
      this.scrollToBottomFrame = undefined;
      const chat = this.chat;
      if (!chat) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop = chat.scrollHeight;
        this.syncScrollMetrics();
      });
    });
  }

  /**
   * Put the anchored turn's head back at the top of the viewport.
   *
   * Re-applied on every update rather than once when the turn opens, so that a
   * fold expanding above the anchor, or the on-screen keyboard changing the
   * viewport, moves the content rather than the reader's place in it.
   */
  private alignAnchoredTurn(): void {
    if (this.alignAnchoredTurnFrame !== undefined) return;
    this.alignAnchoredTurnFrame = requestAnimationFrame(() => {
      this.alignAnchoredTurnFrame = undefined;
      const chat = this.chat;
      const turn = this.anchoredTurnElement();
      if (chat === undefined || turn === undefined) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop += turn.getBoundingClientRect().top - chat.getBoundingClientRect().top;
        this.syncScrollMetrics();
      });
    });
  }

  private anchoredTurnElement(): HTMLElement | undefined {
    const turnKey = anchoredTurnKey(this.followMode);
    if (turnKey === undefined) return undefined;
    return this.renderRoot.querySelector<HTMLElement>(`.turn[data-turn-key="${CSS.escape(turnKey)}"]`) ?? undefined;
  }

  private isNewPendingAsk(previous: unknown): boolean {
    return this.pendingAsk !== undefined
      && (typeof previous !== "object" || previous === null || Reflect.get(previous, "askId") !== this.pendingAsk.askId);
  }

  private isNewOpenDialog(previous: unknown): boolean {
    const oldest = this.pendingDialogs[0];
    if (oldest === undefined) return false;
    if (!Array.isArray(previous)) return true;
    const previousOldest: unknown = previous[0];
    return typeof previousOldest !== "object" || previousOldest === null || Reflect.get(previousOldest, "dialogId") !== oldest.dialogId;
  }

  private scrollToOpenAsk(): void {
    if (this.scrollToOpenAskFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenAskFrame = requestAnimationFrame(() => {
      this.scrollToOpenAskFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenAskToTop(); });
    });
  }

  private alignOpenAskToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat ask-user-card.open-ask-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.followMode = this.isNearBottom() ? FOLLOW_TAIL : FOLLOW_FREE;
    return true;
  }

  private scrollToOpenDialog(): void {
    if (this.scrollToOpenDialogFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenDialogFrame = requestAnimationFrame(() => {
      this.scrollToOpenDialogFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenDialogToTop(); });
    });
  }

  private alignOpenDialogToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat extension-dialog-card.open-dialog-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.followMode = this.isNearBottom() ? FOLLOW_TAIL : FOLLOW_FREE;
    return true;
  }

  restoreScrollPosition() {
    if (this.initialReadingTarget !== undefined) {
      this.defaultScrollRestoreDeferred = true;
      this.scheduleInitialReadingTarget();
      return;
    }
    this.defaultScrollRestoreDeferred = false;
    const sessionId = this.sessionId;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.restoreDefaultScrollPosition(sessionId);
    });
  }

  private restoreDefaultScrollPosition(sessionId: string): void {
    this.defaultScrollRestoreDeferred = false;
    this.withSuppressedScrollSave(() => {
      if (this.pendingAsk !== undefined && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenAskToTop()) return;
      if (this.pendingDialogs.length > 0 && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenDialogToTop()) return;
      const storedPosition = this.scrollController.readPosition(sessionId);
      const restoredAnchor = storedPosition?.mode === "anchor" ? storedPosition : undefined;
      const result = this.scrollController.restorePosition(sessionId, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
      this.handleScrollRestoreResult(sessionId, result, restoredAnchor);
    });
  }

  private continuePendingScrollRestore(): void {
    const sessionId = this.pendingScrollRestoreSessionId;
    const position = this.pendingScrollRestorePosition;
    if (sessionId === undefined || position === undefined || sessionId !== this.sessionId || this.restoreScrollFrame !== undefined) return;
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        const result = this.scrollController.restoreExplicitPosition(position, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result, position);
      });
    });
  }

  private handleScrollRestoreResult(sessionId: string, result: ChatScrollRestoreResult, restoredAnchor?: ChatAnchorScrollPosition): void {
    this.syncScrollMetrics();
    if (result.status !== "missing") {
      this.imageLoadScrollSettlement = result.status === "restored" && restoredAnchor !== undefined
        ? { kind: "anchor", sessionId, position: restoredAnchor }
        : INACTIVE_IMAGE_LOAD_SCROLL_SETTLEMENT;
      this.updateFollowModeAfterRestore(result.status);
      if (result.status === "restored" || result.status === "bottom") this.cancelPrependRestore();
      this.pendingScrollRestoreSessionId = undefined;
      this.pendingScrollRestorePosition = undefined;
      return;
    }

    this.followMode = FOLLOW_FREE;
    this.pendingScrollRestoreSessionId = sessionId;
    this.pendingScrollRestorePosition = result.position;
    const chat = this.chat;
    if (chat === undefined || !this.hasMore || this.loadingMore) return;
    chat.scrollTop = 0;
    this.syncScrollMetrics();
    this.requestLoadMore();
  }

  private restoreSettlingScrollAnchor(): boolean {
    const settlement = this.imageLoadScrollSettlement;
    if (settlement.kind !== "anchor") return false;
    if (settlement.sessionId !== this.sessionId) {
      this.cancelImageLoadScrollSettlement();
      return false;
    }
    const restored = this.withSuppressedScrollSave(() => {
      const result = this.scrollController.restoreExplicitPosition(settlement.position, this.chat, this.scrollAnchorElements(), { fallbackToBottom: false });
      if (result.status === "restored") this.syncScrollMetrics();
      return result.status === "restored";
    });
    if (!restored) this.cancelImageLoadScrollSettlement();
    return restored;
  }

  private cancelImageLoadScrollSettlement(): void {
    this.imageLoadScrollSettlement = INACTIVE_IMAGE_LOAD_SCROLL_SETTLEMENT;
  }

  private shouldFallbackToBottomForMissingAnchor(): boolean {
    // Only fall back to the bottom once the full history is loaded; while earlier
    // pages can still load, a missing scroll anchor should keep retrying rather
    // than jump the user to the bottom.
    return !this.hasMore;
  }

  private updateFollowModeAfterRestore(status: Exclude<ChatScrollRestoreResult["status"], "missing">): void {
    if (status === "bottom") this.followMode = FOLLOW_TAIL;
    else if (status === "restored") this.followMode = this.isNearBottom() ? FOLLOW_TAIL : FOLLOW_FREE;
  }

  private syncScrollMetrics(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
    this.selfScrollTop = chat.scrollTop;
  }

  private cancelPrependRestore(): void {
    this.prependRestoreToken += 1;
    this.suppressLoadMoreRequests = false;
  }

  capturePrependScrollAnchor(): PrependScrollAnchor | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    return capturePrependScrollAnchor(chat, this.scrollMarkers());
  }

  restorePrependScrollAnchor(anchor: PrependScrollAnchor | undefined): void {
    if (!this.chat || !anchor) return;
    this.suppressLoadMoreRequests = true;
    this.suppressScrollSave = true;
    const token = this.prependRestoreToken + 1;
    this.prependRestoreToken = token;
    let frames = 0;
    const settle = () => {
      const chat = this.chat;
      if (!chat || token !== this.prependRestoreToken) return;
      restorePrependScrollAnchor(chat, anchor, anchor.markerId === undefined ? undefined : this.scrollMarkerAt(anchor.markerId));
      this.lastScrollTop = chat.scrollTop;
      frames += 1;
      // Formatted markdown/code layout can settle after Lit's first render. Re-apply
      // the marker anchor briefly so late height changes above the viewport do not
      // move the user's reading position.
      if (frames < PREPEND_RESTORE_SETTLE_FRAMES) {
        requestAnimationFrame(settle);
        return;
      }
      requestAnimationFrame(() => {
        if (token !== this.prependRestoreToken) return;
        this.suppressScrollSave = false;
        this.suppressLoadMoreRequests = false;
      });
    };
    settle();
  }

  saveScrollPosition(sessionId = this.sessionId) {
    if (!sessionId) return;
    // The shell can ask for a position while a route restore is still in flight,
    // before this view has rendered. A view that has not rendered has no reading
    // position to keep, and it has no render root either, so asking it for its
    // anchors throws inside a promise nobody is waiting on.
    if (!this.hasUpdated) return;
    this.scrollController.savePosition(sessionId, this.chat, this.scrollAnchorElements());
  }

  private scheduleScrollPositionSave() {
    const sessionId = this.sessionId;
    this.scrollController.scheduleSave(sessionId, (scheduledSessionId) => {
      if (this.sessionId === scheduledSessionId) this.saveScrollPosition(scheduledSessionId);
    });
  }

  private scrollMarkers(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".scroll-marker"));
  }

  private scrollMarkerAt(markerId: string): HTMLElement | undefined {
    return this.scrollMarkers().find((marker) => marker.dataset["markerId"] === markerId);
  }

  private articles(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg, details.msg"));
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private withSuppressedScrollSave<Result>(callback: () => Result): Result {
    this.suppressScrollSave = true;
    const result = callback();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.suppressScrollSave = false;
      });
    });
    return result;
  }

  /** The live tail keys on its start, which is stable while events stream in. */
  private groupDisclosureKey(startIndex: number, endIndex: number, live: boolean): string {
    return live ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private messageAnchorKey(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupRenderKeyFor(group: ChatGroup): string {
    return group.kind === "group" ? chatGroupAnchorKey(group.startIndex) : chatMessageAnchorKey(group.index);
  }

  /** A turn is named by its opening group, which is stable while the turn grows. */
  private turnRenderKey(turn: ChatTurn): string {
    const first = turn.groups[0];
    return first === undefined ? "turn:empty" : `turn:${this.groupRenderKeyFor(first)}`;
  }

  private groupAnchorKey(startIndex: number): string {
    return chatGroupAnchorKey(startIndex);
  }

  private eventAnchorKey(index: number): string {
    return chatEventAnchorKey(index);
  }

  private messageScrollMarkerId(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupScrollMarkerId(endIndex: number): string {
    return chatGroupScrollMarkerId(endIndex);
  }

  static override styles = chatStyles;
}
