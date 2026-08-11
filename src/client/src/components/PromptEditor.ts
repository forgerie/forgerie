import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type PromptAttachment, type SessionModel, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, promptAttachmentsCanUseInlineDelivery, type CapturedAttachment } from "../promptAttachmentCapture";
import { composerRail, type ComposerRail } from "../composerRail";
import { inputModeForDraft, inputModesEqual, type InputMode } from "../inputModes";
import { keyboardEventMatchesShortcut } from "../keyboardShortcuts";
import { machineSessionKey } from "../machineKeys";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, saveDraft } from "../promptDraftStorage";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "../attachmentPreferences";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { addPromptHistoryEntry, createPromptHistory, leavePromptHistory, navigatePromptHistory, type PromptHistoryState } from "../promptHistory";
import { NEW_SESSION_LABEL, promptEditorStyles, renderNewSessionIcon, type CompletionItem } from "./shared";
import { renderAttachIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";
import "./ContextUsageMeter";

type PendingAttachment = CapturedAttachment & { id: string };

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
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
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  /** Set when the chat surface has handed its chrome to an on-request sheet. */
  @property({ type: Boolean }) chromeSummoned = false;
  @property() sessionLabel?: string;
  @property({ type: Boolean }) canArchive = false;
  @property({ attribute: false }) onArchiveAndNext?: () => void;
  @property({ attribute: false }) onOpenControlSheet?: () => void;
  /** Warnings plus notifications waiting behind the island menu. */
  @property({ type: Number }) attentionCount = 0;
  @property({ attribute: false }) newSessionShortcut?: string;
  @property({ attribute: false }) onNewSession?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];
  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;
  // `draft` is the live document text but is intentionally NOT reactive: it
  // changes on every keystroke and the visible text is owned by CodeMirror, not
  // by Lit's render. Re-rendering the surrounding template on each keystroke is
  // wasted work and, on iOS, can interrupt an in-progress touch gesture (the
  // long-press edit/paste callout). Only `currentInputMode` (shell vs. normal)
  // is reactive, since that is the only draft-derived value the template shows.
  private draft = "";
  @state() private composerFocused = false;
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  @state() private attachments: PendingAttachment[] = [];
  @state() private attachmentDelivery: PromptAttachmentDelivery = loadAttachmentDelivery();
  @state() private attachmentError: string | undefined = undefined;
  private attachmentSeq = 0;
  private requestVersion = 0;
  private editor: EditorView | undefined;
  private promptHistoryState: PromptHistoryState = createPromptHistory();
  private applyingPromptHistory = false;
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly mobilePromptEnterMedia = createMobilePromptEnterMedia();
  private explicitShiftKeyActive = false;

  protected override willUpdate(changed: PropertyValues<this>) {
    const sessionChanged = changed.has("sessionId") || changed.has("machineId");
    if (sessionChanged) {
      const previousSessionId = changed.has("sessionId") ? changed.get("sessionId") : this.sessionId;
      const previousMachineId = changed.has("machineId") ? changed.get("machineId") : this.machineId;
      const previousKey = draftStorageKey(previousMachineId, previousSessionId);
      if (previousKey !== undefined) saveDraft(previousKey, this.draft);
      const currentKey = draftStorageKey(this.machineId, this.sessionId);
      this.draft = currentKey !== undefined ? loadDraft(currentKey) : "";
      this.currentInputMode = inputModeForDraft(this.draft);
      this.completions = [];
      this.selectedIndex = 0;
    }
    if (sessionChanged || changed.has("promptHistory")) {
      this.promptHistoryState = createPromptHistory(this.promptHistory);
    }
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

  override firstUpdated(): void {
    this.createEditor();
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("sessionId") || changed.has("machineId")) this.syncEditorDoc();
  }

  override disconnectedCallback(): void {
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const rail = this.rail();
    const busy = this.sending;
    return html`
      <footer
        class=${this.footerClass(shellMode)}
        @focusin=${() => { this.composerFocused = true; }}
        @focusout=${(event: FocusEvent) => { this.releaseComposerFocus(event); }}
        @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }}
        @dragover=${(event: DragEvent) => { this.handleDragOver(event); }}
        @drop=${(event: DragEvent) => { void this.handleDrop(event); }}
      >
        <context-usage-meter .contextUsage=${this.contextUsage}></context-usage-meter>
        <div class="editor-wrap">
          <div class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`} aria-label="Message pi" aria-disabled=${this.disabled ? "true" : "false"}></div>
          <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
          ${shellMode ? html`<div class="mode-hint">Shell command${shellInputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
          ${this.renderAttachments()}
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderIslandMenuAction(busy)}
          ${this.renderCompactStatus()}
          <button
            class="icon-button new-session-button"
            data-action="new-session"
            title=${NEW_SESSION_LABEL}
            aria-label=${NEW_SESSION_LABEL}
            @click=${() => { this.onNewSession?.(); }}
          >${renderNewSessionIcon()}</button>
          ${this.renderPrimaryAction(rail)}
          <button class="icon-button stop-button" ?disabled=${!rail.canStop} title=${rail.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => { this.stop(); }}>${renderStopIcon()}</button>
        </div>
      </footer>
    `;
  }

  private footerClass(shellMode: boolean): string {
    const resting = promptComposerIsResting({
      chromeSummoned: this.chromeSummoned,
      focused: this.composerFocused,
      draft: this.draft,
      attachmentCount: this.attachments.length,
    });
    return [shellMode ? "shell-mode" : "", resting ? "resting" : ""].filter((name) => name !== "").join(" ");
  }

  /** Focus moving between the editor and its own buttons must not collapse the composer. */
  private releaseComposerFocus(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.renderRoot instanceof ShadowRoot && this.renderRoot.contains(next)) return;
    this.composerFocused = false;
  }

  focusInput() {
    this.editor?.focus();
  }

  /**
   * Open the file picker from outside the composer.
   *
   * The island menu lives in the sheet, so the sheet needs a way in that still
   * honours the composer's own guard: an archived session, or one already
   * sending, must not be able to start an attachment.
   */
  openAttachmentPicker(): void {
    if (this.disabled || this.sending) return;
    this.attachmentInput?.click();
  }

  replaceText(text: string): void {
    this.promptHistoryState = leavePromptHistory(this.promptHistoryState);
    this.draft = text;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, text);

    const editor = this.editor;
    if (editor !== undefined) {
      const current = editor.state.doc.toString();
      editor.dispatch({
        ...(current === text ? {} : { changes: { from: 0, to: current.length, insert: text } }),
        selection: EditorSelection.cursor(text.length),
      });
    }

    // Invalidate completion requests started for either the previous document or
    // the replacement dispatch, then return the editor to a clean completion state.
    this.requestVersion += 1;
    this.currentInputMode = inputModeForDraft(text);
    this.completions = [];
    this.selectedIndex = 0;
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.editor;
  }

  /**
   * What the rail offers right now.
   *
   * `canSteer` arrives as "the agent is speaking"; the rail turns that plus
   * compaction into the one question the controls actually ask.
   */
  private rail(): ComposerRail {
    return composerRail({
      disabled: this.disabled || !this.runtimeControlsAvailable,
      sending: this.sending,
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
          @click=${() => { this.send("followUp"); }}
        >${queues ? renderQueueIcon() : renderSendIcon()}</button>
        ${rail.canSteer ? html`<button
          class="icon-button steer-button"
          ?disabled=${!rail.canInvokePrimary}
          title="Steer the current response before the next model call"
          aria-label="Steer current response"
          @click=${() => { this.send("steer"); }}
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
        ${this.renderArchiveAction()}
      </div>
    `;
  }

  /**
   * Where you are, and the action that ends a turn.
   *
   * The chrome bands used to carry these; the composer inherits them rather
   * than reviving a band. Both are rendered whenever they mean something and
   * revealed by the island's own width, so a narrow composer spends its row on
   * the controls that must always work and leaves these to the sheet.
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
    this.onSelectModel?.();
  }

  private selectThinking(): void {
    if (this.disabled || !this.runtimeControlsAvailable) return;
    this.onSelectThinking?.();
  }

  private renderArchiveAction() {
    if (!this.canArchive) return null;
    return html`
      <button
        class="composer-archive summoned-secondary"
        title="Archive this session and open the next one waiting for you"
        aria-label="Archive &amp; next"
        @click=${() => this.onArchiveAndNext?.()}
      >Archive &amp; next</button>
    `;
  }

  /**
   * One way to everything the rail does not hold.
   *
   * Attachments and the session controls used to be two separate buttons in two
   * places; the island has room for one. It also carries the count of what is
   * waiting behind it, because a sheet nobody opens cannot report a warning.
   */
  private renderIslandMenuAction(busy: boolean) {
    const waiting = this.attentionCount > 0;
    const label = waiting
      ? `Attachments and session controls, ${String(this.attentionCount)} waiting`
      : "Attachments and session controls";
    return html`
      <button
        class=${waiting ? "island-menu composer-summon icon-button attention" : "island-menu composer-summon icon-button"}
        ?disabled=${busy}
        title=${label}
        aria-label=${label}
        @click=${() => this.onOpenControlSheet?.()}
      >${renderAttachIcon()}${waiting ? html`<span class="island-menu-count" aria-hidden="true">${String(this.attentionCount)}</span>` : null}</button>
    `;
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    const canUseInlineDelivery = promptAttachmentsCanUseInlineDelivery(this.attachments);
    const delivery = this.effectiveAttachmentDelivery();
    return html`
      <div class="attachments" aria-label="Pending attachments">
        ${this.attachments.map((attachment) => html`
          <div class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`} title=${attachment.name}>
            ${this.renderAttachmentPreview(attachment)}
            <button type="button" class="attachment-remove" title="Remove attachment" aria-label=${`Remove ${attachment.name}`} @click=${() => { this.removeAttachment(attachment.id); }}>×</button>
          </div>
        `)}
        ${this.attachments.length > 0 ? html`
          <label class="attachment-delivery" title=${canUseInlineDelivery ? "How attachments are delivered to the agent" : "General files are saved and mentioned from the workspace"}>
            <select .value=${delivery} @change=${(event: Event) => { this.changeDelivery(event); }}>
              <option value="inline" ?disabled=${!canUseInlineDelivery}>Attach to message${canUseInlineDelivery ? "" : " (images only)"}</option>
              <option value="folder">Save to .forgerie/attachments</option>
            </select>
          </label>
        ` : null}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error">${this.attachmentError}</div>` : null}
      </div>
    `;
  }

  private renderAttachmentPreview(attachment: PendingAttachment) {
    if (isInlinePromptAttachment(attachment)) {
      return html`<img src=${`data:${attachment.mimeType};base64,${attachment.data}`} alt=${attachment.name} />`;
    }
    return html`
      <div class="attachment-file-preview" aria-hidden="true">${fileExtensionLabel(attachment.name)}</div>
      <span class="attachment-file-name">${attachment.name}</span>
    `;
  }

  private changeDelivery(event: Event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const requested = event.target.value === "folder" ? "folder" : "inline";
    if (requested === "inline" && !promptAttachmentsCanUseInlineDelivery(this.attachments)) {
      event.target.value = "folder";
      return;
    }
    this.attachmentDelivery = requested;
    saveAttachmentDelivery(this.attachmentDelivery);
  }

  private removeAttachment(id: string) {
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
  }

  private async handlePaste(event: ClipboardEvent) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent) {
    if (event.dataTransfer === null) return;
    if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
  }

  private async handleDrop(event: DragEvent) {
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private async handleFileInput(event: Event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]) {
    this.attachmentError = undefined;
    const { attachments, error } = await capturePromptAttachments(files, readFileAsBase64);
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }))];
    }
    if (error !== undefined) this.attachmentError = error;
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  private effectiveAttachmentDelivery(): PromptAttachmentDelivery {
    return effectivePromptAttachmentDelivery(this.attachmentDelivery, this.attachments);
  }

  private createEditor() {
    if (!this.editorHost || this.editor !== undefined) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(view.state.sliceDoc(0, view.state.selection.main.head))),
          EditorView.domEventHandlers({
            keyup: (event) => this.handleEditorKeyUp(event),
            blur: () => this.resetEditorModifierState(),
          }),
          placeholder("Message pi... Use / for commands, @ for tracked files, @ space for all files, # for models"),
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.updateDraft(update.state.doc.toString());
          }),
          keymap.of([
            { any: (view, event) => this.handleEditorKeyDown(event, view) },
            { key: "ArrowDown", run: (view) => this.moveCompletion(1) || this.movePromptHistory(view, "newer") },
            { key: "ArrowUp", run: (view) => this.moveCompletion(-1) || this.movePromptHistory(view, "older") },
            { key: "Escape", run: () => this.closeCompletions() },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
  }

  private syncEditorDoc() {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState() {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
    });
  }

  private updateDraft(value: string) {
    if (!this.applyingPromptHistory) this.promptHistoryState = leavePromptHistory(this.promptHistoryState);
    this.draft = value;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, this.draft);
    const nextInputMode = inputModeForDraft(this.draft);
    if (!inputModesEqual(nextInputMode, this.currentInputMode)) this.currentInputMode = nextInputMode;
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (trigger === undefined) {
      this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const commands = await api.commands({ id: this.sessionId, cwd: this.cwd }, this.machineId).catch(emptySlashCommands);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({
          kind: "command",
          replaceFrom: trigger.from,
          replaceTo: trigger.to,
          insertText: `/${command.name}`,
          detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
        }));
    } else if (trigger.kind === "file" && this.projectId !== undefined && this.workspaceId !== undefined) {
      const files = await api.files(trigger.query, { scope: trigger.fileScope, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId }).catch(emptyFileSuggestions);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => {
          const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
          return {
            kind: "file",
            replaceFrom: trigger.from,
            replaceTo: trigger.to,
            insertText,
            detail: file.kind,
            ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
          };
        });
    } else if (trigger.kind === "model" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const models = await api.models({ id: this.sessionId, cwd: this.cwd }, this.machineId).then((response) => response.models).catch(emptySessionModels);
      if (version !== this.requestVersion) return;
      this.completions = modelCompletionChoices(models, trigger.query).map((choice) => ({
        kind: "model",
        replaceFrom: trigger.from,
        replaceTo: trigger.to,
        ...choice,
      }));
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    return true;
  }

  private closeCompletions(): boolean {
    if (!this.completions.length) return false;
    this.completions = [];
    return true;
  }

  private movePromptHistory(view: EditorView, direction: "older" | "newer"): boolean {
    const selection = view.state.selection.main;
    if (!selection.empty || this.promptHistoryState.entries.length === 0) return false;
    if (direction === "newer" && this.promptHistoryState.position.kind === "draft") return false;
    if (direction === "older" && this.promptHistoryState.position.kind === "draft" && view.state.doc.length > 0 && selection.head !== 0) return false;
    if (!isOnPromptBoundaryLine(view, selection.head, direction === "older" ? "top" : "bottom")) return false;

    const navigation = navigatePromptHistory(this.promptHistoryState, direction, {
      text: view.state.doc.toString(),
      selection: { anchor: selection.anchor, head: selection.head },
      atTop: direction === "older",
      atBottom: direction === "newer",
    });
    if (navigation === undefined) return false;

    this.promptHistoryState = navigation.state;
    this.applyingPromptHistory = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: navigation.editor.text },
        selection: EditorSelection.range(navigation.editor.selection.anchor, navigation.editor.selection.head),
        scrollIntoView: true,
      });
    } finally {
      this.applyingPromptHistory = false;
    }
    return true;
  }

  private handleEditorKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    if (event.key === "Shift") {
      this.explicitShiftKeyActive = true;
      return false;
    }
    if (event.defaultPrevented || event.isComposing || view.composing) return false;
    if (keyboardEventMatchesShortcut(event, this.newSessionShortcut)) {
      this.explicitShiftKeyActive = false;
      this.onNewSession?.();
      return true;
    }
    if (event.key !== "Enter") {
      this.explicitShiftKeyActive = false;
      return false;
    }

    const shiftKey = shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive, this.mobilePromptEnterMedia);
    this.explicitShiftKeyActive = false;
    return this.handleEditorEnter(view, shiftKey);
  }

  private handleEditorKeyUp(event: KeyboardEvent): boolean {
    if (event.key === "Shift") this.explicitShiftKeyActive = false;
    return false;
  }

  private resetEditorModifierState(): boolean {
    this.explicitShiftKeyActive = false;
    return false;
  }

  private handleEditorEnter(view: EditorView, shiftKey: boolean): boolean {
    if (!shiftKey && this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    if (!shouldSendPromptOnEnterShortcut(shiftKey, this.mobilePromptEnterMedia, readPromptEnterPreference())) {
      return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
    }
    this.send(this.canSteer || this.isCompacting ? "followUp" : undefined);
    return true;
  }

  private handleEditorTab(view: EditorView): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    const trigger = this.currentTrigger();
    if (trigger?.kind === "file") {
      void this.refreshCompletions();
      return true;
    }
    return indentWithTab.run?.(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    this.completions = [];
  }

  private send(streamingBehavior?: "steer" | "followUp") {
    if (this.disabled || !this.runtimeControlsAvailable || this.sending) return;
    const text = this.draft.trim();
    const pending = this.attachments;
    if (text === "" && pending.length === 0) return;
    const behavior = this.rail().kind === "working" ? streamingBehavior : undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.effectiveAttachmentDelivery();
    this.promptHistoryState = addPromptHistoryEntry(this.promptHistoryState, text);
    this.resetComposer();
    // Sending is owned by the controller (it drives the chat activity dock and,
    // for folder mode, orchestrates the upload + reference rewrite), so this is
    // fire-and-forget here.
    void this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery);
  }

  private resetComposer() {
    this.draft = "";
    this.currentInputMode = { kind: "normal" };
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) clearDraft(key);
    this.completions = [];
    this.attachments = [];
    this.attachmentError = undefined;
    // `draft` is not reactive, so the cleared text will not flow to CodeMirror
    // via `updated()`; push it to the editor document explicitly.
    this.syncEditorDoc();
  }

  static override styles = promptEditorStyles;
}

function isOnPromptBoundaryLine(view: EditorView, position: number, boundary: "top" | "bottom"): boolean {
  const line = view.state.doc.lineAt(position);
  const isDocumentBoundary = boundary === "top" ? line.number === 1 : line.number === view.state.doc.lines;
  if (!isDocumentBoundary) return false;

  const boundaryPosition = boundary === "top" ? line.from : line.to;
  const cursorCoords = view.coordsAtPos(position);
  const boundaryCoords = view.coordsAtPos(boundaryPosition);
  if (cursorCoords === null || boundaryCoords === null) return true;
  const cursorEdge = boundary === "top" ? cursorCoords.top : cursorCoords.bottom;
  const boundaryEdge = boundary === "top" ? boundaryCoords.top : boundaryCoords.bottom;
  return Math.abs(cursorEdge - boundaryEdge) < 1;
}

function promptHistoryChanged(value: readonly string[], previous: readonly string[] | undefined): boolean {
  if (value === previous) return false;
  if (previous?.length !== value.length) return true;
  return value.some((entry, index) => entry !== previous[index]);
}

// The only `status` fields the template reads directly are the model identity
// and thinking level (shown in renderCompactStatus). Everything else the editor
// cares about (canSteer/canStop/isCompacting/sending) is passed as a separate
// property that Lit already diffs by value. Comparing just these fields lets us
// ignore the per-token status churn that does not change anything on screen.
function sessionStatusRenderEqual(a: SessionStatus | undefined, b: SessionStatus | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.model?.id === b.model?.id
    && a.model?.provider === b.model?.provider
    && a.thinkingLevel === b.thinkingLevel;
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function emptySessionModels(): SessionModel[] {
  return [];
}

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
}

function pendingToPromptAttachment(attachment: PendingAttachment): PromptAttachment {
  if (attachment.kind === "image") {
    return { kind: "image", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
  }
  return { kind: "file", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
}

function fileExtensionLabel(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < trimmed.length - 1) return trimmed.slice(dotIndex + 1, dotIndex + 5).toUpperCase();
  return "FILE";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("Failed to read file")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("Unexpected file reader result")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

const proseInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "true",
  autocorrect: "on",
  autocapitalize: "sentences",
  writingsuggestions: "true",
  dir: "auto",
};

const codeLikeInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  writingsuggestions: "false",
  dir: "auto",
};

function inputAssistanceContentAttributes(draftBeforeCursor: string): Record<string, string> {
  // CodeMirror is optimized for code and disables these by default, but the chat prompt is usually prose.
  return inputModeForDraft(draftBeforeCursor).kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
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
