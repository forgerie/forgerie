import { EditorView } from "@codemirror/view";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { DoubleEscapeAction, PromptAttachment, PromptAttachmentDelivery, SessionStatus } from "../../../shared/apiTypes";
import { sessionGuidanceSummary } from "../../../shared/sessionGuidance";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import { createSessionComposerRuntime, type ComposerRuntime } from "../composerRuntime";
import { composerRail, type ComposerRail } from "../composerRail";
import { inputModeForDraft, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { NEW_SESSION_LABEL, promptEditorStyles, renderNewSessionIcon } from "./shared";
import { renderArchiveIcon, renderAttachIcon, renderBranchIcon, renderDismissIcon, renderGuidanceIcon, renderQueueIcon, renderSendIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { DEFAULT_COMPOSER_EDITOR_LABEL, DEFAULT_COMPOSER_PLACEHOLDER } from "./ComposerDraft";
import type { ComposerCapabilities, ComposerContextChip, ComposerModelCapability, ComposerSelectableModel } from "../composerCapabilities";
import type { ComposerChoiceGroup, ComposerChoiceItem } from "./ComposerChoiceList";
import { modelChoiceGroups } from "./modelChoiceGroups";
import "./ComposerChoiceList";
import type { ComposerDraft, ComposerDraftCompletionError, ComposerDraftDisplayState, ComposerDraftEscapeContext, ComposerDraftSubmitOutcome, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import "./ComposerDraft";
import "./ContextUsageMeter";
import "./GuidancePicker";
import "./ComposerPopover";

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
  @property() placeholderText?: string;
  @property() editorLabel?: string;
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
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false, hasChanged: promptHistoryChanged }) promptHistory: readonly string[] = [];
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void | Promise<void>;
  @property({ attribute: false }) onDoubleEscapeAction?: (action: Exclude<DoubleEscapeAction, "none">) => void;
  /** Set when the shell keeps its navigation chrome on request instead of resident. */
  @property({ type: Boolean }) chromeSummoned = false;

  @query("composer-draft") private draftElement?: ComposerDraft | null;
  @query(".guidance-trigger") private guidanceTrigger?: HTMLButtonElement;
  @query(".select-model") private modelTrigger?: HTMLButtonElement;
  @query(".select-thinking") private thinkingTrigger?: HTMLButtonElement;

  @state() private composerFocused = false;
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private draftEmpty = true;
  @state() private attachmentCount = 0;
  @state() private attachmentCapturePending = false;
  @state() private guidanceOpen = false;
  /** Which choice is open; only ever one, because there is one layer. */
  @state() private openChoice: "model" | "thinking" | undefined = undefined;
  @state() private choiceModels: readonly ComposerSelectableModel[] = [];
  @state() private choiceError: string | undefined = undefined;
  @state() private choiceLoading = false;
  @state() private guidancePending = false;
  @state() private guidanceError: string | undefined = undefined;
  private guidanceRequestVersion = 0;
  private choiceRequestVersion = 0;
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
      ${this.openChoice === undefined || this.capabilities.model === undefined ? nothing : this.renderChoicePopover(this.capabilities.model)}
      ${this.guidanceOpen ? html`
        <composer-popover
          label="Session guidance"
          .anchor=${this.guidanceTrigger}
          .onClose=${(restoreFocus: boolean) => { this.closeGuidance(restoreFocus); }}
        >
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
        </composer-popover>
      ` : null}
      <footer
        class=${this.footerClass(shellMode, resting)}
        @focusin=${() => { this.composerFocused = true; }}
        @focusout=${(event: FocusEvent) => { this.releaseComposerFocus(event); }}
      >
        ${this.capabilities.contextUsage === undefined ? nothing : html`<context-usage-meter .contextUsage=${this.capabilities.contextUsage}></context-usage-meter>`}
        <composer-draft
          .disabled=${this.disabled}
          .submissionDisabled=${busy || !this.submissionAvailable}
          .working=${rail.kind === "queueCapable"}
          .compacting=${this.isCompacting}
          .resting=${resting}
          .runtime=${this.runtime()}
          .promptHistory=${this.promptHistory}
          .storageKey=${this.draftStorageKey()}
          .placeholderText=${this.placeholderText ?? DEFAULT_COMPOSER_PLACEHOLDER}
          .editorLabel=${this.editorLabel ?? DEFAULT_COMPOSER_EDITOR_LABEL}
          .onSubmit=${(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp") => this.sendSnapshot(snapshot, streamingBehavior)}
          .onEscape=${(context: ComposerDraftEscapeContext) => this.handleDraftEscape(context)}
          .onDisplayStateChange=${(state: ComposerDraftDisplayState) => { this.updateDraftDisplayState(state); }}
          .onDraftEdited=${this.onDraftEdited}
          .onCompletionError=${this.onCompletionError}
        ></composer-draft>
        <div class="actions">
          ${this.renderAttachmentAction(busy)}
          ${this.renderArchiveAction()}
          ${this.renderCompactStatus()}
          ${this.capabilities.newSession === undefined ? nothing : html`
            <button
              class="icon-button new-session-button"
              data-action="new-session"
              title=${NEW_SESSION_LABEL}
              aria-label=${NEW_SESSION_LABEL}
              @click=${() => { this.closeGuidance(false, true); this.capabilities.newSession?.onNewSession(); }}
            >${renderNewSessionIcon()}</button>
          `}
          ${this.renderDismissAction()}
          ${this.renderPrimaryAction(rail)}
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
   * `canSteer` arrives as "the agent is speaking"; the rail keeps that separate
   * from the broader stoppable-work state so shell-only and pending-only work
   * can stop without exposing unsupported follow-up delivery.
   */
  private rail(): ComposerRail {
    return composerRail({
      disabled: this.disabled || !this.submissionAvailable || !this.sendAvailable,
      sending: this.sending || this.guidancePending || this.attachmentCapturePending,
      isStreaming: this.canSteer,
      isCompacting: this.isCompacting,
      stoppable: this.capabilities.stop?.stoppable === true,
    });
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
        @click=${() => { this.closeGuidance(false, true); this.closeChoice(false); dismiss.onDismiss(); }}
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
            title=${rail.canStop ? "Stop current work and clear queued messages" : "Nothing running"}
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
    return html`
      <button
        class="icon-button queue-button"
        ?disabled=${!rail.canInvokeQueue}
        title="Queue until the current activity finishes"
        aria-label="Queue message"
        @click=${() => { this.submitDraft("followUp"); }}
      >${renderQueueIcon()}</button>
    `;
  }

  private renderCompactStatus() {
    const context = this.capabilities.context ?? [];
    const model = this.capabilities.model;
    const guidance = this.capabilities.guidance;
    if (context.length === 0 && model === undefined && guidance === undefined) return null;
    return html`
      <div class=${`compact-status${this.chromeSummoned ? " summoned" : ""}`} aria-label="Composer status">
        ${context.map((chip) => this.renderContextChip(chip))}
        ${model === undefined ? nothing : this.renderModelCapsule(model)}
        ${guidance === undefined ? nothing : html`
          <button
            id="guidance-trigger"
            class="icon-button guidance-trigger"
            aria-controls="session-guidance-picker"
            aria-expanded=${this.guidanceOpen ? "true" : "false"}
            title=${sessionGuidanceSummary(guidance.activeIds)}
            aria-label=${sessionGuidanceSummary(guidance.activeIds)}
            @click=${() => { this.toggleGuidance(); }}
          >${renderGuidanceIcon()}${guidance.activeIds.length === 0 ? nothing : html`<span class="guidance-count" aria-hidden="true">${guidance.activeIds.length}</span>`}</button>
        `}
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
        <button class="select-model" ?disabled=${this.disabled || !changeable} title=${`Select model: ${identity}`} @click=${() => { this.selectModel(); }}>${name}</button>
        <button class="select-thinking icon-button" ?disabled=${this.disabled || !changeable} title=${`Thinking level: ${thinking}`} aria-label=${`Thinking level: ${thinking}`} @click=${() => { this.selectThinking(); }}>
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
          ?disabled=${this.disabled || action.disabled === true}
          title=${action.label}
          aria-label=${action.label}
          @click=${() => { action.onActivate(); }}
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
    stop.onStop();
  }

  private selectModel(): void {
    const model = this.capabilities.model;
    if (this.disabled || model === undefined || model.changeable === false) return;
    this.closeGuidance(false, true);
    if (this.openChoice === "model") {
      this.closeChoice(true);
      return;
    }
    this.openChoice = "model";
    void this.loadChoiceModels(model);
  }

  private selectThinking(): void {
    const model = this.capabilities.model;
    if (this.disabled || model === undefined || model.changeable === false) return;
    this.closeGuidance(false, true);
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
      success = await this.capabilities.guidance?.onSet(entryId, enabled) ?? false;
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
    if (this.capabilities.archive === undefined) return null;
    return html`
      <button
        class="composer-archive icon-button"
        title="Archive this session and open the next one waiting for you"
        aria-label="Archive &amp; next"
        @click=${() => { this.closeGuidance(false, true); this.capabilities.archive?.onArchiveAndNext(); }}
      >${renderArchiveIcon()}</button>
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

  private sendSnapshot(snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp"): ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome> {
    if (this.rail().kind === "stopOnly") return "rejected";
    if (this.onDraftSubmit !== undefined) return this.onDraftSubmit(snapshot);
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

  /** The shared draft, for hosts that must drive it imperatively. */
  get draft(): ComposerDraft | undefined {
    return this.draftElement ?? undefined;
  }

  private updateDraftDisplayState(state: ComposerDraftDisplayState): void {
    this.onDraftDisplayStateChange?.(state);
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
// cares about (canSteer/isCompacting/sending) is passed as a separate
// property or capability that Lit already diffs by value. Comparing just these fields lets us
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
