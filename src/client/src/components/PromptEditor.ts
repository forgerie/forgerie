import { EditorView } from "@codemirror/view";
import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { DoubleEscapeAction, PromptAttachment, PromptAttachmentDelivery, SessionStatus } from "../../../shared/apiTypes";
import { sessionGuidanceSummary } from "../../../shared/sessionGuidance";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import { createSessionComposerRuntime, type ComposerRuntime } from "../composerRuntime";
import { composerRail, type ComposerRail } from "../composerRail";
import { inputModeForDraft, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { NEW_SESSION_LABEL, promptEditorStyles, renderNewSessionIcon } from "./shared";
import { renderArchiveIcon, renderAttachIcon, renderQueueIcon, renderSendIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import type { ComposerDraft, ComposerDraftDisplayState, ComposerDraftEscapeContext, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import "./ComposerDraft";
import "./ContextUsageMeter";
import "./GuidancePicker";

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) submissionAvailable = true;
  @property({ type: Boolean }) runtimeControlsAvailable = true;
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) status?: SessionStatus;
  /** Drawn as the island's own top edge; absent below the reporting threshold. */
  @property({ attribute: false }) contextUsage?: SessionStatus["contextUsage"];
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false, hasChanged: promptHistoryChanged }) promptHistory: readonly string[] = [];
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void | Promise<void>;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onDoubleEscapeAction?: (action: Exclude<DoubleEscapeAction, "none">) => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  @property({ attribute: false }) onSetGuidance?: (entryId: string, enabled: boolean) => Promise<boolean>;
  /** Set when the shell keeps its navigation chrome on request instead of resident. */
  @property({ type: Boolean }) chromeSummoned = false;
  @property() sessionLabel?: string;
  @property({ type: Boolean }) canArchive = false;
  @property({ attribute: false }) onArchiveAndNext?: () => void;
  @property({ attribute: false }) onNewSession?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];

  @query("composer-draft") private draftElement?: ComposerDraft | null;
  @query(".guidance-trigger") private guidanceTrigger?: HTMLButtonElement;

  @state() private composerFocused = false;
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private draftEmpty = true;
  @state() private attachmentCount = 0;
  @state() private attachmentCapturePending = false;
  @state() private guidanceOpen = false;
  @state() private guidancePending = false;
  @state() private guidanceError: string | undefined = undefined;
  private guidanceRequestVersion = 0;
  private lastEscapeTime = 0;
  private pendingReplacement: { kind: "text"; text: string } | { kind: "snapshot"; snapshot: ComposerDraftSubmitSnapshot } | undefined;
  private cachedRuntimeKey = "";
  private cachedRuntime: ComposerRuntime = createSessionComposerRuntime({ machineId: "local" });

  protected override willUpdate(changed: PropertyValues<this>): void {
    const sessionChanged = changed.has("sessionId") || changed.has("machineId");
    if (sessionChanged) {
      this.lastEscapeTime = 0;
      this.resetGuidanceDisclosure();
    }
    if (changed.has("runtimeControlsAvailable") && !this.runtimeControlsAvailable) this.resetGuidanceDisclosure();
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    // Status updates churn once per token during streaming and hand us a fresh
    // object reference each time. When nothing else changed, only re-render if a
    // status field the template actually displays differs, so streaming does not
    // disturb the editor DOM (and any in-progress touch gesture survives).
    if (changed.has("status") && changed.size === 1) {
      return !sessionStatusRenderEqual(changed.get("status"), this.status);
    }
    return true;
  }

  protected override updated(): void {
    this.flushPendingReplacement();
  }

  override disconnectedCallback(): void {
    this.resetGuidanceDisclosure();
    super.disconnectedCallback();
  }

  override render() {
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const rail = this.rail();
    const busy = this.sending || this.guidancePending;
    const resting = this.isResting();
    return html`
      ${this.guidanceOpen ? html`
        <guidance-picker
          id="session-guidance-picker"
          .activeIds=${this.status?.activeGuidanceIds ?? []}
          .pending=${this.guidancePending}
          .working=${this.canSteer || this.isCompacting}
          .readOnly=${this.disabled || !this.runtimeControlsAvailable}
          .error=${this.guidanceError}
          .trigger=${this.guidanceTrigger}
          .onToggle=${(entryId: string, enabled: boolean) => { void this.setGuidance(entryId, enabled); }}
          .onClose=${(restoreFocus: boolean) => { this.closeGuidance(restoreFocus); }}
        ></guidance-picker>
      ` : null}
      <footer
        class=${this.footerClass(shellMode, resting)}
        @focusin=${() => { this.composerFocused = true; }}
        @focusout=${(event: FocusEvent) => { this.releaseComposerFocus(event); }}
      >
        <context-usage-meter .contextUsage=${this.contextUsage}></context-usage-meter>
        <composer-draft
          .disabled=${this.disabled}
          .submissionDisabled=${busy || !this.submissionAvailable}
          .working=${rail.kind === "working"}
          .compacting=${this.isCompacting}
          .resting=${resting}
          .runtime=${this.runtime()}
          .promptHistory=${this.promptHistory}
          .storageKey=${this.draftStorageKey()}
          .onSubmit=${(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp") => this.sendSnapshot(snapshot, streamingBehavior)}
          .onEscape=${(context: ComposerDraftEscapeContext) => this.handleDraftEscape(context)}
          .onDisplayStateChange=${(state: ComposerDraftDisplayState) => { this.updateDraftDisplayState(state); }}
        ></composer-draft>
        <div class="actions">
          ${this.renderAttachmentAction(busy)}
          ${this.renderArchiveAction()}
          ${this.renderCompactStatus()}
          <button
            class="icon-button new-session-button"
            data-action="new-session"
            title=${NEW_SESSION_LABEL}
            aria-label=${NEW_SESSION_LABEL}
            @click=${() => { this.closeGuidance(false, true); this.onNewSession?.(); }}
          >${renderNewSessionIcon()}</button>
          ${this.renderPrimaryAction(rail)}
          <button class="icon-button stop-button" ?disabled=${!rail.canStop} title=${rail.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => { this.stop(); }}>${renderStopIcon()}</button>
        </div>
      </footer>
    `;
  }

  private runtime(): ComposerRuntime {
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

  focusInput(): void {
    this.draftElement?.focusInput();
  }

  /**
   * Open the file picker from outside the composer.
   *
   * The island menu lives in the sheet, so the sheet needs a way in that still
   * honours the composer's own guard: an archived session, or one already
   * sending, must not be able to start an attachment.
   */
  private openAttachmentPicker(): void {
    if (this.disabled || this.sending || this.guidancePending) return;
    this.draftElement?.openAttachmentPicker();
  }

  replaceText(text: string): void {
    if (this.draftElement === undefined || this.draftElement === null) {
      this.pendingReplacement = { kind: "text", text };
      this.currentInputMode = inputModeForDraft(text);
      this.draftEmpty = text.trim() === "";
      return;
    }
    this.draftElement.replaceText(text);
  }

  restoreSnapshot(snapshot: ComposerDraftSubmitSnapshot): void {
    if (this.draftElement === undefined || this.draftElement === null) {
      this.pendingReplacement = { kind: "snapshot", snapshot };
      this.currentInputMode = inputModeForDraft(snapshot.text);
      this.draftEmpty = snapshot.text.trim() === "";
      return;
    }
    this.draftElement.restoreTransientSnapshot(snapshot);
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.draftElement?.view;
  }

  /**
   * What the rail offers right now.
   *
   * `canSteer` arrives as "the agent is speaking"; the rail turns that plus
   * compaction into the one question the controls actually ask.
   */
  private rail(): ComposerRail {
    return composerRail({
      disabled: this.disabled || !this.submissionAvailable,
      sending: this.sending || this.guidancePending || this.attachmentCapturePending,
      isStreaming: this.canSteer,
      isCompacting: this.isCompacting,
      stoppable: this.canStop,
    });
  }

  /**
   * Send and queue are the same slot, not two controls: a session that is not
   * working has nothing to queue behind. Steering joins the primary control as
   * its second half while the agent is speaking, so the rail gains a target
   * rather than a row.
   */
  private renderPrimaryAction(rail: ComposerRail) {
    const queues = rail.primaryAction === "queue";
    return html`
      <div class="primary-action">
        <button
          class="icon-button send-button"
          ?disabled=${!rail.canInvokePrimary}
          title=${queues ? "Queue until the current activity finishes" : "Send message"}
          aria-label=${queues ? "Queue message" : "Send message"}
          @click=${() => { this.submitDraft("followUp"); }}
        >${queues ? renderQueueIcon() : renderSendIcon()}</button>
        ${rail.canSteer ? html`<button
          class="icon-button steer-button"
          ?disabled=${!rail.canInvokePrimary}
          title="Steer the current response before the next model call"
          aria-label="Steer current response"
          @click=${() => { this.submitDraft("steer"); }}
        >${renderSteerIcon()}</button>` : null}
      </div>
    `;
  }

  private renderCompactStatus() {
    const status = this.status;
    if (status === undefined) return null;
    const model = status.model?.id ?? "no model";
    const provider = status.model?.provider !== undefined && status.model.provider !== "" ? `${status.model.provider}/` : "";
    const thinking = thinkingLevelLabel(status.thinkingLevel);
    return html`
      <div class=${`compact-status${this.chromeSummoned ? " summoned" : ""}`} aria-label="Session status">
        ${this.renderSessionIdentity()}
        <!-- Model and thinking level are read together and set together, so they
             share one capsule instead of spending two slots on the rail. -->
        <div class="model-capsule">
          <button class="select-model" ?disabled=${this.disabled || !this.runtimeControlsAvailable} title="Select model" @click=${() => { this.selectModel(); }}>${provider}${model}</button>
          <button class="select-thinking icon-button" ?disabled=${this.disabled || !this.runtimeControlsAvailable} title=${`Thinking level: ${thinking}`} aria-label=${`Thinking level: ${thinking}`} @click=${() => { this.selectThinking(); }}>
            ${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}<span class="thinking-level">${thinking}</span>
          </button>
        </div>
        <button
          id="guidance-trigger"
          class="guidance-trigger"
          aria-controls="session-guidance-picker"
          aria-expanded=${this.guidanceOpen ? "true" : "false"}
          title="Session guidance"
          @click=${() => { this.toggleGuidance(); }}
        >${sessionGuidanceSummary(status.activeGuidanceIds ?? [])}</button>
      </div>
    `;
  }

  /**
   * Where you are, inherited from the retired chrome bands.
   *
   * A narrow composer spends its row on controls that must always work. The
   * session identity appears only when the island's own width can carry it.
   */
  private renderSessionIdentity() {
    const label = this.sessionLabel;
    if (label === undefined || label === "") return null;
    return html`<span class="session-identity summoned-secondary" title=${label}>${label}</span>`;
  }

  private stop(): void {
    if (this.disabled || !this.runtimeControlsAvailable || !this.canStop) return;
    this.onStop?.();
  }

  private selectModel(): void {
    if (this.disabled || !this.runtimeControlsAvailable) return;
    this.closeGuidance(false, true);
    this.onSelectModel?.();
  }

  private selectThinking(): void {
    if (this.disabled || !this.runtimeControlsAvailable) return;
    this.closeGuidance(false, true);
    this.onSelectThinking?.();
  }

  private toggleGuidance(): void {
    if (this.guidanceOpen) {
      this.closeGuidance(true);
      return;
    }
    this.draftElement?.closeCompletionMenu();
    this.guidanceError = undefined;
    this.guidanceOpen = true;
  }

  private closeGuidance(restoreFocus: boolean, force = false): void {
    if (!this.guidanceOpen || (this.guidancePending && !force)) return;
    this.guidanceOpen = false;
    this.guidanceError = undefined;
    if (!restoreFocus) return;
    const requestVersion = this.guidanceRequestVersion;
    const trigger = this.guidanceTrigger;
    void this.updateComplete.then(() => {
      if (this.isConnected && requestVersion === this.guidanceRequestVersion && trigger === this.guidanceTrigger) trigger?.focus();
    });
  }

  private resetGuidanceDisclosure(): void {
    this.guidanceRequestVersion += 1;
    this.guidanceOpen = false;
    this.guidancePending = false;
    this.guidanceError = undefined;
  }

  private async setGuidance(entryId: string, enabled: boolean): Promise<void> {
    if (this.guidancePending || this.disabled || !this.runtimeControlsAvailable) return;
    const requestVersion = ++this.guidanceRequestVersion;
    this.guidancePending = true;
    this.guidanceError = undefined;
    let success: boolean;
    try {
      success = await this.onSetGuidance?.(entryId, enabled) ?? false;
    } catch {
      success = false;
    }
    if (requestVersion !== this.guidanceRequestVersion) return;
    this.guidancePending = false;
    if (success) {
      this.closeGuidance(true, true);
      return;
    }
    this.guidanceError = "Could not update guidance. Try again.";
  }

  private renderArchiveAction() {
    if (!this.canArchive) return null;
    return html`
      <button
        class="composer-archive icon-button"
        title="Archive this session and open the next one waiting for you"
        aria-label="Archive &amp; next"
        @click=${() => { this.closeGuidance(false, true); this.onArchiveAndNext?.(); }}
      >${renderArchiveIcon()}<span class="composer-archive-label">Archive &amp; next</span></button>
    `;
  }

  private renderAttachmentAction(busy: boolean) {
    return html`
      <button
        class="composer-attach icon-button"
        ?disabled=${this.disabled || busy}
        title="Attach files"
        aria-label="Attach files"
        @click=${() => { this.closeGuidance(false, true); this.openAttachmentPicker(); }}
      >${renderAttachIcon()}</button>
    `;
  }

  private submitDraft(streamingBehavior?: "steer" | "followUp"): void {
    this.draftElement?.submit(streamingBehavior);
  }

  private flushPendingReplacement(): void {
    if (this.pendingReplacement === undefined || this.draftElement === undefined || this.draftElement === null) return;
    const replacement = this.pendingReplacement;
    this.pendingReplacement = undefined;
    if (replacement.kind === "snapshot") this.draftElement.restoreTransientSnapshot(replacement.snapshot);
    else this.draftElement.replaceText(replacement.text);
  }

  private sendSnapshot(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp"): "accepted" {
    void this.onSend?.(snapshot.text, streamingBehavior, snapshot.attachments, snapshot.delivery);
    return "accepted";
  }

  private handleDraftEscape(context: ComposerDraftEscapeContext): boolean {
    if (this.disabled || !this.runtimeControlsAvailable) return false;

    const status = this.status;
    if (status?.isStreaming === true || status?.isCompacting === true || status?.isBashRunning === true) {
      this.stop();
      return true;
    }
    if (context.inputMode.kind === "shell") return false;
    if (context.draft.trim() !== "") return false;

    const action = status?.doubleEscapeAction ?? "tree";
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

  private updateDraftDisplayState(state: ComposerDraftDisplayState): void {
    this.currentInputMode = state.inputMode;
    this.draftEmpty = state.empty;
    this.attachmentCount = state.attachmentCount;
    this.attachmentCapturePending = state.attachmentCapturePending;
    this.composerFocused = state.focused || this.composerFocused;
  }

  static override styles = promptEditorStyles;
}

function promptHistoryChanged(value: readonly string[], previous: readonly string[] | undefined): boolean {
  if (value === previous) return false;
  if (previous?.length !== value.length) return true;
  return value.some((entry, index) => entry !== previous[index]);
}

// The only `status` fields the template reads directly are the model identity,
// thinking level, and guidance summary (shown in renderCompactStatus). Everything else the editor
// cares about (canSteer/canStop/isCompacting/sending) is passed as a separate
// property that Lit already diffs by value. Comparing just these fields lets us
// ignore the per-token status churn that does not change anything on screen.
function sessionStatusRenderEqual(a: SessionStatus | undefined, b: SessionStatus | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.model?.id === b.model?.id
    && a.model?.provider === b.model?.provider
    && a.thinkingLevel === b.thinkingLevel
    && stringArraysEqual(a.activeGuidanceIds ?? [], b.activeGuidanceIds ?? []);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
