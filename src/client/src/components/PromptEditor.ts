import { EditorView } from "@codemirror/view";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { DoubleEscapeAction, PromptAttachment, PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { parseLeadingSlashCommand } from "../../../shared/promptResourceCommand";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import { createSessionComposerRuntime, type ComposerRuntime } from "../composerRuntime";
import { PromptDictationController, type PromptDictationCapability, type PromptDictationState } from "../controllers/promptDictationController";
import { PromptDictationGesture } from "../controllers/promptDictationGesture";
import { VoiceTurnController } from "../controllers/voiceTurnController";
import { VOICE_SEND_COUNTDOWN_MS, voiceComposerStatusLine, type VoiceComposerState } from "../appShell/voiceComposerState";
import { voiceCaptureClock } from "../appShell/voiceCaptureProgress";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import { composerRail, type ComposerRail } from "../composerRail";
import { COMPOSER_QUEUE_HOLD_MS, composerQueuePressTravel, isPrimaryQueuePointerPress, isQueueHoldKey, readComposerQueuePress } from "../composerQueuePress";
import { inputModeForDraft, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { NEW_SESSION_LABEL, promptEditorStyles, renderNewSessionIcon } from "./shared";
import { renderArchiveIcon, renderAttachIcon, renderBranchIcon, renderDismissIcon, renderMicrophoneIcon, renderQueueIcon, renderSendIcon, renderSlashIcon, renderStopIcon, renderThinkingGauge, renderTreeIcon } from "./promptEditorIcons";
import { DEFAULT_COMPOSER_EDITOR_LABEL, DEFAULT_COMPOSER_PLACEHOLDER } from "./ComposerDraft";
import type { ComposerCapabilities, ComposerContextChip, ComposerDictationCapability, ComposerModelCapability, ComposerSelectableModel } from "../composerCapabilities";
import type { ComposerChoiceGroup, ComposerChoiceItem } from "./ComposerChoiceList";
import { modelChoiceGroups } from "./modelChoiceGroups";
import "./ComposerChoiceList";
import type { ComposerDraft, ComposerDraftCompletionError, ComposerDraftDisplayState, ComposerDraftEscapeContext, ComposerDraftSubmitOutcome, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import type { SpeechServiceStatusResponse } from "../../../shared/speechContracts";
import "./ComposerDraft";
import "./ContextUsageMeter";
import "./ComposerPopover";

type QueuePressOutcome = "pending" | "consumed";

interface QueuePointerPress {
  readonly outcome: QueuePressOutcome;
  readonly activationId: number;
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
  readonly button: HTMLButtonElement;
}

interface QueueKeyboardPress {
  readonly outcome: QueuePressOutcome;
  readonly activationId: number;
  readonly key: " " | "Enter";
}

const DICTATION_STATUS_TIMEOUT_MS = 5_000;

type PendingDictationStatus =
  | { readonly kind: "status"; readonly status: SpeechServiceStatusResponse }
  | { readonly kind: "error"; readonly message: string };

type DictationGestureSource =
  | { readonly tag: "pointer"; readonly pointerId: number; readonly target: HTMLElement | undefined }
  | { readonly tag: "space" };

/**
 * Whether a voice is driving this composer.
 *
 * `voice-first` is not a second composer. It is this one with the microphone
 * already open, a turn readout above the draft, and a transcript that sends
 * itself unless a hand interrupts. Every other control stays exactly where it
 * was, which is the entire point: attaching a file, choosing a command, or
 * changing the model in the middle of a spoken message must not mean leaving
 * voice mode and finding a different composer on the other side.
 */
export type PromptEditorVoiceMode = "off" | "voice-first";

/**
 * The spoken-turn readout.
 *
 * Deliberately small and quiet. It sits above a composer that already has a
 * full control row, and it is a status line, not a second toolbar.
 */
const voiceTurnStyles = css`
  .voice-turn {
    display: flex; align-items: center; gap: var(--pi-space-md);
    margin: 0 0 var(--pi-space-sm); min-height: 34px;
    color: var(--pi-text); font-size: var(--pi-text-md);
  }
  .voice-turn-text { flex: 1 1 auto; min-width: 0; }
  .voice-turn-clock { color: var(--pi-text-secondary); font-size: var(--pi-text-sm); font-variant-numeric: tabular-nums; }
  .voice-turn-finish {
    flex: 0 0 auto; min-height: 34px; padding: 0 var(--pi-space-md);
    font-family: inherit; font-size: var(--pi-text-sm); font-weight: 650;
    border: none; border-radius: var(--pi-radius-control);
    background: var(--pi-accent); color: var(--pi-bg); cursor: pointer;
  }
  .voice-turn-finish:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px; }

  .voice-dot { width: 10px; height: 10px; border-radius: var(--pi-radius-pill); flex: 0 0 auto; background: var(--pi-accent); }
  .voice-dot.working { background: var(--pi-muted); }
  .voice-dot.held, .voice-dot.failed { background: none; border: 1px solid var(--pi-border); }
  /* Waiting for a voice: the app's ambient status pulse, which says the
     microphone is open without claiming anything is arriving. */
  .voice-dot.listening { background: var(--pi-muted); animation: voice-listening 1.6s ease-in-out infinite; }
  /* A voice is arriving. Driven by voiced-audio reports, so it is evidence
     rather than decoration, and it stops pulsing because there is now
     something real to show. */
  .voice-dot.listening.hearing {
    background: var(--pi-accent); animation: none;
    transform: scale(1.5); transition: transform var(--pi-motion-fast) ease-out;
  }
  @keyframes voice-listening { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) {
    .voice-dot.listening { animation: none; }
    .voice-dot.listening.hearing { transform: none; }
  }

  /* The number sits inside the ring, so the ring needs to be its containing
     block. Without the wrapper it would position against the host. */
  .voice-ring-wrap { position: relative; display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; flex: 0 0 auto; }
  .voice-ring { position: absolute; inset: 0; width: 34px; height: 34px; transform: rotate(-90deg); }
  .voice-ring-track { fill: none; stroke: var(--pi-border-muted); stroke-width: 2.5; }
  .voice-ring-value { fill: none; stroke: var(--pi-accent); stroke-width: 2.5; stroke-linecap: round; }
  .voice-ring-number { position: relative; font-size: var(--pi-text-xs); color: var(--pi-text-secondary); font-variant-numeric: tabular-nums; }
`;

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  /**
   * What this host can do.
   *
   * A control renders because a host declared it, never because a field
   * happened to be set, so the chat and the new-session modal offer the same
   * control as soon as each can supply the state behind it.
   */
  @property({ attribute: false }) capabilities: ComposerCapabilities = {};
  /** Supplied by a pre-session host; the session surface builds its own. */
  @property({ attribute: false }) composerRuntime?: ComposerRuntime;
  /** A transient host can supply the surface its completion menu may cover. */
  @property({ attribute: false }) completionBoundary?: HTMLElement;
  /** `null` gives an embedded editor no independent draft record. */
  @property({ attribute: false }) draftStorageKeyOverride?: string | null;
  @property() placeholderText?: string;
  @property() editorLabel?: string;
  @property() enterKeyBehavior: "submit" | "newline" = "submit";
  /**
   * Snapshot-level submission for hosts that must accept or reject a draft.
   *
   * The chat sends and forgets. A pre-session host has to validate first and
   * keep the text when it rejects, so it needs the draft's own outcome
   * protocol rather than the fire-and-forget `onSend`.
   */
  @property({ attribute: false }) onDraftSubmit?: (snapshot: ComposerDraftSubmitSnapshot) => ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome>;
  @property({ attribute: false }) onDraftDisplayStateChange?: (state: ComposerDraftDisplayState) => void;
  @property({ attribute: false }) onDraftEdited?: () => void;
  @property({ attribute: false }) onCompletionError?: (error: ComposerDraftCompletionError) => void;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) submissionAvailable = true;
  /**
   * Whether the send control may fire, when the draft itself is still free.
   *
   * `submissionAvailable` also freezes the draft, so it cannot express "you may
   * keep writing and attaching, but there is nowhere to send this yet". A
   * pre-session host needs exactly that while a destination is unchosen.
   */
  @property({ type: Boolean }) sendAvailable = true;
  @property({ type: Boolean }) runtimeControlsAvailable = true;
  /** Structured hosts can keep the writing tools while another control submits the whole form. */
  @property({ type: Boolean }) primaryActionVisible = true;
  @property({ attribute: "surface", reflect: true }) surfaceMode: "island" | "embedded" = "island";
  @property({ attribute: false }) forcedAttachmentDelivery?: PromptAttachmentDelivery;
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) queuedCompactionAvailable = true;
  @property({ attribute: false }) doubleEscapeAction?: DoubleEscapeAction;
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false, hasChanged: promptHistoryChanged }) promptHistory: readonly string[] = [];
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void | Promise<void>;
  @property({ attribute: false }) onDoubleEscapeAction?: (action: Exclude<DoubleEscapeAction, "none">) => void;
  /** Set when the shell keeps its navigation chrome on request instead of resident. */
  @property({ type: Boolean }) chromeSummoned = false;
  /** Whether a voice drives this composer. See {@link PromptEditorVoiceMode}. */
  @property({ attribute: false }) voiceMode: PromptEditorVoiceMode = "off";
  /** Reports the spoken turn, for hosts that gate dismissal on a live microphone. */
  @property({ attribute: false }) onVoiceStateChange?: (state: VoiceComposerState) => void;

  @query("composer-draft") private draftElement?: ComposerDraft | null;
  @query(".select-model") private modelTrigger?: HTMLButtonElement;
  @query(".select-thinking") private thinkingTrigger?: HTMLButtonElement;
  @query(".queue-button") private queueTrigger?: HTMLButtonElement;
  @query(".steer-confirm-button") private steerConfirmButton?: HTMLButtonElement;

  @state() private composerFocused = false;
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private draftEmpty = true;
  @state() private attachmentCount = 0;
  @state() private attachmentCapturePending = false;
  /** Which choice is open; only ever one, because there is one layer. */
  @state() private openChoice: "model" | "thinking" | undefined = undefined;
  @state() private choiceModels: readonly ComposerSelectableModel[] = [];
  @state() private choiceError: string | undefined = undefined;
  @state() private choiceLoading = false;
  @state() private steerOpen = false;
  @state() private dictationState: PromptDictationState = { tag: "idle" };
  @state() private dictationCapability: PromptDictationCapability = "warming";
  @state() private dictationStatusMessage = "Speech dictation is warming up.";
  private dictationController: PromptDictationController | undefined;
  private dictationStatusAbort: AbortController | undefined;
  private dictationStatusTimer: number | undefined;
  private dictationStatusVersion = 0;
  private pendingDictationStatus: PendingDictationStatus | undefined;
  private dictationGesture = this.createDictationGesture();
  private dictationGestureSource: DictationGestureSource | undefined;
  private readonly voiceTurn = new VoiceTurnController(this, {
    onSend: () => { this.sendVoiceTurn(); },
    onStateChange: (state) => { this.onVoiceStateChange?.(state); },
  });
  private voiceTurnStarted = false;
  private dictationSampleRateHz = SPEECH_POLICY.audio.sampleRateHz;
  private choiceRequestVersion = 0;
  private lastEscapeTime = 0;
  private pendingReplacement: { kind: "text"; text: string } | { kind: "snapshot"; snapshot: ComposerDraftSubmitSnapshot } | undefined;
  private cachedRuntimeKey = "";
  private cachedRuntime: ComposerRuntime = createSessionComposerRuntime({ machineId: "local" });
  private queuePointerPress: QueuePointerPress | undefined;
  private queuePressTimer: ReturnType<typeof setTimeout> | undefined;
  private queueSuppressClickTimer: ReturnType<typeof setTimeout> | undefined;
  private queueKeyboardPress: QueueKeyboardPress | undefined;
  private queueSuppressedClickId: number | undefined;
  private nextQueueActivationId = 0;
  private readonly handleQueuePointerMoveDocument = (event: PointerEvent): void => { this.onQueuePointerMove(event); };
  private readonly handleQueuePointerUpDocument = (event: PointerEvent): void => { this.onQueuePointerUp(event); };
  private readonly handleQueuePointerCancelDocument = (event: PointerEvent): void => { this.onQueuePointerCancel(event); };
  private readonly handleQueueKeyUpDocument = (event: KeyboardEvent): void => { this.onQueueKeyUp(event); };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointermove", this.handleQueuePointerMoveDocument, { capture: true });
    document.addEventListener("pointerup", this.handleQueuePointerUpDocument, { capture: true });
    document.addEventListener("pointercancel", this.handleQueuePointerCancelDocument, { capture: true });
    document.addEventListener("keyup", this.handleQueueKeyUpDocument, { capture: true });
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("pagehide", this.handlePageHidden);
    window.addEventListener("freeze", this.handlePageHidden);
    window.addEventListener("resize", this.handleResizeOrOrientation);
    window.addEventListener("orientationchange", this.handleResizeOrOrientation);
    if (this.hasUpdated) this.syncDictationCapability();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const sessionChanged = changed.has("sessionId") || changed.has("machineId") || changed.has("cwd");
    if (sessionChanged) {
      this.lastEscapeTime = 0;
      this.resetSteerDisclosure();
      this.resetDictationGesture();
      this.dictationController?.ownerChanged();
    }
    if (changed.has("disabled") && this.disabled) {
      this.resetDictationGesture();
      this.dictationController?.surfaceDisabled();
    }
    if (changed.has("runtimeControlsAvailable") && !this.runtimeControlsAvailable) {
      this.resetSteerDisclosure();
      // Dictation is gateway-local and must survive transient session-runtime refreshes.
    }
    if (changed.has("canSteer") || changed.has("isCompacting") || changed.has("disabled") || changed.has("submissionAvailable") || changed.has("sendAvailable") || changed.has("sending")) {
      const rail = this.rail();
      if (!rail.canSteer || !rail.canInvokeQueue) this.resetSteerDisclosure();
    }
    if (changed.has("capabilities") && changed.get("capabilities")?.dictation !== this.capabilities.dictation) this.resetDictationCapability();
  }

  protected override updated(): void {
    this.flushPendingReplacement();
    this.syncDictationCapability();
    this.startVoiceTurnWhenReady();
  }

  /**
   * Open the microphone as soon as the surface can honestly do it.
   *
   * Voice-first means the reader already asked to talk, so waiting for a
   * second gesture would be asking twice. The only wait here is for the speech
   * service to report itself usable. Pressing while it is still warming puts
   * the composer straight into an unavailable state, which would make a liar
   * of the surface that just opened saying it was listening.
   */
  private startVoiceTurnWhenReady(): void {
    if (this.voiceMode !== "voice-first" || this.voiceTurnStarted) return;
    if (this.dictationCapability !== "ready" && this.dictationCapability !== "manual-only") return;
    if (this.dictationController === undefined || !this.canToggleDictation()) return;
    this.voiceTurnStarted = true;
    // press then release is the tap the controller already models, and it
    // lands in the open-microphone state a spoken turn needs.
    this.activateDictationShortTap();
  }

  override disconnectedCallback(): void {
    document.removeEventListener("pointermove", this.handleQueuePointerMoveDocument, { capture: true });
    document.removeEventListener("pointerup", this.handleQueuePointerUpDocument, { capture: true });
    document.removeEventListener("pointercancel", this.handleQueuePointerCancelDocument, { capture: true });
    document.removeEventListener("keyup", this.handleQueueKeyUpDocument, { capture: true });
    this.cancelQueuePress({ clearSuppression: true });
    this.steerOpen = false;
    this.disposeDictation();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("pagehide", this.handlePageHidden);
    window.removeEventListener("freeze", this.handlePageHidden);
    window.removeEventListener("resize", this.handleResizeOrOrientation);
    window.removeEventListener("orientationchange", this.handleResizeOrOrientation);
    super.disconnectedCallback();
  }

  override render() {
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const rail = this.rail();
    const dictationBlocksComposer = this.dictationBlocksComposer();
    // Attachment capture blocks send/queue through rail(), but it must not set
    // ComposerDraft.submissionDisabled or the draft will reject its own result.
    const busy = this.sending || dictationBlocksComposer;
    const resting = this.isResting();
    return html`
      ${this.openChoice === undefined || this.capabilities.model === undefined ? nothing : this.renderChoicePopover(this.capabilities.model)}
      ${this.steerOpen && rail.canSteer ? this.renderSteerPopover() : nothing}
      <footer
        class=${this.footerClass(shellMode, resting)}
        @focusin=${() => { this.composerFocused = true; }}
        @focusout=${(event: FocusEvent) => { this.releaseComposerFocus(event); }}
        @pointerdown=${() => { this.holdVoiceTurn(); }}
        @keydown=${() => { this.holdVoiceTurn(); }}
      >
        ${this.renderVoiceTurn()}
        ${this.capabilities.contextUsage === undefined ? nothing : html`<context-usage-meter .contextUsage=${this.capabilities.contextUsage}></context-usage-meter>`}
        <composer-draft
          data-keyboard-shortcut-context="composer"
          .disabled=${this.disabled}
          .submissionDisabled=${busy || !this.submissionAvailable}
          .working=${rail.kind === "queueCapable"}
          .resting=${resting}
          .runtime=${this.runtime()}
          .completionBoundary=${this.completionBoundary}
          .promptHistory=${this.promptHistory}
          .storageKey=${this.draftStorageKey()}
          .forcedAttachmentDelivery=${this.forcedAttachmentDelivery}
          .placeholderText=${this.placeholderText ?? DEFAULT_COMPOSER_PLACEHOLDER}
          .editorLabel=${this.editorLabel ?? DEFAULT_COMPOSER_EDITOR_LABEL}
          .enterKeyBehavior=${this.enterKeyBehavior}
          .onSubmit=${(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp") => this.sendSnapshot(snapshot, streamingBehavior)}
          .onEscape=${(context: ComposerDraftEscapeContext) => this.handleDraftEscape(context)}
          .onDisplayStateChange=${(state: ComposerDraftDisplayState) => { this.updateDraftDisplayState(state); }}
          .onDraftEdited=${() => { this.handleDraftEdited(); }}
          .onCompletionError=${this.onCompletionError}
        ></composer-draft>
        <div class="actions">
          ${this.renderCommandsAction()}
          ${this.renderAttachmentAction(busy)}
          ${this.renderDictationAction()}
          ${this.renderTreeAction()}
          ${this.renderArchiveAction()}
          ${this.renderCompactStatus()}
          ${this.capabilities.newSession === undefined ? nothing : html`
            <button
              class="icon-button new-session-button"
              data-action="new-session"
              title=${NEW_SESSION_LABEL}
              aria-label=${NEW_SESSION_LABEL}
              @click=${() => { this.closeSteer(false); this.capabilities.newSession?.onNewSession(); }}
            >${renderNewSessionIcon()}</button>
          `}
          ${this.renderRapidfireAction()}
          ${this.renderDismissAction()}
          ${this.primaryActionVisible ? this.renderPrimaryAction(rail) : nothing}
          ${this.renderQueueAction(rail)}
        </div>
      </footer>
    `;
  }

  private runtime(): ComposerRuntime {
    // A pre-session host owns its own capabilities, so it supplies the runtime
    // rather than letting the composer build a session-shaped one.
    if (this.composerRuntime !== undefined) return this.composerRuntime;
    const key = JSON.stringify({ sessionId: this.sessionId, cwd: this.cwd, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId });
    if (key !== this.cachedRuntimeKey) {
      this.cachedRuntimeKey = key;
      this.cachedRuntime = createSessionComposerRuntime({
        ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
        ...(this.cwd === undefined ? {} : { cwd: this.cwd }),
        machineId: this.machineId,
        ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
        ...(this.workspaceId === undefined ? {} : { workspaceId: this.workspaceId }),
      });
    }
    return this.cachedRuntime;
  }

  private draftStorageKey(): string | undefined {
    if (this.draftStorageKeyOverride !== undefined) return this.draftStorageKeyOverride ?? undefined;
    // A first prompt belongs to its host's recovery record, not to a durable
    // per-session draft that no session owns yet.
    if (this.sessionId === undefined) return undefined;
    return draftStorageKey(this.machineId, this.sessionId);
  }

  private footerClass(shellMode: boolean, resting: boolean): string {
    return [shellMode ? "shell-mode" : "", resting ? "resting" : ""].filter((name) => name !== "").join(" ");
  }

  private isResting(): boolean {
    return promptComposerIsResting({
      chromeSummoned: this.chromeSummoned,
      focused: this.composerFocused,
      draft: this.draftEmpty ? "" : "draft",
      attachmentCount: this.attachmentCount,
    });
  }

  /** Focus moving between the editor and its own buttons must not collapse the composer. */
  private releaseComposerFocus(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.renderRoot instanceof ShadowRoot && this.renderRoot.contains(next)) return;
    this.composerFocused = false;
  }

  /**
   * Hosts focus the composer; the caret belongs in the draft, not the shell.
   *
   * Falls back to the host element when the editor has not mounted yet, so a
   * dialog moving focus on open still lands inside the composer.
   */
  override focus(options?: FocusOptions): void {
    if (this.view !== undefined) {
      this.focusInput();
      return;
    }
    // A dialog can move focus here before the editor mounts. Hold focus on the
    // host, then hand it to the caret as soon as the draft exists. Only an
    // explicit focus() on this element starts this, so it cannot steal focus.
    super.focus(options);
    void this.updateComplete.then(async () => {
      await this.draftElement?.updateComplete;
      this.focusInput();
    });
  }

  focusInput(): boolean {
    return this.draftElement?.focusInput() ?? false;
  }

  insertTextAtSelection(text: string): boolean {
    return this.draftElement?.insertTextAtSelection(text) ?? false;
  }

  getText(): string {
    return this.draftElement?.getText() ?? "";
  }

  currentSnapshot(): ComposerDraftSubmitSnapshot {
    return this.draftElement?.currentSnapshot() ?? { text: "" };
  }

  getSelection(): { start: number; end: number; text: string } | null {
    return this.draftElement?.getSelection() ?? null;
  }

  /**
   * Open the file picker from outside the composer.
   *
   * The island menu lives in the sheet, so the sheet needs a way in that still
   * honours the composer's own guard: an archived session, or one already
   * sending, must not be able to start an attachment.
   */
  private openAttachmentPicker(): void {
    if (this.disabled || this.sending) return;
    this.draftElement?.openAttachmentPicker();
  }

  replaceText(text: string): boolean {
    if (this.dictationBlocksComposer()) return false;
    if (this.draftElement === undefined || this.draftElement === null) {
      this.pendingReplacement = { kind: "text", text };
      this.currentInputMode = inputModeForDraft(text);
      this.draftEmpty = text.trim() === "";
      return true;
    }
    this.draftElement.replaceText(text);
    return true;
  }

  restoreSnapshot(snapshot: ComposerDraftSubmitSnapshot): boolean {
    if (this.dictationBlocksComposer()) return false;
    if (this.draftElement === undefined || this.draftElement === null) {
      this.pendingReplacement = { kind: "snapshot", snapshot };
      this.currentInputMode = inputModeForDraft(snapshot.text);
      this.draftEmpty = snapshot.text.trim() === "";
      return true;
    }
    this.draftElement.restoreTransientSnapshot(snapshot);
    return true;
  }

  /** Whether the current composer can start, finish, or cancel speech dictation. */
  canToggleDictation(): boolean {
    if (this.capabilities.dictation === undefined || this.disabled || this.dictationView().disabled) return false;
    if (this.dictationState.tag === "acquiring" || this.dictationState.tag === "pressed" || this.dictationCanCompleteFromKey()) return true;
    return this.submissionAvailable && !this.sending && !this.attachmentCapturePending;
  }

  /** Toggle the same speech-dictation lifecycle as the microphone control. */
  toggleDictation(): boolean {
    if (!this.canToggleDictation()) return false;
    if (this.dictationState.tag === "acquiring" || this.dictationState.tag === "pressed") {
      this.resetDictationGesture();
      this.dictationController?.cancel();
      return true;
    }
    if (this.dictationCanCompleteFromKey()) return this.dictationController?.press() === true;
    return this.activateDictationShortTap();
  }

  /** Abort any active dictation before the host changes composer ownership. */
  cancelDictation(): void {
    this.cancelDictationBeforeSurfaceExit();
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.draftElement?.view;
  }

  /**
   * What the rail offers right now.
   *
   * `canSteer` arrives as "the agent is speaking"; the rail keeps that separate
   * from the broader stoppable-work state so shell-only and pending-only work
   * can stop without exposing unsupported follow-up delivery.
   */
  private rail(): ComposerRail {
    const queuedCompactBlocked = (this.canSteer || this.isCompacting) && !this.queuedCompactionAvailable && this.isCompactDraft();
    return composerRail({
      disabled: this.disabled,
      submissionAvailable: this.submissionAvailable,
      sendAvailable: this.sendAvailable && !queuedCompactBlocked,
      sending: this.sending || this.attachmentCapturePending || this.dictationBlocksComposer(),
      isStreaming: this.canSteer,
      isCompacting: this.isCompacting,
      stoppable: this.capabilities.stop?.stoppable === true,
    });
  }

  private isCompactDraft(): boolean {
    const parsed = parseLeadingSlashCommand(this.draftElement?.getText() ?? "");
    return parsed.kind === "command" && parsed.name === "compact";
  }

  /**
   * What the spoken turn is doing, above the draft it is writing into.
   *
   * Only rendered in voice-first mode. The inline microphone reports itself
   * through the button and the status line beside it, and does not want a
   * second readout or a countdown it never runs.
   */
  private renderVoiceTurn() {
    if (this.voiceMode !== "voice-first") return nothing;
    const state = this.voiceTurn.state;
    const capture = this.voiceTurn.capture;
    return html`
      <p class="voice-turn" role="status" aria-live="polite">
        ${this.renderVoiceIndicator(state, capture.hearing)}
        <span class="voice-turn-text">${voiceComposerStatusLine(state, capture)}</span>
        ${capture.seconds === 0 ? nothing : html`<span class="voice-turn-clock">${voiceCaptureClock(capture)}</span>`}
        ${state.kind !== "listening" ? nothing : html`<button
          type="button"
          class="voice-turn-finish"
          data-action="voice-finish"
          @click=${() => { this.finishVoiceTurn(); }}
        >Finish</button>`}
      </p>
    `;
  }

  /**
   * The ring, or the reason there is no ring.
   *
   * The remaining time is read at render rather than stored, so the deadline
   * stays the single fact and a late redraw cannot send early.
   */
  private renderVoiceIndicator(state: VoiceComposerState, hearing: boolean) {
    if (state.kind === "listening") {
      // Bright while a voice is arriving, dim between words. This is the only
      // honest liveness signal available: the pipeline reports voiced audio,
      // never amplitude, so there is nothing here to draw a level from.
      return html`<span class=${`voice-dot listening ${hearing ? "hearing" : ""}`} aria-hidden="true"></span>`;
    }
    if (state.kind !== "counting") return html`<span class=${`voice-dot ${state.kind}`} aria-hidden="true"></span>`;
    const remaining = this.voiceTurn.remainingMs();
    const left = Math.max(0, Math.min(1, remaining / VOICE_SEND_COUNTDOWN_MS));
    const circumference = 2 * Math.PI * 20;
    return html`
      <span class="voice-ring-wrap">
        <svg class="voice-ring" viewBox="0 0 46 46" aria-hidden="true">
          <circle cx="23" cy="23" r="20" class="voice-ring-track"></circle>
          <circle cx="23" cy="23" r="20" class="voice-ring-value" stroke-dasharray=${`${String(circumference * left)} ${String(circumference)}`}></circle>
        </svg>
        <span class="voice-ring-number">${(remaining / 1000).toFixed(1)}</span>
      </span>
    `;
  }

  /**
   * End the turn now and transcribe what was said.
   *
   * Not a fallback. Automatic turn detection is disabled by product policy, so
   * nothing else will ever decide a turn is over, and without this the
   * microphone would run to the capture limit with no way out but discarding.
   */
  private finishVoiceTurn(): void {
    this.dictationController?.press();
  }

  /** A hand on the composer stops the countdown and keeps the words. */
  private holdVoiceTurn(): void {
    if (this.voiceMode !== "voice-first") return;
    this.voiceTurn.hold();
  }

  private handleDraftEdited(): void {
    if (this.voiceMode === "voice-first") {
      this.voiceTurn.hold();
      this.voiceTurn.edited(this.draftElement?.getText() ?? "");
    }
    this.onDraftEdited?.();
  }

  /** The countdown ran out. Send the draft, exactly as the Send button does. */
  private sendVoiceTurn(): void {
    if (this.voiceMode !== "voice-first") return;
    this.submitDraft();
  }

  private renderDictationAction() {
    if (this.capabilities.dictation === undefined) return nothing;
    const view = this.dictationView();
    return html`
      <span id="composer-dictation-privacy" class="dictation-privacy">Audio goes to this Forgerie gateway for endpointing and transcription, not to the selected machine. Raw audio is not stored as application data.</span>
      <span id="composer-dictation-status" class="dictation-status dictation-privacy" role="status" aria-live="polite">${view.status}</span>
      ${this.dictationState.tag === "retained-retry" ? html`
        <span class="dictation-retry-actions">
          <button type="button" class="dictation-discard" @click=${() => { this.dictationController?.discardRetained(); }}>Discard</button>
        </span>
      ` : nothing}
      <button
        class=${`icon-button dictation-button dictation-${this.dictationState.tag}`}
        type="button"
        data-action="dictation"
        title=${view.label}
        aria-label=${view.label}
        aria-pressed=${view.pressed ? "true" : "false"}
        aria-describedby="composer-dictation-privacy composer-dictation-status"
        ?disabled=${view.disabled}
        @pointerdown=${(event: PointerEvent) => { this.handleDictationPointerDown(event); }}
        @pointerup=${(event: PointerEvent) => { this.handleDictationPointerUp(event); }}
        @pointercancel=${(event: PointerEvent) => { this.handleDictationPointerCancel(event); }}
        @lostpointercapture=${(event: PointerEvent) => { this.handleDictationLostPointerCapture(event); }}
        @contextmenu=${(event: Event) => { event.preventDefault(); }}
        @click=${(event: Event) => { this.handleDictationClick(event); }}
        @keydown=${(event: KeyboardEvent) => { this.handleDictationKeyDown(event); }}
        @keyup=${(event: KeyboardEvent) => { this.handleDictationKeyUp(event); }}
      >${renderMicrophoneIcon()}</button>
    `;
  }


  private renderRapidfireAction() {
    const rapidfire = this.capabilities.rapidfire;
    if (rapidfire === undefined) return nothing;
    const title = rapidfire.active ? "Turn off Rapidfire" : "Turn on Rapidfire for the current workspace";
    return html`
      <button
        class="rapidfire-button"
        type="button"
        data-action="rapidfire"
        title=${title}
        aria-label="Rapidfire for current workspace"
        aria-pressed=${rapidfire.active ? "true" : "false"}
        ?disabled=${this.disabled || rapidfire.disabled === true}
        @pointerdown=${(event: PointerEvent) => { event.preventDefault(); }}
        @click=${() => {
          this.closeSteer(false);
          this.closeChoice(false);
          this.capabilities.rapidfire?.onToggle();
        }}
      >
        <svg class="rapidfire-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M2.5 4h8M8.5 2l2 2-2 2M2.5 8h8M8.5 6l2 2-2 2M2.5 12h8M8.5 10l2 2-2 2"></path>
        </svg>
        <span>Rapidfire</span>
      </button>
    `;
  }

  /** The way out sits beside the way in, at the same size. */
  private renderDismissAction() {
    const dismiss = this.capabilities.dismiss;
    if (dismiss === undefined) return nothing;
    const label = dismiss.label ?? "Cancel";
    return html`
      <button
        class="icon-button composer-dismiss"
        type="button"
        data-action="cancel"
        ?disabled=${this.disabled || dismiss.disabled === true}
        title=${label}
        aria-label=${label}
        @click=${() => {
          this.closeSteer(false);
          this.closeChoice(false);
          this.cancelDictationBeforeSurfaceExit();
          dismiss.onDismiss();
        }}
      >${renderDismissIcon()}</button>
    `;
  }

  private renderPrimaryAction(rail: ComposerRail) {
    if (rail.primaryAction === "stop") {
      return html`
        <div class="primary-action">
          <button
            class="icon-button stop-button"
            ?disabled=${!rail.canInvokePrimary}
            title=${rail.canStop ? "Stop current work and restore queued messages to the draft" : "Nothing running"}
            aria-label="Stop current work"
            @click=${() => { this.stop(); }}
          >${renderStopIcon()}</button>
        </div>
      `;
    }
    return html`
      <div class="primary-action">
        <button
          class="icon-button send-button"
          ?disabled=${!rail.canInvokePrimary}
          title="Send message"
          aria-label="Send message"
          @click=${() => { this.submitDraft(); }}
        >${renderSendIcon()}</button>
      </div>
    `;
  }

  private renderQueueAction(rail: ComposerRail) {
    if (!rail.canQueue) return nothing;
    const steerAvailable = rail.canSteer;
    const descriptionId = "queue-steer-description";
    return html`
      <button
        class=${`icon-button queue-button${steerAvailable ? " has-steer" : ""}`}
        ?disabled=${!rail.canInvokeQueue}
        title=${!this.queuedCompactionAvailable && this.isCompactDraft()
          ? "Update the selected machine before queueing /compact"
          : steerAvailable ? "Queue until the current activity finishes; hold for Steer" : "Queue until the current activity finishes"}
        aria-label="Queue message"
        aria-describedby=${steerAvailable ? descriptionId : nothing}
        aria-haspopup=${steerAvailable ? "dialog" : nothing}
        aria-expanded=${steerAvailable ? String(this.steerOpen) : nothing}
        aria-controls=${steerAvailable ? "queue-steer-popover" : nothing}
        @click=${(event: MouseEvent) => { this.onQueueClick(event); }}
        @pointerdown=${steerAvailable ? (event: PointerEvent) => { this.onQueuePointerDown(event); } : nothing}
        @keydown=${steerAvailable ? (event: KeyboardEvent) => { this.onQueueKeyDown(event); } : nothing}
        @blur=${steerAvailable ? () => { this.onQueueBlur(); } : nothing}
        @contextmenu=${steerAvailable ? (event: MouseEvent) => { this.onQueueContextMenu(event); } : nothing}
      >${renderQueueIcon()}${steerAvailable ? html`<span class="queue-steer-cue" aria-hidden="true">⋯</span><span id=${descriptionId} class="visually-hidden">Hold for Steer current response.</span>` : nothing}</button>
    `;
  }

  private renderSteerPopover() {
    return html`
      <composer-popover
        id="queue-steer-popover"
        label="Steer current response"
        .anchor=${this.queueTrigger}
        .onClose=${(restoreFocus: boolean) => { this.closeSteer(restoreFocus); }}
      >
        <div class="steer-confirmation">
          <button
            class="steer-confirm-button"
            type="button"
            @click=${() => { this.confirmSteer(); }}
          >Steer current response</button>
        </div>
      </composer-popover>
    `;
  }

  private renderCompactStatus() {
    const context = this.capabilities.context ?? [];
    const model = this.capabilities.model;
    if (context.length === 0 && model === undefined) return null;
    return html`
      <div class=${`compact-status${this.chromeSummoned ? " summoned" : ""}`} aria-label="Composer status">
        ${context.map((chip) => this.renderContextChip(chip))}
        ${model === undefined ? nothing : this.renderModelCapsule(model)}
      </div>
    `;
  }

  /**
   * Model and thinking level are read together and set together, so they share
   * one capsule instead of spending two slots on the rail.
   */
  /** One layer: the open choice, anchored to the control that raised it. */
  private renderChoicePopover(model: ComposerModelCapability) {
    const isModel = this.openChoice === "model";
    const groups = isModel ? this.modelChoiceGroups() : this.thinkingChoiceGroups(model);
    const selected = isModel
      ? (model.model === undefined ? undefined : `${model.model.provider ?? ""}/${model.model.id ?? ""}`)
      : model.thinkingLevel;
    return html`
      <composer-popover
        label=${isModel ? "Model" : "Thinking level"}
        .anchor=${isModel ? this.modelTrigger : this.thinkingTrigger}
        .onClose=${(restoreFocus: boolean) => { this.closeChoice(restoreFocus); }}
      >
        <composer-choice-list
          .groups=${groups}
          .selectedValue=${selected}
          .searchable=${isModel}
          .searchLabel=${"Search models"}
          .loading=${isModel && this.choiceLoading}
          .emptyMessage=${isModel ? "No models are configured" : "No levels are available"}
          .error=${isModel ? this.choiceError : undefined}
          .onRetry=${isModel ? () => { void this.loadChoiceModels(model); } : undefined}
          .onPick=${(value: string) => { this.pickChoice(model, value); }}
        ></composer-choice-list>
      </composer-popover>
    `;
  }

  private pickChoice(model: ComposerModelCapability, value: string): void {
    if (this.openChoice === undefined || this.disabled || this.dictationBlocksComposer() || model.changeable === false) {
      this.closeChoice(false);
      return;
    }
    if (this.openChoice === "thinking") {
      model.onChooseThinkingLevel(value);
    } else {
      const picked = this.choiceModels.find((candidate) => modelChoiceValue(candidate) === value);
      if (picked !== undefined) model.onChooseModel(picked);
    }
    this.closeChoice(true);
  }

  private renderModelCapsule(capability: ComposerModelCapability) {
    const changeable = capability.changeable !== false;
    const model = capability.model;
    const name = model === undefined ? "no model" : modelDisplayName(model);
    const identity = model === undefined ? "no model" : modelChoiceValue(model);
    const thinking = thinkingLevelLabel(capability.thinkingLevel);
    return html`
      <div class="model-capsule">
        <button class="select-model" ?disabled=${this.disabled || !changeable || this.dictationBlocksComposer()} title=${`Select model: ${identity}`} @click=${() => { this.selectModel(); }}>${name}</button>
        <button class="select-thinking icon-button" ?disabled=${this.disabled || !changeable || this.dictationBlocksComposer()} title=${`Thinking level: ${thinking}`} aria-label=${`Thinking level: ${thinking}`} @click=${() => { this.selectThinking(); }}>
          ${renderThinkingGauge(thinkingGauge(capability.thinkingLevel, capability.availableThinkingLevels ?? []))}
        </button>
      </div>
    `;
  }

  private renderContextChip(chip: ComposerContextChip) {
    const action = chip.action;
    return html`
      <span class="composer-context-chip session-identity summoned-secondary" title=${chip.title ?? chip.label}>
        ${chip.kind === "branch" ? renderBranchIcon() : nothing}<span class="context-chip-name">${chip.label}</span>
        ${action === undefined ? nothing : html`<button
          class="composer-context-chip-action"
          data-action="change-destination"
          ?disabled=${this.disabled || action.disabled === true || this.dictationBlocksComposer()}
          title=${action.label}
          aria-label=${action.label}
          @click=${() => { if (!this.dictationBlocksComposer()) action.onActivate(); }}
        >${action.label}</button>`}
      </span>
    `;
  }

  /**
   * Where you are, inherited from the retired chrome bands.
   *
   * A narrow composer spends its row on controls that must always work. The
   * session identity appears only when the island's own width can carry it.
   */
  private stop(): void {
    const stop = this.capabilities.stop;
    if (this.disabled || stop?.stoppable !== true) return;
    this.resetSteerDisclosure();
    this.cancelDictationBeforeSurfaceExit();
    stop.onStop();
  }

  private cancelDictationBeforeSurfaceExit(): void {
    if (!this.dictationBlocksComposer()) return;
    this.resetDictationGesture();
    // cancel() releases the draft lock synchronously before it awaits track
    // cleanup, so the exit action can safely restore or discard the draft.
    this.dictationController?.cancel();
  }

  private selectModel(): void {
    const model = this.capabilities.model;
    if (this.disabled || this.dictationBlocksComposer() || model === undefined || model.changeable === false) return;
    this.closeSteer(false);
    if (this.openChoice === "model") {
      this.closeChoice(true);
      return;
    }
    this.openChoice = "model";
    void this.loadChoiceModels(model);
  }

  private selectThinking(): void {
    const model = this.capabilities.model;
    if (this.disabled || this.dictationBlocksComposer() || model === undefined || model.changeable === false) return;
    this.closeSteer(false);
    this.openChoice = this.openChoice === "thinking" ? undefined : "thinking";
  }

  private async loadChoiceModels(model: ComposerModelCapability): Promise<void> {
    const version = ++this.choiceRequestVersion;
    this.choiceError = undefined;
    this.choiceLoading = true;
    try {
      const models = await model.listModels();
      if (version !== this.choiceRequestVersion) return;
      this.choiceModels = models;
    } catch (error: unknown) {
      if (version !== this.choiceRequestVersion) return;
      this.choiceModels = [];
      this.choiceError = error instanceof Error && error.message !== "" ? error.message : "Models are unavailable.";
    } finally {
      if (version === this.choiceRequestVersion) this.choiceLoading = false;
    }
  }

  private closeChoice(restoreFocus: boolean): void {
    if (this.openChoice === undefined) return;
    const anchor = this.openChoice === "model" ? this.modelTrigger : this.thinkingTrigger;
    this.openChoice = undefined;
    if (restoreFocus) anchor?.focus();
  }

  /** Names Pi's cycling scope, then the rest of the catalogue by provider. */
  private modelChoiceGroups(): ComposerChoiceGroup[] {
    return modelChoiceGroups(this.choiceModels);
  }

  /**
   * A model that cannot reason clamps the scale, so the rows say so in place
   * rather than letting a level be chosen that the session would discard.
   */
  private thinkingChoiceGroups(model: ComposerModelCapability): ComposerChoiceGroup[] {
    const clamped = this.selectedChoiceModel()?.reasoning === false;
    const levels = model.availableThinkingLevels ?? [];
    return [{
      items: levels.map((level): ComposerChoiceItem => {
        const detail = thinkingLevelDetail(level);
        return {
          value: level,
          label: level,
          ...(detail === undefined ? {} : { detail }),
          ...(clamped && level !== "off" ? { disabled: true, meta: "unavailable" } : {}),
        };
      }),
    }];
  }

  private selectedChoiceModel(): ComposerSelectableModel | undefined {
    const current = this.capabilities.model?.model;
    if (current === undefined) return undefined;
    return this.choiceModels.find((candidate) => candidate.provider === current.provider && candidate.id === current.id);
  }

  private renderTreeAction() {
    if (this.capabilities.tree === undefined) return null;
    return html`
      <button
        class="composer-tree icon-button"
        ?disabled=${this.dictationBlocksComposer()}
        title="Navigate the session tree"
        aria-label="Session tree"
        @click=${() => { if (this.dictationBlocksComposer()) return; this.closeSteer(false); this.capabilities.tree?.onOpenTree(); }}
      >${renderTreeIcon()}</button>
    `;
  }

  private renderArchiveAction() {
    if (this.capabilities.archive === undefined) return null;
    return html`
      <button
        class="composer-archive icon-button"
        ?disabled=${this.dictationBlocksComposer()}
        title="Archive this session and open the next one waiting for you"
        aria-label="Archive &amp; next"
        @click=${() => { if (this.dictationBlocksComposer()) return; this.closeSteer(false); this.capabilities.archive?.onArchiveAndNext(); }}
      >${renderArchiveIcon()}</button>
    `;
  }

  /**
   * The button form of the "/" sigil, for hands without a convenient key.
   *
   * It self-selects from the runtime rather than a capability: any host whose
   * runtime resolves command completions has commands worth listing. It goes
   * quiet while prose occupies the draft, because opening the menu would mean
   * rewriting what the user already wrote.
   */
  private renderCommandsAction() {
    if (!this.runtime().supportedCompletionKinds.has("command")) return null;
    const commandMode = this.currentInputMode.kind === "command";
    return html`
      <button
        class="composer-commands icon-button"
        ?disabled=${this.disabled || this.dictationBlocksComposer() || (!this.draftEmpty && !commandMode)}
        title="Choose a command"
        aria-label="Commands"
        @click=${() => { if (this.dictationBlocksComposer()) return; this.closeSteer(false); this.draftElement?.beginCommandEntry(); }}
      >${renderSlashIcon()}</button>
    `;
  }

  private renderAttachmentAction(busy: boolean) {
    return html`
      <button
        class="composer-attach icon-button"
        ?disabled=${this.disabled || busy}
        title="Attach files"
        aria-label="Attach files"
        @click=${() => { this.closeSteer(false); this.openAttachmentPicker(); }}
      >${renderAttachIcon()}</button>
    `;
  }

  private onQueueClick(event: MouseEvent): void {
    if (this.queuePointerPress !== undefined || this.queueKeyboardPress !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.queueSuppressedClickId !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      this.clearQueueClickSuppression();
      return;
    }
    if (!this.rail().canInvokeQueue) return;
    this.closeSteer(false);
    this.submitDraft("followUp");
  }

  private onQueuePointerDown(event: PointerEvent): void {
    const rail = this.rail();
    if (!rail.canSteer || !rail.canInvokeQueue || !isPrimaryQueuePointerPress(event)) return;
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    if (this.queuePointerPress !== undefined) return;
    this.cancelQueuePress({ clearSuppression: true });
    this.queuePointerPress = { outcome: "pending", activationId: this.nextQueueActivation(), x: event.clientX, y: event.clientY, pointerId: event.pointerId, button };
    button.setPointerCapture(event.pointerId);
    this.queuePressTimer = setTimeout(() => { this.openSteerFromQueueHold(); }, COMPOSER_QUEUE_HOLD_MS);
  }

  private onQueuePointerMove(event: PointerEvent): void {
    const origin = this.queuePointerPress;
    if (origin === undefined) return;
    if (event.pointerId !== origin.pointerId || origin.outcome !== "pending") return;
    const travel = composerQueuePressTravel(event.clientX - origin.x, event.clientY - origin.y);
    if (readComposerQueuePress(travel, 0) === "abandoned") this.consumeQueuePointerPress();
  }

  private onQueuePointerUp(event: PointerEvent): void {
    const press = this.queuePointerPress;
    if (event.pointerId !== press?.pointerId) return;
    this.clearQueuePressTimer();
    this.releaseQueuePointerCapture(press);
    this.queuePointerPress = undefined;
    if (press.outcome === "consumed") this.armQueueClickSuppression(press.activationId);
  }

  private onQueuePointerCancel(event: PointerEvent): void {
    const press = this.queuePointerPress;
    if (event.pointerId !== press?.pointerId) return;
    this.clearQueuePressTimer();
    this.releaseQueuePointerCapture(press);
    this.queuePointerPress = undefined;
  }

  private onQueueKeyDown(event: KeyboardEvent): void {
    const rail = this.rail();
    if (!rail.canSteer || !rail.canInvokeQueue || !isQueueHoldKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || this.queueKeyboardPress !== undefined) return;
    const key = event.key === "Enter" ? "Enter" : " ";
    this.cancelQueuePress({ clearSuppression: true });
    this.queueKeyboardPress = { outcome: "pending", activationId: this.nextQueueActivation(), key };
    this.queuePressTimer = setTimeout(() => { this.openSteerFromQueueHold(); }, COMPOSER_QUEUE_HOLD_MS);
  }

  private onQueueKeyUp(event: KeyboardEvent): void {
    const press = this.queueKeyboardPress;
    if (event.key !== press?.key) return;
    event.preventDefault();
    event.stopPropagation();
    const shouldQueue = press.outcome === "pending" && this.rail().canInvokeQueue;
    this.clearQueuePressTimer();
    this.queueKeyboardPress = undefined;
    this.armQueueClickSuppression(press.activationId);
    if (shouldQueue) this.submitDraft("followUp");
  }

  private onQueueBlur(): void {
    if (this.queueKeyboardPress?.outcome !== "pending") return;
    this.consumeQueueKeyboardPress();
  }

  private onQueueContextMenu(event: MouseEvent): void {
    const rail = this.rail();
    if (!rail.canSteer || !rail.canInvokeQueue) return;
    event.preventDefault();
    this.cancelQueuePress({ clearSuppression: true });
    this.armQueueClickSuppression(this.nextQueueActivation());
    this.openSteerDisclosure();
  }

  private openSteerFromQueueHold(): void {
    if (!this.consumeQueuePressForHold()) return;
    this.openSteerDisclosure();
  }

  private openSteerDisclosure(): void {
    const rail = this.rail();
    if (!rail.canSteer || !rail.canInvokeQueue) {
      this.resetSteerDisclosure();
      return;
    }
    this.closeChoice(false);
    this.draftElement?.closeCompletionMenu();
    this.steerOpen = true;
    void this.updateComplete.then(() => { this.steerConfirmButton?.focus(); });
  }

  private closeSteer(restoreFocus: boolean): void {
    if (!this.steerOpen) return;
    this.steerOpen = false;
    if (!restoreFocus) return;
    void this.updateComplete.then(() => {
      if (this.isConnected && this.rail().canSteer) this.queueTrigger?.focus();
    });
  }

  private resetSteerDisclosure(): void {
    this.consumeQueuePressForInvalidation();
    this.steerOpen = false;
  }

  private cancelQueuePress(options: { clearSuppression: boolean }): void {
    this.clearQueuePressTimer();
    const pointerPress = this.queuePointerPress;
    if (pointerPress !== undefined) this.releaseQueuePointerCapture(pointerPress);
    this.queuePointerPress = undefined;
    this.queueKeyboardPress = undefined;
    if (options.clearSuppression) this.clearQueueClickSuppression();
  }

  private consumeQueuePressForHold(): boolean {
    if (this.queuePointerPress?.outcome === "pending") {
      this.consumeQueuePointerPress();
      return true;
    }
    if (this.queueKeyboardPress?.outcome === "pending") {
      this.consumeQueueKeyboardPress();
      return true;
    }
    return false;
  }

  private consumeQueuePressForInvalidation(): void {
    this.consumeQueuePointerPress();
    this.consumeQueueKeyboardPress();
  }

  private consumeQueuePointerPress(): void {
    const press = this.queuePointerPress;
    if (press === undefined || press.outcome === "consumed") return;
    this.clearQueuePressTimer();
    this.queuePointerPress = { ...press, outcome: "consumed" };
  }

  private consumeQueueKeyboardPress(): void {
    const press = this.queueKeyboardPress;
    if (press === undefined || press.outcome === "consumed") return;
    this.clearQueuePressTimer();
    this.queueKeyboardPress = { ...press, outcome: "consumed" };
  }

  private clearQueuePressTimer(): void {
    if (this.queuePressTimer !== undefined) clearTimeout(this.queuePressTimer);
    this.queuePressTimer = undefined;
  }

  private releaseQueuePointerCapture(press: QueuePointerPress): void {
    if (press.button.hasPointerCapture(press.pointerId)) press.button.releasePointerCapture(press.pointerId);
  }

  private nextQueueActivation(): number {
    this.nextQueueActivationId += 1;
    return this.nextQueueActivationId;
  }

  private armQueueClickSuppression(activationId: number): void {
    this.clearQueueClickSuppression();
    this.queueSuppressedClickId = activationId;
    this.queueSuppressClickTimer = setTimeout(() => {
      if (this.queueSuppressedClickId === activationId) this.clearQueueClickSuppression();
    }, 0);
  }

  private clearQueueClickSuppression(): void {
    if (this.queueSuppressClickTimer !== undefined) clearTimeout(this.queueSuppressClickTimer);
    this.queueSuppressClickTimer = undefined;
    this.queueSuppressedClickId = undefined;
  }

  private confirmSteer(): void {
    const rail = this.rail();
    if (!this.steerOpen || !rail.canSteer || !rail.canInvokeQueue) {
      this.resetSteerDisclosure();
      return;
    }
    this.closeSteer(false);
    this.submitDraft("steer");
    void this.updateComplete.then(() => { this.focusInput(); });
  }

  private submitDraft(streamingBehavior?: "steer" | "followUp"): void {
    if (this.dictationBlocksComposer()) return;
    this.draftElement?.submit(streamingBehavior);
  }

  private flushPendingReplacement(): void {
    if (this.pendingReplacement === undefined || this.draftElement === undefined || this.draftElement === null) return;
    const replacement = this.pendingReplacement;
    this.pendingReplacement = undefined;
    if (replacement.kind === "snapshot") this.draftElement.restoreTransientSnapshot(replacement.snapshot);
    else this.draftElement.replaceText(replacement.text);
  }

  private sendSnapshot(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp"): ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome> {
    const rail = this.rail();
    if (!this.canSubmitDraftSnapshot(rail, streamingBehavior)) return "rejected";
    if (this.onDraftSubmit !== undefined) return this.onDraftSubmit(snapshot);
    void this.onSend?.(snapshot.text, streamingBehavior, snapshot.attachments, snapshot.delivery);
    return "accepted";
  }

  private canSubmitDraftSnapshot(rail: ComposerRail, streamingBehavior: "steer" | "followUp" | undefined): boolean {
    if (rail.kind === "stopOnly") return false;
    if (rail.kind === "idle") return streamingBehavior === undefined && rail.canInvokePrimary;
    if (!rail.canInvokeQueue) return false;
    return streamingBehavior === "followUp" || (streamingBehavior === "steer" && rail.canSteer);
  }

  private handleDraftEscape(context: ComposerDraftEscapeContext): boolean {
    if (this.disabled || !this.runtimeControlsAvailable) return false;

    if (this.rail().canStop) {
      this.stop();
      return true;
    }
    if (context.inputMode.kind === "shell") return false;
    if (context.draft.trim() !== "") return false;

    const action = this.doubleEscapeAction ?? "tree";
    if (action === "none") return true;
    const now = Date.now();
    if (now - this.lastEscapeTime < 500) {
      this.lastEscapeTime = 0;
      this.onDoubleEscapeAction?.(action);
    } else {
      this.lastEscapeTime = now;
    }
    return true;
  }

  /** The shared draft, for hosts that must drive it imperatively. */
  get draft(): ComposerDraft | undefined {
    return this.draftElement ?? undefined;
  }

  private syncDictationCapability(): void {
    if (!this.isConnected) return;
    const capability = this.capabilities.dictation;
    if (capability === undefined) {
      if (this.dictationController !== undefined || this.dictationStatusAbort !== undefined || this.dictationStatusTimer !== undefined) this.disposeDictation();
      return;
    }
    this.ensureDictationController(capability);
    if (this.dictationStatusTimer === undefined && this.dictationStatusAbort === undefined) this.loadDictationStatus();
  }

  private ensureDictationController(capability: ComposerDictationCapability): PromptDictationController | undefined {
    if (this.draftElement === undefined || this.draftElement === null) return undefined;
    if (this.dictationController !== undefined) return this.dictationController;
    const ownerKey = () => dictationOwnerKey(this.machineId, this.sessionId, this.cwd);
    this.dictationController = new PromptDictationController({
      scheduler: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => { if (typeof handle === "number") window.clearTimeout(handle); },
      },
      draft: {
        get ownerKey() { return ownerKey(); },
        beginDictation: () => this.draftElement?.beginDictationEdit() ?? false,
        commitTranscript: (transcript) => this.draftElement?.commitDictationTranscript(transcript) ?? false,
        // The lock is released here, which is the one moment the transcript is
        // in the draft and the draft is the reader's again. A voice turn
        // starts counting from exactly that point.
        finishDictation: () => {
          this.draftElement?.finishDictationEdit();
          if (this.voiceMode === "voice-first") this.voiceTurn.heard(this.draftElement?.getText() ?? "");
        },
        abortDictation: () => { this.draftElement?.abortDictationEdit(); },
      },
      speechApi: capability.speechApi,
      // Everything the controller asked for is forwarded untouched; the tap is
      // additive. It exists so a listening reader can see that the microphone
      // is getting their voice, which no status wording can substitute for.
      createCaptureSession: async (options) => {
        const session = await capability.createCaptureSession({
          ...options,
          onSpeechActivity: (activity) => {
            this.voiceTurn.noteSpeech(activity, this.dictationSampleRateHz);
            options.onSpeechActivity(activity);
          },
        });
        this.dictationSampleRateHz = session.actualSampleRateHz;
        return session;
      },
      onStateChange: (state) => {
        this.dictationState = state;
        if (this.voiceMode === "voice-first") this.voiceTurn.noteDictation(state);
        if (this.dictationBlocksComposer()) {
          this.closeChoice(false);
          this.resetSteerDisclosure();
        }
        this.applyPendingDictationStatusIfSettled();
      },
    });
    this.dictationController.setCapability(this.dictationCapability, this.dictationStatusMessage);
    return this.dictationController;
  }

  private resetDictationCapability(): void {
    this.disposeDictation();
    if (this.capabilities.dictation !== undefined) {
      this.dictationCapability = "warming";
      this.dictationStatusMessage = "Speech dictation is warming up.";
      this.dictationState = { tag: "idle" };
    }
  }

  private disposeDictation(): void {
    this.dictationController?.dispose();
    this.dictationController = undefined;
    this.dictationState = { tag: "idle" };
    this.pendingDictationStatus = undefined;
    this.resetDictationGesture();
    this.stopDictationStatusPolling();
  }

  private loadDictationStatus(): void {
    if (!this.isConnected) return;
    const capability = this.capabilities.dictation;
    if (capability === undefined) return;
    this.stopDictationStatusRequest();
    const version = ++this.dictationStatusVersion;
    const abort = new AbortController();
    this.dictationStatusAbort = abort;
    void capability.getStatus({ signal: abort.signal, timeoutMs: DICTATION_STATUS_TIMEOUT_MS }).then((status) => {
      if (this.dictationStatusVersion !== version || abort.signal.aborted) return;
      this.receiveDictationStatus({ kind: "status", status });
    }).catch((error: unknown) => {
      if (this.dictationStatusVersion !== version || abort.signal.aborted) return;
      this.receiveDictationStatus({
        kind: "error",
        message: error instanceof Error && error.message !== "" ? error.message : "Speech dictation status is unavailable.",
      });
    }).finally(() => {
      if (this.dictationStatusVersion !== version) return;
      this.dictationStatusAbort = undefined;
      this.scheduleDictationStatusPoll();
    });
  }

  private receiveDictationStatus(status: PendingDictationStatus): void {
    if (this.dictationBlocksComposer() && !pendingDictationStatusCanApplyDuringActiveTurn(status)) {
      this.pendingDictationStatus = status;
      return;
    }
    this.pendingDictationStatus = undefined;
    this.applyDictationStatus(status);
  }

  private applyPendingDictationStatusIfSettled(): void {
    if (this.pendingDictationStatus === undefined || this.dictationBlocksComposer()) return;
    const status = this.pendingDictationStatus;
    this.pendingDictationStatus = undefined;
    this.applyDictationStatus(status);
  }

  private applyDictationStatus(status: PendingDictationStatus): void {
    if (status.kind === "error") {
      this.dictationCapability = "unavailable";
      this.dictationStatusMessage = status.message;
      this.dictationController?.setCapability("unavailable", status.message);
      return;
    }
    this.dictationCapability = status.status.capability;
    this.dictationStatusMessage = dictationStatusMessage(status.status);
    this.dictationController?.setCapability(status.status.capability, status.status.capability === "manual-only" ? "smart-turn-unavailable" : this.dictationStatusMessage);
  }

  private scheduleDictationStatusPoll(): void {
    const capability = this.capabilities.dictation;
    if (capability === undefined || !this.isConnected) return;
    if (this.dictationStatusTimer !== undefined) window.clearTimeout(this.dictationStatusTimer);
    this.dictationStatusTimer = window.setTimeout(() => {
      this.dictationStatusTimer = undefined;
      this.loadDictationStatus();
    }, capability.statusPollIntervalMs ?? 10_000);
  }

  private stopDictationStatusPolling(): void {
    this.dictationStatusVersion += 1;
    this.stopDictationStatusRequest();
    if (this.dictationStatusTimer !== undefined) window.clearTimeout(this.dictationStatusTimer);
    this.dictationStatusTimer = undefined;
  }

  private stopDictationStatusRequest(): void {
    this.dictationStatusAbort?.abort();
    this.dictationStatusAbort = undefined;
  }

  private handleDictationPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.dictationGestureSource !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    this.dictationGestureSource = { tag: "pointer", pointerId: event.pointerId, target: button };
    if (!this.dictationGesture.press()) {
      this.dictationGestureSource = undefined;
      return;
    }
    try { button?.setPointerCapture(event.pointerId); } catch { /* happy-dom and lost pointers may not support capture. */ }
  }

  private handleDictationPointerUp(event: PointerEvent): void {
    if (!this.matchesDictationPointer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.releaseDictationPointerCapture();
    this.dictationGestureSource = undefined;
    this.dictationGesture.release();
  }

  private handleDictationPointerCancel(event: PointerEvent): void {
    if (!this.matchesDictationPointer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.releaseDictationPointerCapture();
    this.dictationGestureSource = undefined;
    this.dictationGesture.cancel();
  }

  private handleDictationLostPointerCapture(event: PointerEvent): void {
    if (!this.matchesDictationPointer(event)) return;
    this.dictationGestureSource = undefined;
    this.dictationGesture.cancel();
  }

  private matchesDictationPointer(event: PointerEvent): boolean {
    return this.dictationGestureSource?.tag === "pointer" && this.dictationGestureSource.pointerId === event.pointerId;
  }

  private releaseDictationPointerCapture(): void {
    const source = this.dictationGestureSource;
    if (source?.tag !== "pointer") return;
    try {
      if (source.target?.hasPointerCapture(source.pointerId) === true) source.target.releasePointerCapture(source.pointerId);
    } catch { /* ignored */ }
  }

  private handleDictationClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    // Pointer activation is owned by pointerdown/up so hold duration remains
    // observable. Native keyboard and assistive activation has detail 0 and
    // reaches this click path as one short tap.
    if (event instanceof MouseEvent && event.detail > 0) return;
    if (this.dictationGestureSource !== undefined) return;
    this.activateDictationShortTap();
  }

  private handleDictationKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.releaseDictationPointerCapture();
      this.dictationGestureSource = undefined;
      if (!this.dictationGesture.cancel()) this.dictationController?.cancel();
      return;
    }
    if (event.key === "Enter") {
      if (!this.dictationCanCompleteFromKey()) return;
      event.preventDefault();
      this.dictationController?.press();
      return;
    }
    if (event.key !== " ") return;
    event.preventDefault();
    if (this.dictationCanCompleteFromKey()) {
      this.dictationController?.press();
      return;
    }
    if (this.dictationGestureSource !== undefined) return;
    this.dictationGestureSource = { tag: "space" };
    if (!this.dictationGesture.press()) this.dictationGestureSource = undefined;
  }

  private handleDictationKeyUp(event: KeyboardEvent): void {
    if (event.key !== " " || this.dictationGestureSource?.tag !== "space") return;
    event.preventDefault();
    this.dictationGestureSource = undefined;
    this.dictationGesture.release();
  }

  private activateDictationShortTap(): boolean {
    if (!this.dictationGesture.press()) return false;
    this.dictationGesture.release();
    return true;
  }

  private createDictationGesture(): PromptDictationGesture {
    return new PromptDictationGesture({
      callbacks: {
        onPressStart: () => this.dictationController?.press() === true,
        onRelease: () => { this.dictationController?.release(); },
        onCancel: () => { this.dictationController?.cancel(); },
      },
    });
  }

  private resetDictationGesture(): void {
    this.releaseDictationPointerCapture();
    this.dictationGestureSource = undefined;
    this.dictationGesture.dispose();
    this.dictationGesture = this.createDictationGesture();
  }

  private dictationCanCompleteFromKey(): boolean {
    return this.dictationState.tag === "auto" || this.dictationState.tag === "manual-only" || this.dictationState.tag === "checking" || this.dictationState.tag === "held";
  }

  private dictationBlocksComposer(): boolean {
    return this.dictationState.tag === "acquiring"
      || this.dictationState.tag === "pressed"
      || this.dictationState.tag === "auto"
      || this.dictationState.tag === "held"
      || this.dictationState.tag === "manual-only"
      || this.dictationState.tag === "checking"
      || this.dictationState.tag === "transcribing"
      || this.dictationState.tag === "retained-retry";
  }

  private dictationView(): { readonly label: string; readonly status: string; readonly pressed: boolean; readonly disabled: boolean } {
    const state = this.dictationState;
    if (this.dictationCapability === "warming" && (state.tag === "idle" || state.tag === "unavailable")) return { label: "Speech dictation warming up", status: this.dictationStatusMessage, pressed: false, disabled: true };
    if (this.dictationCapability === "unavailable" && (state.tag === "idle" || state.tag === "unavailable")) return { label: "Speech dictation unavailable", status: this.dictationStatusMessage, pressed: false, disabled: true };
    switch (state.tag) {
      case "acquiring": return { label: "Starting speech dictation", status: state.gesture === "held" ? "Starting held dictation…" : "Starting microphone…", pressed: true, disabled: false };
      case "pressed": return { label: "Release for automatic speech dictation, or hold to keep listening", status: "Release for automatic dictation, or hold to keep listening.", pressed: true, disabled: false };
      case "auto": return { label: "Finish speech dictation", status: "Listening. Press again to transcribe, or pause for automatic completion.", pressed: true, disabled: false };
      case "held": return { label: "Release to transcribe held speech dictation", status: "Holding dictation. Release to transcribe.", pressed: true, disabled: false };
      case "manual-only": return { label: "Finish manual speech dictation", status: manualOnlyDictationStatus(state.reason), pressed: true, disabled: false };
      case "checking": return { label: "Finish speech dictation", status: "Checking whether the speech turn is complete…", pressed: true, disabled: false };
      case "transcribing": return { label: "Transcribing speech dictation", status: "Transcribing speech…", pressed: false, disabled: true };
      case "empty": return { label: "Start speech dictation", status: "No speech was transcribed. Press the microphone to try again.", pressed: false, disabled: false };
      case "retained-retry": return { label: "Retry speech dictation from retained audio", status: retainedRetryDictationStatus(state), pressed: false, disabled: false };
      case "error": return { label: state.retryable ? "Retry speech dictation" : "Speech dictation error", status: state.message, pressed: false, disabled: false };
      case "unavailable": return { label: "Speech dictation unavailable", status: state.reason, pressed: false, disabled: true };
      case "idle": return this.dictationCapability === "manual-only"
        ? { label: "Start manual speech dictation", status: `${this.dictationStatusMessage} This gateway, not the selected machine · raw audio not stored.`, pressed: false, disabled: false }
        : { label: "Start speech dictation", status: `${this.dictationStatusMessage} This gateway, not the selected machine · raw audio not stored.`, pressed: false, disabled: false };
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      this.resetDictationGesture();
      this.dictationController?.pageBackgrounded();
    }
  };

  private readonly handlePageHidden = (): void => {
    this.resetDictationGesture();
    this.dictationController?.pageBackgrounded();
  };

  private readonly handleResizeOrOrientation = (): void => {
    this.dictationController?.resizeOrOrientationChanged();
  };

  private updateDraftDisplayState(state: ComposerDraftDisplayState): void {
    this.onDraftDisplayStateChange?.(state);
    this.currentInputMode = state.inputMode;
    this.draftEmpty = state.empty;
    this.attachmentCount = state.attachmentCount;
    this.attachmentCapturePending = state.attachmentCapturePending;
    this.composerFocused = state.focused || this.composerFocused;
  }

  static override styles = [promptEditorStyles, voiceTurnStyles];
}

function promptHistoryChanged(value: readonly string[], previous: readonly string[] | undefined): boolean {
  if (value === previous) return false;
  if (previous?.length !== value.length) return true;
  return value.some((entry, index) => entry !== previous[index]);
}

function dictationOwnerKey(machineId: unknown, sessionId: unknown, cwd: unknown): string {
  return JSON.stringify({ machineId: dictationOwnerPart(machineId), sessionId: dictationOwnerPart(sessionId), cwd: dictationOwnerPart(cwd) });
}

function dictationOwnerPart(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pendingDictationStatusCanApplyDuringActiveTurn(status: PendingDictationStatus): boolean {
  return status.kind === "status" && (status.status.capability === "ready" || status.status.capability === "manual-only");
}

function dictationStatusMessage(status: SpeechServiceStatusResponse): string {
  if (status.capability === "ready") return "Speech dictation is ready.";
  if (status.capability === "manual-only") return "Speech dictation is ready for manual completion. Automatic completion is unavailable.";
  if (status.capability === "warming") return "Speech dictation is warming up.";
  if (status.whisper !== "ready") return "Speech dictation is unavailable because Whisper is not ready.";
  return "Speech dictation is unavailable.";
}

function manualOnlyDictationStatus(reason: Extract<PromptDictationState, { readonly tag: "manual-only" }>["reason"]): string {
  const readable = manualOnlyReasonLabel(reason);
  return `Automatic completion unavailable (${readable}). Press the microphone to transcribe.`;
}

function manualOnlyReasonLabel(reason: Extract<PromptDictationState, { readonly tag: "manual-only" }>["reason"]): string {
  switch (reason) {
    case "detector-failed": return "detector failed";
    case "endpoint-busy": return "endpoint busy";
    case "endpoint-budget": return "endpoint budget reached";
    case "endpoint-failed": return "endpoint failed";
    case "smart-turn-unavailable": return "Smart Turn unavailable";
  }
}

function retainedRetryDictationStatus(state: Extract<PromptDictationState, { readonly tag: "retained-retry" }>): string {
  return `Transcription failed (${retainedRetryReasonLabel(state.reason)}). Press the microphone to retry retained audio, or discard. Audio expires in ${String(retainedRetrySecondsRemaining(state.expiresAtMs))}s.`;
}

function retainedRetryReasonLabel(reason: string): string {
  if (reason === "overloaded") return "service busy";
  if (reason === "timeout") return "request timed out";
  if (reason === "network") return "network error";
  if (reason === "speech_failed") return "speech failed";
  if (reason === "speech_unavailable") return "speech unavailable";
  return reason;
}

function retainedRetrySecondsRemaining(expiresAtMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000));
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

export interface PromptComposerRestingInput {
  chromeSummoned: boolean;
  focused: boolean;
  draft: string;
  attachmentCount: number;
}

/**
 * Whether the composer can stand down to a single line.
 *
 * Only where the conversation owns the screen: on a docked pane the vertical
 * space is not contested, so collapsing would cost discoverability and buy
 * nothing. Anything in hand — focus, typed text, a pending attachment — keeps
 * the composer open, because a surface that hides work in progress reads as
 * having lost it.
 */
export function promptComposerIsResting(input: PromptComposerRestingInput): boolean {
  if (!input.chromeSummoned) return false;
  if (input.focused) return false;
  if (input.attachmentCount > 0) return false;
  return input.draft.trim() === "";
}

function modelChoiceValue(model: ComposerSelectableModel): string {
  return `${model.provider ?? ""}/${model.id ?? ""}`;
}

function modelDisplayName(model: ComposerSelectableModel): string {
  return model.name === undefined || model.name === "" ? (model.id ?? "no model") : model.name;
}

/** Pi owns the levels; these describe only the ones it documents. */
function thinkingLevelDetail(level: string): string | undefined {
  switch (level) {
    case "off": return "No reasoning";
    case "minimal": return "Very brief reasoning (~1k tokens)";
    case "low": return "Light reasoning (~2k tokens)";
    case "medium": return "Moderate reasoning (~8k tokens)";
    case "high": return "Deep reasoning (~16k tokens)";
    case "xhigh": return "Maximum reasoning (~32k tokens)";
    default: return undefined;
  }
}
