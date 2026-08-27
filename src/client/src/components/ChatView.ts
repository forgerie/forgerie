import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { inheritChatLineTranscriptPosition } from "../chatLinePosition";
import { chatTurnFlow, chatTurnGalleryImages, chatTurns, groupChatMessages, summarizeChatGroup, turnMetaSource, withoutToolImageGroups, type ChatGroup, type ChatTurn, type ChatTurnGalleryImage } from "../chatGroups";
import { advanceLivenessClock, livenessBeatMs, livenessPhase, livenessStep, replyIsStreaming, type LivenessClock } from "../chatLiveness";
import { turnLedgerRows, turnRailState, type TurnLedgerRow } from "../turnRail";
import type { SessionActivityIndicator } from "../sessionStatusStrip";
import { splitChatNotice } from "../chatNotices";
import { leadingSlashCommand } from "../slashCommandText";
import "./TranscriptLivenessView";
import { ChatScrollCoordinator } from "../chatScrollCoordinator";
import { sessionActivityIndicator } from "../sessionStatusStrip";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus, SessionWarningSeverity } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { selectedChatCanUseRuntime, selectedChatHasReadableHistory, selectedChatNoTarget, type SelectedChatLoad } from "../selectedChatLoad";
import { notificationAnnouncementLabel, type SelectedSessionNotificationView } from "../sessionNotifications";
import type { PendingSessionLaunchView, SessionLaunchRecovery } from "../controllers/sessionController";
import type { ChatLine, ChatPart, ToolExecutionPart } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import "./FormattedText";
import "./ImageLightbox";
import type { ImageLightbox, ImageLightboxItem } from "./ImageLightbox";
import "./ToolExecutionView";
import "./TurnRailLedger";
import "./TurnRailSummary";

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const messageDayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const messageDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export interface QueuedMessageSection {
  heading: string;
  detail: string;
  messages: QueuedSessionMessage[];
}

type RailChronologyEntry =
  | { kind: "tools"; rows: TurnLedgerRow[] }
  | { kind: "activity"; message: ChatLine; index: number };

/** Preserve wire order while reducing consecutive tool executions to compact ledger segments. */
function railChronologyEntries(
  messages: readonly ChatLine[],
  startIndex: number,
  rowsByExecution: ReadonlyMap<ToolExecutionPart, TurnLedgerRow>,
): RailChronologyEntry[] {
  const entries: RailChronologyEntry[] = [];

  messages.forEach((message, messageOffset) => {
    let activityParts: ChatPart[] = [];
    const flushActivity = () => {
      if (activityParts.length === 0) return;
      entries.push({
        kind: "activity",
        message: inheritChatLineTranscriptPosition(message, { ...message, parts: activityParts }),
        index: startIndex + messageOffset,
      });
      activityParts = [];
    };

    for (const part of message.parts) {
      if (part.type === "empty") continue;
      const row = part.type === "toolExecution" ? rowsByExecution.get(part) : undefined;
      if (row === undefined) {
        activityParts.push(part);
        continue;
      }
      flushActivity();
      const previous = entries.at(-1);
      if (previous?.kind === "tools") previous.rows.push(row);
      else entries.push({ kind: "tools", rows: [row] });
    }
    flushActivity();
  });

  return entries;
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

/** The stable render key for a top-level message at `index`. */
export function chatMessageRenderKey(index: number): string {
  return `m:${String(index)}`;
}

/** The stable render key for a collapsed event group starting at `startIndex`. */
export function chatGroupRenderKey(startIndex: number): string {
  return `g:${String(startIndex)}`;
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
  /** Read-only projection of the first prompt while its backend session does not exist yet. */
  @property({ attribute: false }) pendingSessionLaunch?: PendingSessionLaunchView;
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
  private groupedMessagesInput?: ChatLine[];
  private renderedPendingSessionLaunch: PendingSessionLaunchView | undefined;
  private renderedPendingSessionLaunchSource: ChatLine[] | undefined;
  private renderedPendingSessionLaunchMessages: ChatLine[] = [];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private turnsCache: ChatTurn[] = [];
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private selectedLoadPaintToken = 0;
  private selectedLoadPaintFrame: number | undefined;
  private selectedLoadPaintTask: number | undefined;
  private scrollPointerActive = false;
  @state() private loadMoreRequested = false;
  private retryFocusPending = false;
  private readonly openImageZoom = (images: readonly ImageLightboxItem[], index = 0): void => {
    this.imageLightbox?.open(images, index);
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.();
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  protected override firstUpdated(): void {
    this.scheduleSelectedLoadPaintReport();
  }

  override disconnectedCallback(): void {
    this.scrolling.dispose();
    this.cancelSelectedLoadPaintReport();
    super.disconnectedCallback();
  }

  private sessionIdentityChanged(changed: { has(key: string): boolean }): boolean {
    return changed.has("sessionId") || changed.has("selectedMachineId") || changed.has("sessionCwd");
  }

  private prepareSessionUiState(): void {
    this.disclosures.syncSession(this.sessionId);
    this.scrolling.reset();
    this.scrollPointerActive = false;
    this.retryFocusPending = false;
    this.cancelSelectedLoadPaintReport();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (this.sessionIdentityChanged(changed)) {
      this.livenessClock = undefined;
      this.prepareSessionUiState();
    }
    this.trackLivenessClock();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    const identityChanged = this.sessionIdentityChanged(changed);
    const previousMessageStart = changed.get("messageStart");
    const historyPrepended = typeof previousMessageStart === "number" && this.messageStart < previousMessageStart;
    if (identityChanged) {
      this.cancelSelectedLoadPaintReport();
      this.openAtBottom();
    } else if (historyPrepended) {
      this.onReaderIntent();
    } else if (changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) {
      this.scheduleTailPlacement();
    }
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
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${() => { this.onReaderIntent(); }} @touchmove=${() => { this.onReaderIntent(); }} @keydown=${(event: KeyboardEvent) => { this.onScrollKeyDown(event); }} @pointerdown=${(event: PointerEvent) => { this.onScrollPointerDown(event); }} @pointerup=${() => { this.onScrollPointerEnd(); }} @pointercancel=${() => { this.onScrollPointerEnd(); }}>
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

  private renderedMessages(): ChatLine[] {
    const pending = this.pendingSessionLaunch;
    if (pending === undefined) {
      if (this.renderedPendingSessionLaunch !== undefined) {
        this.renderedPendingSessionLaunch = undefined;
        this.renderedPendingSessionLaunchSource = undefined;
        this.renderedPendingSessionLaunchMessages = [];
      }
      return this.messages;
    }
    if (this.renderedPendingSessionLaunch !== pending || this.renderedPendingSessionLaunchSource !== this.messages) {
      this.renderedPendingSessionLaunch = pending;
      this.renderedPendingSessionLaunchSource = this.messages;
      const visibleMessages = pending.suppressedCanonicalMessage === undefined
        ? this.messages
        : this.messages.filter((message) => message !== pending.suppressedCanonicalMessage);
      this.renderedPendingSessionLaunchMessages = [pending.message, ...visibleMessages];
    }
    return this.renderedPendingSessionLaunchMessages;
  }

  private groupedMessages(): ChatGroup[] {
    const messages = this.renderedMessages();
    if (this.groupedMessagesInput === messages && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    this.groupedMessagesInput = messages;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(messages, this.messageStart);
    this.turnsCache = chatTurns(this.groupedMessagesCache);
    return this.groupedMessagesCache;
  }

  private turns(): ChatTurn[] {
    this.groupedMessages();
    return this.turnsCache;
  }

  /** One human message and its reply render as one stable keyed turn. */
  private renderTurn(turn: ChatTurn, liveTailGroup: ChatGroup | undefined, last: boolean) {
    const key = this.turnRenderKey(turn);
    const turnClosed = !(last && this.isSessionLive());
    const replySettled = !(last && this.latestReplyIsStreaming());
    const flow = chatTurnFlow(turn, replySettled);
    const work = withoutToolImageGroups(flow.work);
    const continuation = withoutToolImageGroups(flow.continuation);
    const galleryImages = chatTurnGalleryImages(turn);
    const continuationClosesTurn = turnClosed && continuation.length > 0;
    return html`
      <section class="turn" data-turn-key=${key}>
        <div class="turn-body">
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
    return html`
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
        <div class=${rows.length === 0 ? "rail-ledger" : "rail-ledger flat"} ?hidden=${!open}>
          ${rows.length === 0
            ? repeat(groups, (group) => this.groupRenderKeyFor(group), (group) => this.renderGroup(group, group === liveTailGroup, true))
            : this.renderChronologicalRailActivity(groups, rows)}
        </div>
        ${meta === undefined ? null : this.renderRailMeta(meta.turn, meta.key)}
      </div>
    `;
  }

  private toggleRail(railKey: string): void {
    const next = new Set(this.expandedRails);
    if (!next.delete(railKey)) next.add(railKey);
    this.expandedRails = next;
  }

  /** Tool and non-tool activity share one stream in the order the wire delivered it. */
  private renderChronologicalRailActivity(
    groups: readonly ChatGroup[],
    rows: readonly TurnLedgerRow[],
  ) {
    const rowsByExecution = new Map(rows.map((row) => [row.execution, row]));
    const chronology = groups.map((group) => ({
      group,
      entries: group.kind === "group"
        ? railChronologyEntries(group.messages, group.startIndex, rowsByExecution)
        : railChronologyEntries([group.message], group.index, rowsByExecution),
    }));
    return html`
      <div class="rail-flat-activity">
        ${chronology.map(({ entries }) => entries.map((entry) => {
          if (entry.kind === "tools") return html`
            <div class="rail-tool-segment">
              <turn-rail-ledger .rows=${entry.rows}></turn-rail-ledger>
            </div>
          `;
          return this.renderRailActivityRow(entry.message, entry.index);
        }))}
      </div>
    `;
  }

  private renderRailActivityRow(message: ChatLine, index: number) {
    const roleClass = message.role === "assistant" ? "msg assistant interim rail-activity-row" : `msg ${message.role} rail-activity-row`;
    return html`
      <article class=${roleClass} data-index=${index}>
        ${message.parts.map((part) => this.renderRailActivityPart(part, message))}
      </article>
    `;
  }

  private renderRailActivityPart(part: ChatPart, message: ChatLine) {
    if (part.type === "thinking") return html`
      <div class="part rail-thinking">
        <span class="rail-activity-glyph" aria-hidden="true">●</span>
        <span class="rail-activity-label">Thinking:</span>
        <formatted-text .text=${part.text}></formatted-text>
      </div>
    `;
    return this.renderPart(part, message);
  }

  /** What the running turn is still doing, and what it is waiting on. */
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
    const messages = this.pendingSessionLaunch?.initialPreviewPending === true
      ? this.clientQueuedMessages.slice(1)
      : this.clientQueuedMessages;
    if (this.pendingSessionLaunch !== undefined && this.sessionLaunchRecovery !== undefined) {
      return html`
        <div class="pending-session-launch-recovery">${this.renderSessionLaunchRecovery()}</div>
        ${chatQueuedMessageSections(messages).map((section) => this.renderQueuedMessageList(section, false))}
      `;
    }
    return html`${chatQueuedMessageSections(messages, this.sessionLaunchRecovery)
      .map((section) => this.renderQueuedMessageList(section))}`;
  }

  private renderQueuedMessageList(section: QueuedMessageSection, hasFirstPromptRecovery = this.sessionLaunchRecovery !== undefined) {
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
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
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
          <span>${sessionLive ? "Earlier messages are available when current work finishes" : "Earlier messages load only when you choose them"}</span>
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
    const pendingSessionLaunch = this.pendingSessionLaunch !== undefined
      && message.role === "user"
      && index === this.messageStart;
    const roleClass = pendingSessionLaunch
      ? "msg user pending-session-launch"
      : interim && message.role === "assistant"
        ? "msg assistant interim"
        : `msg ${message.role}`;
    return html`
      <article class=${toolOnly || askUserRecordOnly ? shellClass : roleClass} data-index=${index}>
        ${toolOnly || askUserRecordOnly ? null : this.renderMessageHeader(message)}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      <article class="msg tool-image-output" data-index=${index}>
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
   * already see one line below it. Thinking joins them: on the rail it renders
   * as a labelled activity row, so ASSISTANT above it repeats the row.
   */
  private isSelfLabellingMessage(message: ChatLine): boolean {
    return message.parts.length > 0
      && message.parts.every((part) => part.type === "processNotification" || part.type === "skillRead" || part.type === "thinking");
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
      <details class=${chatMessageGroupClassName(live)} data-index=${startIndex} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event); }}>
        <summary><span>${summarizeChatGroup(messages)}</span></summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex) : null}
      </details>
    `;
  }

  /**
   * The fold is the disclosure.
   *
   * Steps render in the same flat register the tool-bearing rail uses, so
   * thinking is a row rather than a second `<details>`. Nesting one fold inside
   * another cost two clicks to read one thought and stacked a step count, a
   * role label, and the word "thinking" above the text itself.
   */
  private renderMessageGroupBody(messages: ChatLine[], startIndex: number) {
    return html`
      <div class="group-body">
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          const selfLabelling = this.isSelfLabellingMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset}>
              ${toolOnly || selfLabelling ? null : this.renderMessageHeader(message)}
              ${message.parts.map((part) => this.renderRailActivityPart(part, message))}
            </section>
          `;
        })}
      </div>
    `;
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
      // The band reserves its height in CSS, so a late decode does not shift
      // the surrounding transcript layout.
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

  private onScroll(): void {
    const chat = this.chat;
    if (chat !== undefined) this.scrolling.recordScroll(chat);
  }

  private onReaderIntent(): void {
    const chat = this.chat;
    if (chat !== undefined) this.scrolling.readerIntent(chat);
  }

  private onScrollKeyDown(event: KeyboardEvent): void {
    if (!CHAT_SCROLL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    this.onReaderIntent();
  }

  private onScrollPointerDown(event: PointerEvent): void {
    const chat = this.chat;
    if (chat === undefined || event.target !== chat) return;
    this.scrollPointerActive = true;
    this.scrolling.holdPosition();
  }

  private onScrollPointerEnd(): void {
    if (!this.scrollPointerActive) return;
    this.scrollPointerActive = false;
    const chat = this.chat;
    if (chat !== undefined) this.scrolling.recordScroll(chat);
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested) return;
    if (this.isSessionLive() || !this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.scrolling.holdPosition();
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private scheduleTailPlacement(): void {
    this.scrolling.scheduleTailPlacement(() => { this.placeTailNow(); });
  }

  private placeTailNow(): void {
    const chat = this.chat;
    if (chat !== undefined) chat.scrollTop = chat.scrollHeight;
  }

  private openAtBottom(): void {
    // Preview content is already rendered here. Move before paint, then repeat
    // next frame for content whose layout finishes after this update.
    this.placeTailNow();
    this.scheduleTailPlacement();
  }

  /** The live tail keys on its start, which is stable while events stream in. */
  private groupDisclosureKey(startIndex: number, endIndex: number, live: boolean): string {
    return live ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private groupRenderKeyFor(group: ChatGroup): string {
    return group.kind === "group" ? chatGroupRenderKey(group.startIndex) : chatMessageRenderKey(group.index);
  }

  /** A turn is named by its opening group, which is stable while the turn grows. */
  private turnRenderKey(turn: ChatTurn): string {
    const first = turn.groups[0];
    return first === undefined ? "turn:empty" : `turn:${this.groupRenderKeyFor(first)}`;
  }

  static override styles = chatStyles;
}
