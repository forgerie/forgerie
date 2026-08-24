import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { chatTurnFlow, chatTurnGalleryImages, chatTurns, groupChatMessages, summarizeChatGroup, turnMetaSource, withoutToolImageGroups, type ChatGroup, type ChatTurn, type ChatTurnGalleryImage } from "../chatGroups";
import { advanceLivenessClock, livenessBeatMs, livenessPhase, livenessStep, replyIsStreaming, type LivenessClock } from "../chatLiveness";
import { turnLedgerRows, turnRailState } from "../turnRail";
import type { SessionActivityIndicator } from "../sessionStatusStrip";
import { splitChatNotice } from "../chatNotices";
import { leadingSlashCommand } from "../slashCommandText";
import "./TranscriptLivenessView";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { selectLiveGrowthAnchor, scrollDeltaForLiveGrowth, type LiveGrowthAnchorMeasurement } from "../chatLiveGrowthAnchoring";
import { ChatScrollCoordinator, type ChatReaderGesture } from "../chatScrollCoordinator";
import { SessionStorageChatReadingPositionStore, chatLineReadingAnchorToken, type ChatAnchorReadingPosition, type ChatReadingIdentity } from "../chatReadingPosition";
import { anchoredReadingPosition, anchoredTurnKey, followAnchor, FOLLOW_FREE, FOLLOW_TAIL } from "../chatFollowMode";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { sessionActivityIndicator } from "../sessionStatusStrip";
import { isNearScrollBottom } from "../chatScrollPosition";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus, SessionWarningSeverity } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { selectedChatCanUseRuntime, selectedChatHasReadableHistory, selectedChatIsOpening, selectedChatNoTarget, type SelectedChatLoad } from "../selectedChatLoad";
import { notificationAnnouncementLabel, type SelectedSessionNotificationView } from "../sessionNotifications";
import type { SessionLaunchRecovery } from "../controllers/sessionController";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import "./FormattedText";
import "./ImageLightbox";
import type { ImageLightbox, ImageLightboxItem } from "./ImageLightbox";
import "./ToolExecutionView";
import "./TurnRailLedger";
import type { TurnRailLedger } from "./TurnRailLedger";
import "./TurnRailSummary";

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const messageDayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const messageDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export interface QueuedMessageSection {
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
}

/**
 * Queued sends that still need explaining: the ones held before the session
 * exists, and the first prompt that needs recovering. Both carry controls or a
 * condition the reader cannot infer from the message itself.
 *
 * The live server queue is deliberately absent. Those messages render as ghosts
 * of the bubbles they are about to become, which says "waiting" without a
 * heading, a counter, and a badge all repeating it.
 */
export function chatQueuedMessageSections(
  clientQueued: QueuedSessionMessage[],
  sessionLaunchRecovery?: SessionLaunchRecovery,
): QueuedMessageSection[] {
  const recoveryClientQueued = sessionLaunchRecovery !== undefined && clientQueued.length === 0
    ? [{ kind: "followUp" as const, text: sessionLaunchRecoveryPreviewText(sessionLaunchRecovery) }]
    : clientQueued;
  if (recoveryClientQueued.length === 0) return [];
  return [sessionLaunchRecovery === undefined
    ? { heading: "Queued until session starts", detail: "Will send once the backend session is ready", messages: recoveryClientQueued }
    : { heading: "First prompt needs attention", detail: "Resolve it before later queued messages can continue", messages: recoveryClientQueued }];
}

/**
 * The label on the ghost stack's only action.
 *
 * The action clears the entire server queue, so it promises to remove "the"
 * message only when one message is all there is to lose.
 */
export function chatQueuedGhostActionLabel(queuedCount: number): string {
  return queuedCount === 1 ? "remove" : "clear all";
}

function sessionLaunchRecoveryPreviewText(recovery: SessionLaunchRecovery): string {
  const attachmentText = sessionLaunchRecoveryAttachmentSummary(recovery.attachments);
  return attachmentText === undefined ? "[First prompt retained privately]" : `[First prompt retained privately]\n\n${attachmentText}`;
}

function sessionLaunchRecoveryAttachmentSummary(attachments: SessionLaunchRecovery["attachments"]): string | undefined {
  if (attachments === undefined || attachments.length === 0) return undefined;
  const names = attachments.map((attachment) => attachment.name?.trim()).filter((name): name is string => name !== undefined && name !== "");
  const count = attachments.length;
  const label = `${String(count)} ${count === 1 ? "attachment" : "attachments"}`;
  if (names.length === 0) return `[${label} queued]`;
  const shownNames = names.slice(0, 3).join(", ");
  const suffix = names.length > 3 ? `, +${String(names.length - 3)} more` : "";
  return `[${label} queued: ${shownNames}${suffix}]`;
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
    const needsValidation = recovery.requiresPromptResourceValidation === true;
    return {
      heading: "Session creation failed",
      detail: needsValidation
        ? "The edited slash command must be validated again before session creation. Change destination to review and send it."
        : "The session was not created, so the first prompt was not sent. Any later queued messages wait behind it.",
      actions: [
        ...(needsValidation ? [] : [{ kind: "retry" as const, label: recovery.retrying ? "Retrying…" : "Retry", disabled: recovery.retrying }]),
        { kind: "changeDestination", label: "Change destination", disabled: recovery.retrying },
      ],
    };
  }
  if (recovery.stage === "promptConfirmedUnsent") {
    const needsValidation = recovery.requiresPromptResourceValidation === true;
    return {
      heading: "First prompt not sent",
      detail: needsValidation
        ? "The prompt resource changed or remained unavailable after retry. Change destination to validate it again."
        : "The session exists, but the first prompt was confirmed unsent. Any later queued messages wait behind it.",
      actions: needsValidation
        ? [{ kind: "changeDestination", label: "Change destination", disabled: false }]
        : [{ kind: "retry", label: recovery.retrying ? "Retrying…" : "Retry", disabled: recovery.retrying }],
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

export function chatMessageMetadataLabel(message: ChatLine, now: Date = new Date()): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp, now);
  const model = chatMessageModelLabel(message);
  const effort = message.meta?.thinkingLevel;
  const parts = [time, model, effort === undefined || effort === "" ? undefined : `${effort} effort`]
    .filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? "No Pi message metadata available" : parts.join(" · ");
}

/*
 * The meta line is glanced at, not read: today's messages carry only a time,
 * this year's carry month and day, and only other years spend space on the
 * full date. `now` is a parameter so the boundary is testable.
 */
export function formatMessageTimestamp(timestamp: string, now: Date = new Date()): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return messageTimeFormatter.format(date);
  const day = date.getFullYear() === now.getFullYear() ? messageDayFormatter.format(date) : messageDateFormatter.format(date);
  return `${day}, ${messageTimeFormatter.format(date)}`;
}

const MODEL_WORD_CAPS: Record<string, string> = { gpt: "GPT", glm: "GLM", ai: "AI", api: "API" };
const CHAT_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/*
 * A transcript answers "which model said this"; the provider route is
 * plumbing and stays out of the line. Dashed ids read as names:
 * claude-fable-5 -> Claude Fable 5, gpt-5.6-sol -> GPT 5.6 Sol.
 */
export function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return humanizeModelId(id);
}

function humanizeModelId(id: string): string {
  return id.split("-").map((word) => {
    const cap = MODEL_WORD_CAPS[word.toLowerCase()];
    if (cap !== undefined) return cap;
    const first = word[0];
    if (first === undefined || /^[0-9]/.test(word)) return word;
    return first.toUpperCase() + word.slice(1);
  }).join(" ");
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
  @property({ attribute: false }) onStopActiveWork?: () => void;
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  @property({ attribute: false }) onRetry?: () => void;
  @property({ attribute: false }) onSelectedLoadPaint?: (load: SelectedChatLoad) => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query(".chat-load-retry") private retryButton?: HTMLButtonElement;
  @query("image-lightbox") private imageLightbox?: ImageLightbox;
  /**
   * The turn whose reserved space is still standing.
   *
   * It outlives the anchor on purpose. Taking the space back the moment the
   * reader returns to the tail would pull the reply they are reading up the
   * screen; the space is only reclaimed when the next turn opens and takes it.
   */
  @state() private reservedTurnKey: string | undefined;
  @state() private expandedMetaKey: string | undefined;
  /**
   * Rails the reader has opened, by rail key. Expansion is per-turn state that
   * lives as long as the session view does -- not a preference, so it is
   * deliberately not persisted.
   */
  @state() private expandedRails: ReadonlySet<string> = new Set();
  /** Turn age, step age, and activity silence for the current live phase. */
  @state() private livenessClock: LivenessClock | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrolling = new ChatScrollCoordinator();
  private readonly readingPositions = new SessionStorageChatReadingPositionStore();
  private pendingReadingPosition: ChatAnchorReadingPosition | undefined;
  private pendingReadingIdentity: ChatReadingIdentity | undefined;
  private readingPositionLoadStart: number | undefined;
  private readingPositionLoadBlockedAtStart: number | undefined;
  private loadMoreCheckFrame: number | undefined;
  /** Invalidates an older deferred anchor restore when another render wins. */
  private liveGrowthRestoreEpoch = 0;
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private turnsCache: ChatTurn[] = [];
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private selectedLoadPaintToken = 0;
  private selectedLoadPaintFrame: number | undefined;
  private selectedLoadPaintTask: number | undefined;
  private lastSeenTurnKey: string | undefined;
  private lastSeenTurnCount = 0;
  private turnTrackingReady = false;
  private sentFromHere = false;
  private loadingScrollReaderOwned = false;
  private readerHistoryPagingEnabled = false;
  private sessionOpeningStartedThisUpdate = false;
  private sessionOpeningHistoryThisUpdate = false;
  @state() private loadMoreRequested = false;
  private retryFocusPending = false;
  private readonly onViewportResize = () => {
    // A resize reshapes the canvas, and the reservation tracks the viewport
    // height, so an idle turn's leftover space would grow with it instead of
    // handing the new area to content. Reclaim it; a turn whose reply is still
    // arriving keeps its space, because the reply is streaming into it.
    if (!this.isSessionLive()) this.reservedTurnKey = undefined;
    if (this.scrolling.mode.kind === "tail") this.scrollToBottom();
    else if (this.scrolling.mode.kind === "turn") this.alignAnchoredTurn();
    else if (this.scrolling.mode.kind === "anchor") this.scheduleCurrentFollowTarget();
    else if (this.chat !== undefined) this.scrolling.syncViewportSize(this.chat);
  };
  private readonly openImageZoom = (images: readonly ImageLightboxItem[], index = 0): void => {
    this.imageLightbox?.open(images, index);
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };
  private readonly onPageHide = (): void => {
    this.rememberReadingPosition();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  protected override firstUpdated(): void {
    if (this.chat !== undefined) this.scrolling.syncViewportSize(this.chat);
    this.scheduleSelectedLoadPaintReport();
  }

  override disconnectedCallback(): void {
    this.rememberReadingPosition();
    this.scrolling.dispose();
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    this.cancelSelectedLoadPaintReport();
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private sessionIdentityChanged(changed: { has(key: string): boolean }): boolean {
    return changed.has("sessionId") || changed.has("selectedMachineId") || changed.has("sessionCwd");
  }

  private readingIdentity(): ChatReadingIdentity {
    return { machineId: this.selectedMachineId, cwd: this.sessionCwd, sessionId: this.sessionId };
  }

  private previousReadingIdentity(changed: PropertyValues<this>): ChatReadingIdentity {
    const machineId = changed.has("selectedMachineId") ? changed.get("selectedMachineId") : this.selectedMachineId;
    const cwd = changed.has("sessionCwd") ? changed.get("sessionCwd") : this.sessionCwd;
    const sessionId = changed.has("sessionId") ? changed.get("sessionId") : this.sessionId;
    return {
      machineId: typeof machineId === "string" ? machineId : "",
      cwd: typeof cwd === "string" ? cwd : "",
      sessionId: typeof sessionId === "string" ? sessionId : "",
    };
  }

  private rememberReadingPosition(identity = this.readingIdentity()): void {
    if (!this.hasUpdated || identity.sessionId === "") return;
    this.readingPositions.remember(identity, this.chat, this.scrollAnchorElements());
  }

  private currentPendingReadingPosition(): ChatAnchorReadingPosition | undefined {
    const identity = this.pendingReadingIdentity;
    return identity?.machineId === this.selectedMachineId
      && identity.cwd === this.sessionCwd
      && identity.sessionId === this.sessionId
      ? this.pendingReadingPosition
      : undefined;
  }

  private prepareSessionUiState(): void {
    this.disclosures.syncSession(this.sessionId);
    this.prepareSessionOpeningScrollState();
    this.clearPendingReadingPosition();
    const identity = this.readingIdentity();
    this.pendingReadingPosition = this.readingPositions.read(identity);
    this.pendingReadingIdentity = this.pendingReadingPosition === undefined ? undefined : identity;
    this.retryFocusPending = false;
    this.cancelSelectedLoadPaintReport();
  }

  private prepareSessionOpeningScrollState(): void {
    this.scrolling.reset();
    this.loadingScrollReaderOwned = false;
    this.readerHistoryPagingEnabled = false;
    this.turnTrackingReady = false;
    this.lastSeenTurnCount = 0;
    this.sentFromHere = false;
    this.reservedTurnKey = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const identityChanged = this.sessionIdentityChanged(changed);
    if (identityChanged) {
      this.rememberReadingPosition(this.previousReadingIdentity(changed));
      this.livenessClock = undefined;
      this.prepareSessionUiState();
    }
    this.trackLivenessClock();
    if (changed.has("isSendingPrompt") && this.isSendingPrompt) this.sentFromHere = true;
    const previousSelectedLoad = changed.get("selectedLoad");
    const currentSelectedLoad = this.currentSelectedLoad();
    const beginsOpeningAttempt = currentSelectedLoad.kind === "loading-without-content" || currentSelectedLoad.kind === "cached-readable";
    const openingStarted = changed.has("selectedLoad")
      && selectedChatIsOpening(currentSelectedLoad)
      && (beginsOpeningAttempt || previousSelectedLoad === undefined || !selectedChatIsOpening(previousSelectedLoad));
    this.sessionOpeningStartedThisUpdate = openingStarted;
    if (openingStarted && !identityChanged) this.prepareSessionOpeningScrollState();
    if (changed.has("selectedLoad") && selectedChatIsOpening(this.currentSelectedLoad())) this.readerHistoryPagingEnabled = false;
    const openingHistory = selectedChatIsOpening(this.selectedLoad)
      || (previousSelectedLoad !== undefined && selectedChatIsOpening(previousSelectedLoad));
    this.sessionOpeningHistoryThisUpdate = openingHistory;
    this.trackOpenedTurn(!openingHistory);
  }

  /**
   * A turn opening at the foot of the transcript takes the reading position.
   *
   * A transcript arriving all at once is not a turn opening. Only growth from
   * a transcript that was already on screen counts, or the first turn of a
   * session that had none.
   */
  private trackOpenedTurn(allowAnchor = true): void {
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
    if (last?.openedByIndex === undefined) return;
    const sentFromHere = this.sentFromHere;
    this.sentFromHere = false;
    if (!sentFromHere && (!allowAnchor || (seen === 0 && turns.length > 1))) return;
    if (!this.scrolling.followOpenedTurn(key, sentFromHere)) return;
    this.reservedTurnKey = key;
  }

  protected override update(changed: Map<string, unknown>): void {
    const prepending = this.isPrependingMessages(changed);
    const prependAnchor = prepending ? this.capturePrependScrollAnchor() : undefined;
    const liveGrowthAnchor = !prepending && this.shouldAnchorLiveLedgerGrowth(changed)
      ? this.captureLiveGrowthAnchor()
      : undefined;
    super.update(changed);
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
    else if (liveGrowthAnchor !== undefined) this.restoreLiveGrowthAnchor(liveGrowthAnchor);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) {
      this.loadMoreRequested = false;
      this.finishReadingPositionHistoryLoad();
    }
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    const identityChanged = this.sessionIdentityChanged(changed);
    if (identityChanged || this.sessionOpeningStartedThisUpdate) {
      this.cancelSelectedLoadPaintReport();
      if (this.currentPendingReadingPosition() !== undefined) this.continuePendingReadingPosition();
      else this.openAtBottom();
    }
    const openedAsk = changed.has("pendingAsk") && this.isNewPendingAsk(changed.get("pendingAsk"));
    const openedDialog = changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs"));
    const followingLiveTail = this.scrolling.mode.kind === "tail" || this.scrolling.mode.kind === "turn";
    const contentChanged = changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs");
    // The form uses the transcript scroller. Start a new long form at question
    // one rather than applying the usual live-tail scroll and landing at its end.
    // During session opening, however, every arriving fragment keeps the tail:
    // an opening prompt must not turn a layout race into a saved reading place.
    if (!identityChanged && !this.sessionOpeningHistoryThisUpdate && openedAsk && followingLiveTail) {
      this.scrollToOpenAsk();
    } else if (!identityChanged && !this.sessionOpeningHistoryThisUpdate && openedDialog && followingLiveTail) {
      this.scrollToOpenDialog();
    } else if (!identityChanged && contentChanged) {
      this.scheduleCurrentFollowTarget();
    }
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("selectedLoad") || changed.has("status") || changed.has("onLoadMore")) this.continuePendingReadingPosition();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    if (changed.has("selectedMachineId") || changed.has("sessionCwd")) {
      this.cancelSelectedLoadPaintReport();
      if (!changed.has("selectedLoad")) this.scheduleSelectedLoadPaintReport();
    }
    if (changed.has("selectedLoad")) {
      this.restoreRetryFocusAfterRetry();
      this.scheduleSelectedLoadPaintReport();
    }
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

  override render() {
    const groups = this.groupedMessages();
    const liveTailGroup = this.isSessionLive() ? groups[groups.length - 1] : undefined;
    const turns = this.turns();
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class="chat-wrap">
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }} @keydown=${(event: KeyboardEvent) => { this.onScrollKeyDown(event); }} @pointerdown=${(event: PointerEvent) => { this.onScrollPointerDown(event); }}>
          ${this.renderEmptyLoadState(turns.length)}
          ${this.renderHistoryBoundary()}
          ${this.renderReadableLoadNotice()}
          ${repeat(turns, (turn) => this.turnRenderKey(turn), (turn, index) => this.renderTurn(turn, liveTailGroup, index === turns.length - 1))}
          ${turns.length === 0 ? this.renderRunningTurnTail() : null}
        </div>
      </div>
      <image-lightbox></image-lightbox>
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

  private groupedMessages(): ChatGroup[] {
    if (this.groupedMessagesInput === this.messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = this.messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(this.messages, this.messageStart);
    this.turnsCache = chatTurns(this.groupedMessagesCache);
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
    const readingAnchor = this.turnReadingAnchor(turn);
    const turnClosed = !(last && this.isSessionLive());
    const replySettled = !(last && this.latestReplyIsStreaming());
    const flow = chatTurnFlow(turn, replySettled);
    const work = withoutToolImageGroups(flow.work);
    const continuation = withoutToolImageGroups(flow.continuation);
    const galleryImages = chatTurnGalleryImages(turn);
    const continuationClosesTurn = turnClosed && continuation.length > 0;
    return html`
      <section class="turn" data-turn-key=${key} data-scroll-anchor-id=${readingAnchor.id} data-scroll-anchor-aliases=${readingAnchor.aliases.length === 0 ? undefined : JSON.stringify(readingAnchor.aliases)}>
        <div class=${last && key === this.reservedTurnKey ? "turn-body reserved" : "turn-body"}>
          ${flow.opener === undefined ? null : this.renderGroup(flow.opener, flow.opener === liveTailGroup)}
          ${this.renderTurnRail(work, liveTailGroup, turnClosed && !continuationClosesTurn ? { turn, key } : undefined, !turnClosed && continuation.length === 0, `${key}:work`)}
          ${flow.answer === undefined ? null : this.renderGroup(flow.answer, flow.answer === liveTailGroup)}
          ${this.renderTurnImageGallery(galleryImages)}
          ${this.renderTurnRail(continuation, liveTailGroup, continuationClosesTurn ? { turn, key } : undefined, !turnClosed, `${key}:continuation`)}
          ${last ? this.renderRunningTurnTail() : null}
        </div>
      </section>
    `;
  }

  private renderTurnImageGallery(images: readonly ChatTurnGalleryImage[]) {
    if (images.length === 0) return null;
    const zoomImages = images.map((image, index) => this.turnGalleryZoomImage(image, index, images.length));
    const hasOverflow = images.length > 5;
    const visible = hasOverflow ? images.slice(0, 4) : images;
    const overflow = hasOverflow ? images.length - visible.length : 0;
    const label = `${String(images.length)} ${images.length === 1 ? "image" : "images"} from this turn`;
    const uniqueMessageIndexes = [...new Set(images.map((image) => image.messageIndex))];
    return html`
      ${uniqueMessageIndexes.map((index) => this.renderScrollMarker(this.messageScrollMarkerId(index)))}
      <section class="turn-image-gallery" aria-label=${label}>
        <div class="turn-image-gallery-head">
          <strong>${String(images.length)} ${images.length === 1 ? "image" : "images"}</strong>
          <span>from this turn</span>
        </div>
        <div class="turn-image-gallery-strip">
          ${repeat(visible, (image) => `${String(image.messageIndex)}:${String(image.partIndex)}`, (image, index) => this.renderTurnGalleryThumbnail(image, index, zoomImages))}
          ${overflow === 0 ? null : html`
            <button
              type="button"
              class="turn-image-gallery-more"
              aria-label=${`Open ${String(overflow)} more images from this turn`}
              @click=${() => { this.openImageZoom(zoomImages, visible.length); }}
            >+${String(overflow)}</button>
          `}
        </div>
      </section>
    `;
  }

  private renderTurnGalleryThumbnail(image: ChatTurnGalleryImage, index: number, zoomImages: readonly ImageLightboxItem[]) {
    const zoomImage = zoomImages[index];
    if (zoomImage === undefined) return null;
    return html`
      <button
        type="button"
        class="turn-image-gallery-thumb"
        data-index=${image.messageIndex}
        aria-label=${`Open ${zoomImage.alt}`}
        @click=${() => { this.openImageZoom(zoomImages, index); }}
      ><img src=${zoomImage.src} alt="" loading="lazy" /></button>
    `;
  }

  private turnGalleryZoomImage(image: ChatTurnGalleryImage, index: number, total: number): ImageLightboxItem {
    const { src } = chatImagePartSource(image.part);
    return { src, alt: `${chatToolOutputLabel(image.toolName)}, image ${String(index + 1)} of ${String(total)}` };
  }

  /**
   * The turn's work, said once.
   *
   * The rail leads with the collapsed register -- a heartbeat while the turn
   * runs, a receipt once it ends -- and keeps the step ledger behind it. The
   * ledger stays in the DOM while hidden so opening it costs no re-render and
   * steals no scroll position; a turn whose steps carry no tool executions has
   * nothing to summarise and shows the ledger as before.
   */
  private renderTurnRail(
    groups: readonly ChatGroup[],
    liveTailGroup: ChatGroup | undefined,
    meta: { readonly turn: ChatTurn; readonly key: string } | undefined,
    live: boolean,
    railKey: string,
  ) {
    if (groups.length === 0) return null;
    const state = turnRailState(groups, live);
    const rows = turnLedgerRows(groups);
    const open = state.kind === "idle" || this.expandedRails.has(railKey);
    return html`
      <div class="turn-rail">
        ${state.kind === "idle" ? null : html`<turn-rail-summary
          .state=${state}
          .startedAt=${live ? this.livenessClock?.turnStartedAt ?? "" : ""}
          ?open=${open}
          @rail-toggle=${() => { this.toggleRail(railKey); }}
        ></turn-rail-summary>`}
        <div class="rail-ledger" ?hidden=${!open}>
          ${rows.length === 0
            ? repeat(groups, (group) => this.groupRenderKeyFor(group), (group) => this.renderGroup(group, group === liveTailGroup, true))
            : html`
              <turn-rail-ledger .rows=${rows}></turn-rail-ledger>
              <details class="rail-full-activity">
                <summary>Thinking and other activity</summary>
                <div class="rail-full-activity-body">
                  ${repeat(groups, (group) => this.groupRenderKeyFor(group), (group) => this.renderGroup(group, group === liveTailGroup, true))}
                </div>
              </details>
            `}
        </div>
        <span class="rail-growth-anchor" data-rail-growth-anchor=${railKey} aria-hidden="true"></span>
        ${meta === undefined ? null : this.renderRailMeta(meta.turn, meta.key)}
      </div>
    `;
  }

  private toggleRail(railKey: string): void {
    const next = new Set(this.expandedRails);
    if (!next.delete(railKey)) next.add(railKey);
    this.expandedRails = next;
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
      ${this.renderTranscriptLiveness()}
      ${this.renderQueuedGhosts()}
      ${this.renderOpenAsk()}
      ${this.renderExtensionDialogs()}
    `;
  }

  private renderGroup(group: ChatGroup, live: boolean, interim = false) {
    if (group.kind === "group") return this.renderMessageGroup(group.messages, group.startIndex, group.endIndex, live);
    if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, group.toolName);
    return this.renderMessage(group.message, group.index, interim);
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  private latestReplyIsStreaming(): boolean {
    return replyIsStreaming({
      isStreaming: this.status?.isStreaming === true,
      isCompacting: this.isCompacting || this.status?.isCompacting === true,
      isBashRunning: this.status?.isBashRunning === true,
      awaitingUserInput: this.pendingAsk !== undefined || this.pendingDialogs.length > 0,
      activity: this.activity,
    });
  }

  private renderQueuedMessages() {
    return html`${chatQueuedMessageSections(this.clientQueuedMessages, this.sessionLaunchRecovery)
      .map((section) => this.renderQueuedMessageList(section))}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection) {
    const hasFirstPromptRecovery = this.sessionLaunchRecovery !== undefined;
    return html`
      <aside class="queued-messages" aria-live="polite">
        <div class="queued-heading">
          <strong>${section.heading}</strong>
          <small>${section.detail}</small>
        </div>
        ${section.messages.map((message, index) => html`
          <div class=${hasFirstPromptRecovery && index === 0 ? "queued-message first-prompt-recovery" : "queued-message"}>
            <span class="queued-kind">${hasFirstPromptRecovery && index === 0
              ? "First prompt"
              : `${message.kind === "steer" ? "Steer" : "Follow-up"} ${String(index + 1)}`}</span>
            ${this.renderQueuedMessageBody(message.text)}
            ${hasFirstPromptRecovery && index === 0 ? this.renderSessionLaunchRecovery() : null}
          </div>
        `)}
      </aside>
    `;
  }

  /**
   * A queued command is going to run, not read as prose — so its ghost wears
   * the command mark the completion menu introduced, and only argument text
   * stays ordinary.
   */
  private renderQueuedMessageBody(text: string) {
    const command = leadingSlashCommand(text);
    if (command === undefined) return html`<formatted-text .text=${text}></formatted-text>`;
    return html`
      <div class="queued-command">
        <span class="command-mark"><span class="command-sigil">/</span><span class="command-name">${command.name}</span></span>
        ${command.rest === "" ? null : html`<span class="queued-command-rest">${command.rest}</span>`}
      </div>
    `;
  }

  /**
   * The server queue, drawn as ghosts of the messages it will become.
   *
   * A queued message is the same message, in the same place, not yet sent. It
   * shows itself in the bubble it is about to occupy, so nothing has to count
   * it, head it, or badge it. The one word of state and the one action sit in
   * the slot a sent message uses for its timestamp, out of the reading line.
   */
  private renderQueuedGhosts() {
    const queued = this.status?.queuedMessages ?? [];
    if (queued.length === 0) return null;
    return html`
      <aside class="queued-ghosts" aria-live="polite" aria-label="Queued messages">
        ${queued.map((message) => html`
          <div class="queued-ghost">${this.renderQueuedMessageBody(message.text)}</div>
        `)}
        <p class="queued-ghost-meta">
          <span>queued</span>
          ${this.onClearServerQueue === undefined ? null : html`
            <button type="button" class="queued-ghost-clear" title="Clear queued messages without stopping active work" @click=${this.handleClearServerQueue}>${chatQueuedGhostActionLabel(queued.length)}</button>
          `}
        </p>
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
   * Compaction reports here too. It is a stretch of work like any other, and a
   * second notice explaining it in prose only said twice what this line says
   * once.
   */
  private renderTranscriptLiveness() {
    const step = this.livenessStepText();
    if (step === undefined) return null;
    return html`<transcript-liveness
      .startedAt=${this.livenessClock?.stepStartedAt ?? ""}
      .lastActivityAt=${this.livenessClock?.lastActivityAt ?? ""}
      .stuckAfterMs=${livenessBeatMs(step)}
      .step=${step}
      .onStop=${selectedChatCanUseRuntime(this.currentSelectedLoad()) ? this.onStopActiveWork : undefined}
    ></transcript-liveness>`;
  }

  /**
   * What the liveness line names as the current step.
   *
   * Compaction names itself instead of deferring to `livenessStep`, whose
   * newest-tool-call preference would otherwise show the finished turn's last
   * tool while the agent is summarizing.
   */
  private livenessStepText(): string | undefined {
    if (this.isCompacting) return "compacting history";
    const indicator = this.livenessIndicator();
    if (indicator?.active !== true) return undefined;
    return livenessStep(this.messages, this.activity, indicator.text);
  }

  private livenessIndicator(): SessionActivityIndicator | undefined {
    return sessionActivityIndicator({ status: this.status, activity: this.activity, isSendingPrompt: this.isSendingPrompt });
  }

  /**
   * Advance the three clocks without asking ChatView's transcript to tick.
   *
   * The turn clock survives tool changes. The step clock resets when the
   * reader-visible step changes. Activity timestamps refresh only the silence
   * clock. TranscriptLivenessView owns the one-second timer, so hundreds of
   * historical message groups still do no work when a second passes.
   */
  private trackLivenessClock(): void {
    const phase = livenessPhase({ isCompacting: this.isCompacting, indicatorActive: this.livenessIndicator()?.active === true });
    const step = this.livenessStepText() ?? "";
    this.livenessClock = advanceLivenessClock(this.livenessClock, {
      phase,
      step,
      ...(phase === "working" && this.activity?.at !== undefined ? { activityAt: this.activity.at } : {}),
    }, new Date().toISOString());
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>Loading earlier messages…</span>${range}</div>`;
    if (this.hasMore) {
      const sessionLive = this.isSessionLive();
      return html`
        <div class="history-boundary">
          <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested || sessionLive} @click=${() => { this.requestLoadMore(); }}>Load earlier messages</button>
          <span>${sessionLive ? "Earlier messages are available when current work finishes" : "Scroll up to load earlier messages"}</span>
          ${range}
        </div>
      `;
    }
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

  private renderMessage(message: ChatLine, index: number, interim = false) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    const askUserRecordOnly = this.isAskUserRecordOnlyMessage(message);
    const shellClass = toolOnly ? "msg tool-execution-shell" : "msg ask-user-record-shell";
    // Only assistant prose takes the interim register: narration on the rail
    // reads as the working voice, while cards and shell output keep their own
    // dress inside it.
    const roleClass = interim && message.role === "assistant" ? "msg assistant interim" : `msg ${message.role}`;
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class=${toolOnly || askUserRecordOnly ? shellClass : roleClass} data-index=${index} data-scroll-anchor-id=${this.messageReadingAnchorKey(message, index)}>
        ${toolOnly || askUserRecordOnly ? null : this.renderMessageHeader(message)}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${this.messageReadingAnchorKey(message, index)}>
        ${this.renderMessageHeader(message, label)}
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
   * Whether the message's parts already say who they are.
   *
   * A process notification leads with its process name and a skill read leads
   * with the skill's, so the role label above them contributed only the word
   * SYSTEM or ASSISTANT -- a heading that names nothing the reader cannot
   * already see one line below it.
   */
  private isSelfLabellingMessage(message: ChatLine): boolean {
    return message.parts.length > 0
      && message.parts.every((part) => part.type === "processNotification" || part.type === "skillRead");
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
      <details class=${chatMessageGroupClassName(live)} data-index=${startIndex} data-scroll-anchor-id=${this.groupReadingAnchorKey(messages, startIndex, live)} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event); }}>
        <summary><span>${summarizeChatGroup(messages)}</span></summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex) : null}
      </details>
    `;
  }

  private renderMessageGroupBody(messages: ChatLine[], startIndex: number) {
    return html`
      <div class="group-body">
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          const selfLabelling = this.isSelfLabellingMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset} data-scroll-anchor-id=${this.eventReadingAnchorKey(message, startIndex + offset)}>
              ${toolOnly || selfLabelling ? null : this.renderMessageHeader(message)}
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
  private renderMessageHeader(message: ChatLine, label: string = message.role) {
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
      </div>
    `;
  }

  /** The turn's time and model, closing the rail below the work it describes. */
  private renderRailMeta(turn: ChatTurn, turnKey: string) {
    const source = turnMetaSource(turn);
    if (source === undefined) return null;
    const meta = this.messageMetaLabel(source);
    const key = `rail:${turnKey}`;
    const expanded = this.expandedMetaKey === key;
    return html`<p class="rail-meta"><span
      class=${expanded ? "msg-meta expanded" : "msg-meta"}
      role="button"
      tabindex="0"
      title=${meta}
      aria-label=${meta}
      aria-expanded=${String(expanded)}
      @click=${(event: Event) => { event.preventDefault(); event.stopPropagation(); this.expandedMetaKey = expanded ? undefined : key; }}
      @keydown=${(event: KeyboardEvent) => { event.stopPropagation(); this.onMetaKeydown(event, key, expanded); }}
    >${meta}</span></p>`;
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
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
      // No `@load` re-pin: the band reserves its height in CSS, so a late
      // decode changes nothing the reading position depends on.
      return html`<img class="part chat-image" src=${src} alt=${alt} loading="lazy" role="button" tabindex="0" title="Open full-screen image" @click=${() => { this.openImageZoom([{ src, alt }]); }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openImageZoom([{ src, alt }]); } }} />`;
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
    const chat = this.chat;
    if (chat !== undefined) {
      const update = this.scrolling.recordScroll(chat, false);
      if (this.scrolling.mode.kind !== "free") this.readerHistoryPagingEnabled = false;
      if (update.viewportChanged) this.scheduleCurrentFollowTarget();
    }
  }

  private onScrollKeyDown(event: KeyboardEvent): void {
    if (!CHAT_SCROLL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    this.acceptDirectReaderScrollIntent();
  }

  private onScrollPointerDown(event: PointerEvent): void {
    const chat = this.chat;
    if (chat === undefined || event.target !== chat) return;
    const gutterWidth = Math.max(0, chat.offsetWidth - chat.clientWidth);
    if (gutterWidth === 0) return;
    const bounds = chat.getBoundingClientRect();
    const inScrollbarGutter = event.clientX <= bounds.left + gutterWidth || event.clientX >= bounds.right - gutterWidth;
    if (inScrollbarGutter) this.acceptDirectReaderScrollIntent();
  }

  private acceptDirectReaderScrollIntent(): void {
    this.scrolling.cancelAutomaticMotion();
    this.scrolling.follow(FOLLOW_FREE);
    this.clearPendingReadingPosition();
  }

  private onWheel(event: WheelEvent) {
    const forceTakeover = this.shouldForceReaderScrollTakeover();
    const gesture = this.scrolling.readerWheel(event.deltaY, this.canScrollUp(), forceTakeover);
    if (gesture === undefined) return;
    if (forceTakeover) {
      this.readerHistoryPagingEnabled = false;
      if (gesture.readerOwned) this.acceptReaderScrollTakeover();
      return;
    }
    this.applyReaderHistoryPagingGesture(gesture);
  }

  private onTouchStart(event: TouchEvent) {
    this.scrolling.readerTouchStart(event.touches[0]?.clientY);
  }

  private onTouchMove(event: TouchEvent) {
    const forceTakeover = this.shouldForceReaderScrollTakeover();
    const gesture = this.scrolling.readerTouchMove(event.touches[0]?.clientY, this.canScrollUp(), forceTakeover);
    if (gesture === undefined) return;
    if (forceTakeover) {
      this.readerHistoryPagingEnabled = false;
      if (gesture.readerOwned) this.acceptReaderScrollTakeover();
      return;
    }
    this.applyReaderHistoryPagingGesture(gesture);
  }

  private applyReaderHistoryPagingGesture(gesture: ChatReaderGesture): void {
    if (gesture.readerOwned) this.clearPendingReadingPosition();
    this.readerHistoryPagingEnabled = gesture.direction === "older" && gesture.readerOwned;
    if (this.readerHistoryPagingEnabled) this.requestLoadMoreIfNeeded();
  }

  private shouldForceReaderScrollTakeover(): boolean {
    if (this.loadingScrollReaderOwned) return false;
    return selectedChatIsOpening(this.currentSelectedLoad());
  }

  private acceptReaderScrollTakeover(): void {
    this.loadingScrollReaderOwned = true;
    this.clearPendingReadingPosition();
  }

  private isPrependingMessages(changed: Map<string, unknown>): boolean {
    const oldMessageStart = changed.get("messageStart");
    return typeof oldMessageStart === "number" && this.messageStart < oldMessageStart;
  }

  /**
   * Only free readers with an open ledger need this anchor. Tail and turn modes
   * already place themselves after every content change; closed ledgers have a
   * fixed height; history prepends use the older, broader anchor contract.
   */
  private shouldAnchorLiveLedgerGrowth(changed: Map<string, unknown>): boolean {
    return changed.has("messages")
      && this.expandedRails.size > 0
      && this.scrolling.mode.kind === "free";
  }

  private captureLiveGrowthAnchor(): LiveGrowthAnchorMeasurement | undefined {
    const chat = this.chat;
    if (chat === undefined) return undefined;
    const chatTop = chat.getBoundingClientRect().top;
    const measurements = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-rail-growth-anchor]"))
      .flatMap((element) => {
        const id = element.dataset["railGrowthAnchor"];
        if (id === undefined || !this.expandedRails.has(id)) return [];
        return [{ id, offset: element.getBoundingClientRect().top - chatTop }];
      });
    return selectLiveGrowthAnchor(measurements);
  }

  private restoreLiveGrowthAnchor(anchor: LiveGrowthAnchorMeasurement): void {
    const element = this.renderRoot.querySelector<HTMLElement>(`[data-rail-growth-anchor="${CSS.escape(anchor.id)}"]`);
    if (element === null) return;
    const ledger = element.closest(".turn-rail")?.querySelector<TurnRailLedger>("turn-rail-ledger");
    const epoch = this.liveGrowthRestoreEpoch + 1;
    this.liveGrowthRestoreEpoch = epoch;
    // A Lit child commits after its parent. Measuring immediately after
    // ChatView's update sees the old ledger height and produces a zero delta.
    // Wait for the compact ledger itself, then restore the seam after its rows
    // have entered layout. A newer render invalidates this deferred correction.
    void (ledger?.updateComplete ?? Promise.resolve()).then(() => {
      if (epoch !== this.liveGrowthRestoreEpoch) return;
      const chat = this.chat;
      const current = this.renderRoot.querySelector<HTMLElement>(`[data-rail-growth-anchor="${CSS.escape(anchor.id)}"]`);
      if (chat === undefined || current === null) return;
      const currentOffset = current.getBoundingClientRect().top - chat.getBoundingClientRect().top;
      const delta = scrollDeltaForLiveGrowth(currentOffset, anchor.offset);
      this.scrolling.withProgrammaticScroll(chat, () => { chat.scrollTop += delta; });
      this.scrolling.sync(chat);
    });
  }

  private requestLoadMoreIfNeeded(): void {
    // Earlier history follows a meaningful wheel or touch gesture. Layout,
    // keyboard, and scrollbar movement do not take reading control or turn an
    // opening-time reflow into an automatic history request.
    if (!this.readerHistoryPagingEnabled || this.scrolling.mode.kind !== "free") return;
    if (this.loadMoreCheckFrame !== undefined) return;
    this.loadMoreCheckFrame = requestAnimationFrame(() => {
      this.loadMoreCheckFrame = undefined;
      if (!this.readerHistoryPagingEnabled || this.scrolling.mode.kind !== "free" || !this.scrolling.canLoadMore || this.isSessionLive()) return;
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
    if (this.isSessionLive() || !this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return isNearScrollBottom(chat);
  }

  private canScrollUp(): boolean {
    const chat = this.chat;
    return chat !== undefined && chat.scrollTop > 0;
  }

  private scheduleCurrentFollowTarget(): void {
    if (this.scrolling.mode.kind === "free") return;
    this.scrolling.schedulePlacement(() => { this.alignCurrentFollowTargetNow(); });
  }

  private scrollToBottom(): void {
    this.scrolling.schedulePlacement(() => {
      if (this.scrolling.mode.kind === "tail") this.alignCurrentFollowTargetNow();
    });
  }

  /** Keep the current turn's opening line fixed while its reply changes. */
  private alignAnchoredTurn(): void {
    this.scrolling.schedulePlacement(() => {
      if (this.scrolling.mode.kind === "turn") this.alignCurrentFollowTargetNow();
    });
  }

  private alignCurrentFollowTargetNow(): boolean {
    const chat = this.chat;
    if (chat === undefined) return false;
    const mode = this.scrolling.mode;
    if (mode.kind === "tail") {
      this.scrolling.withProgrammaticScroll(chat, () => { chat.scrollTop = chat.scrollHeight; });
      return true;
    }
    if (mode.kind === "turn") {
      const turn = this.anchoredTurnElement();
      if (turn === undefined) return false;
      this.scrolling.withProgrammaticScroll(chat, () => { this.alignElementToTopNow(turn); });
      return true;
    }
    const position = anchoredReadingPosition(mode);
    return position === undefined ? false : this.restoreReadingPositionNow(position);
  }

  private alignElementToTopNow(element: HTMLElement): void {
    const chat = this.chat;
    if (chat === undefined) return;
    chat.scrollTop += element.getBoundingClientRect().top - chat.getBoundingClientRect().top;
  }

  private anchoredTurnElement(): HTMLElement | undefined {
    const turnKey = anchoredTurnKey(this.scrolling.mode);
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
    this.scrolling.schedulePlacement(() => { this.alignOpenAskToTop(); });
  }

  private alignOpenAskToTop(): boolean {
    return this.alignOpenCardToTop(".chat ask-user-card.open-ask-card");
  }

  private scrollToOpenDialog(): void {
    this.scrolling.schedulePlacement(() => { this.alignOpenDialogToTop(); });
  }

  private alignOpenDialogToTop(): boolean {
    return this.alignOpenCardToTop(".chat extension-dialog-card.open-dialog-card");
  }

  private alignOpenCardToTop(selector: string): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(selector);
    if (chat === undefined || card === null) return false;
    this.scrolling.withProgrammaticScroll(chat, () => { this.alignElementToTopNow(card); });
    this.scrolling.follow(this.isNearBottom() ? FOLLOW_TAIL : FOLLOW_FREE);
    return true;
  }

  private continuePendingReadingPosition(): void {
    const position = this.currentPendingReadingPosition();
    if (position === undefined || this.loadingMore || !selectedChatHasReadableHistory(this.currentSelectedLoad())) return;
    this.scrolling.schedulePlacement(() => { this.restoreReadingPositionNow(position); });
  }

  private restoreReadingPositionNow(position: ChatAnchorReadingPosition): boolean {
    const chat = this.chat;
    if (chat === undefined) return false;
    const result = this.scrolling.withProgrammaticScroll(chat, () => this.readingPositions.restore(
      position,
      chat,
      this.scrollAnchorElements(),
      { fallbackToBottom: !this.hasMore },
    ));
    if (result.status === "restored") {
      this.clearPendingReadingPosition();
      this.scrolling.follow(followAnchor(position));
      return true;
    }
    if (result.status === "bottom") {
      this.readingPositions.forget(this.readingIdentity());
      this.clearPendingReadingPosition();
      this.scrolling.follow(FOLLOW_TAIL);
      return true;
    }
    if (result.status === "missing") {
      this.pendingReadingPosition = result.position;
      this.pendingReadingIdentity = this.readingIdentity();
      this.scrolling.follow(FOLLOW_FREE);
      this.requestEarlierMessagesForReadingPosition(chat);
    }
    return false;
  }

  private requestEarlierMessagesForReadingPosition(chat: HTMLDivElement): boolean {
    if (this.loadMoreRequested
      || this.loadingMore
      || this.isSessionLive()
      || !this.hasMore
      || this.onLoadMore === undefined
      || this.readingPositionLoadBlockedAtStart === this.messageStart) return false;
    this.loadMoreRequested = true;
    this.readingPositionLoadStart = this.messageStart;
    this.scrolling.withProgrammaticScroll(chat, () => { chat.scrollTop = 0; });
    this.onLoadMore();
    return true;
  }

  private finishReadingPositionHistoryLoad(): void {
    const requestedStart = this.readingPositionLoadStart;
    if (requestedStart === undefined) return;
    this.readingPositionLoadStart = undefined;
    this.readingPositionLoadBlockedAtStart = this.messageStart < requestedStart ? undefined : requestedStart;
  }

  private clearPendingReadingPosition(): void {
    this.pendingReadingPosition = undefined;
    this.pendingReadingIdentity = undefined;
    this.readingPositionLoadStart = undefined;
    this.readingPositionLoadBlockedAtStart = undefined;
  }

  private openAtBottom(): void {
    this.scrolling.cancelAutomaticMotion();
    this.scrolling.follow(FOLLOW_TAIL);
    // Preview content is already rendered here. Move before paint, then repeat
    // next frame for content whose layout finishes after this update.
    this.alignCurrentFollowTargetNow();
    this.scrollToBottom();
  }

  capturePrependScrollAnchor(): PrependScrollAnchor | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    return capturePrependScrollAnchor(chat, this.scrollMarkers());
  }

  restorePrependScrollAnchor(anchor: PrependScrollAnchor | undefined): void {
    if (!this.chat || !anchor) return;
    this.scrolling.settle({
      frames: PREPEND_RESTORE_SETTLE_FRAMES,
      immediate: true,
      suppressLoadMore: true,
      apply: () => {
        const chat = this.chat;
        if (chat === undefined) return;
        restorePrependScrollAnchor(chat, anchor, anchor.markerId === undefined ? undefined : this.scrollMarkerAt(anchor.markerId));
        this.scrolling.sync(chat);
      },
    });
  }

  private scrollMarkers(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".scroll-marker"));
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private scrollMarkerAt(markerId: string): HTMLElement | undefined {
    return this.scrollMarkers().find((marker) => marker.dataset["markerId"] === markerId);
  }

  /** The live tail keys on its start, which is stable while events stream in. */
  private groupDisclosureKey(startIndex: number, endIndex: number, live: boolean): string {
    return live ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private messageAnchorKey(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private messageReadingAnchorKey(message: ChatLine, index: number): string | undefined {
    return this.lineReadingAnchorKey("message", message, this.messageAnchorKey(index));
  }

  private groupReadingAnchorKey(messages: readonly ChatLine[], startIndex: number, live: boolean): string | undefined {
    if (live) return undefined;
    const last = messages.at(-1);
    return last === undefined ? this.groupAnchorKey(startIndex) : this.lineReadingAnchorKey("group", last, this.groupAnchorKey(startIndex));
  }

  private eventReadingAnchorKey(message: ChatLine, index: number): string | undefined {
    return this.lineReadingAnchorKey("event", message, this.eventAnchorKey(index));
  }

  private turnReadingAnchor(turn: ChatTurn): { id: string; aliases: string[] } {
    const fallback = this.turnRenderKey(turn);
    const ids = [...new Set(turn.groups.flatMap((group) => {
      const message = group.kind === "group" ? group.messages.at(-1) : group.message;
      if (message === undefined) return [];
      return [this.lineReadingAnchorKey("turn", message, fallback) ?? fallback];
    }))];
    const id = (turn.openedByIndex === undefined ? ids.at(-1) : ids[0]) ?? fallback;
    return { id, aliases: ids.filter((candidate) => candidate !== id) };
  }

  private lineReadingAnchorKey(kind: "message" | "group" | "event" | "turn", message: ChatLine, fallback: string): string | undefined {
    const token = chatLineReadingAnchorToken(message);
    if (token !== undefined) return `${kind}:${token}`;
    const position = message.transcriptPosition;
    if (position !== undefined) return `${kind}:${String(position.messageIndex)}:${String(position.lineIndex)}:${String(position.segmentIndex)}`;
    return kind === "turn" ? fallback : undefined;
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
