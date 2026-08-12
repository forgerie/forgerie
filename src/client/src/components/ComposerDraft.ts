import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PromptAttachment, PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { base64ByteLength } from "../../../shared/promptAttachments";
import type { ComposerRuntime } from "../composerRuntime";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "../attachmentPreferences";
import { inputModeForDraft, inputModesEqual, type InputMode } from "../inputModes";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, promptAttachmentsCanUseInlineDelivery, type CapturedAttachment } from "../promptAttachmentCapture";
import { detectPromptCompletionTrigger, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, saveDraft } from "../promptDraftStorage";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { addPromptHistoryEntry, createPromptHistory, leavePromptHistory, navigatePromptHistory, type PromptHistoryState } from "../promptHistory";
import { promptEditorStyles, type CompletionItem } from "./shared";
import "./AutocompleteMenu";

type PendingAttachment = CapturedAttachment & { id: string };

let composerDraftSequence = 0;

export interface ComposerDraftDisplayState {
  inputMode: InputMode;
  empty: boolean;
  focused: boolean;
  attachmentCount: number;
  attachmentCapturePending: boolean;
}

export interface ComposerDraftSubmitSnapshot {
  text: string;
  attachments?: PromptAttachment[] | undefined;
  delivery?: PromptAttachmentDelivery | undefined;
}

export type ComposerDraftSubmitOutcome = "accepted" | "rejected";

export interface ComposerDraftSeed {
  id: string;
  snapshot: ComposerDraftSubmitSnapshot;
}

export interface ComposerDraftCompletionError {
  kind: PromptCompletionTrigger["kind"];
  message: string;
}

export interface ComposerDraftEscapeContext {
  draft: string;
  inputMode: InputMode;
}

/** Shared so a host can fall back to them without restating the copy. */
export const DEFAULT_COMPOSER_PLACEHOLDER = "Message pi... Use / for commands, @ for tracked files, @ space for all files, # for models";
export const DEFAULT_COMPOSER_EDITOR_LABEL = "Message pi";

@customElement("composer-draft")
export class ComposerDraft extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) submissionDisabled = false;
  @property({ type: Boolean }) working = false;
  @property({ type: Boolean }) compacting = false;
  @property({ type: Boolean }) resting = false;
  @property() placeholderText = DEFAULT_COMPOSER_PLACEHOLDER;
  @property() editorLabel = DEFAULT_COMPOSER_EDITOR_LABEL;
  @property({ attribute: false }) runtime?: ComposerRuntime;
  @property({ attribute: false }) promptHistory: readonly string[] = [];
  @property() storageKey?: string;
  @property({ attribute: false }) onSubmit?: (snapshot: ComposerDraftSubmitSnapshot, streamingBehavior?: "steer" | "followUp") => ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome>;
  @property({ attribute: false }) onEscape?: (context: ComposerDraftEscapeContext) => boolean;
  @property({ attribute: false }) onDisplayStateChange?: (state: ComposerDraftDisplayState) => void;
  @property({ attribute: false }) onCompletionError?: (error: ComposerDraftCompletionError) => void;
  @property({ attribute: false }) onDraftEdited?: () => void;

  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;

  private draft = "";
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  @state() private attachments: PendingAttachment[] = [];
  @state() private attachmentDelivery: PromptAttachmentDelivery = loadAttachmentDelivery();
  @state() private attachmentError: string | undefined = undefined;
  @state() private politeAnnouncement = "";
  @state() private assertiveAnnouncement = "";
  @state() private completionError: ComposerDraftCompletionError | undefined = undefined;
  @state() private focused = false;
  private attachmentSeq = 0;
  private attachmentGeneration = 0;
  private attachmentCaptureCount = 0;
  private attachmentCaptureWaiters: (() => void)[] = [];
  private settleAttachmentCaptureAfterDisconnect = false;
  private requestVersion = 0;
  private editor: EditorView | undefined;
  private promptHistoryState: PromptHistoryState = createPromptHistory();
  private applyingPromptHistory = false;
  private applyingSnapshot = false;
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
  private readonly placeholderCompartment = new Compartment();
  private readonly mobilePromptEnterMedia = createMobilePromptEnterMedia();
  private explicitShiftKeyActive = false;
  private mutationVersion = 0;
  private lastDisplayState: ComposerDraftDisplayState | undefined;
  private readonly restoredSeedIds = new Set<string>();
  private readonly instanceId = `composer-draft-${String(++composerDraftSequence)}`;
  private readonly completionListboxId = `${this.instanceId}-completion-listbox`;
  private readonly completionOptionIdPrefix = `${this.instanceId}-completion-option-`;
  private readonly attachmentDeliveryGroupName = `${this.instanceId}-attachment-delivery`;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("storageKey")) {
      const previousKey = changed.get("storageKey");
      if (typeof previousKey === "string" && previousKey !== "") saveDraft(previousKey, this.draft);
      this.draft = this.storageKey !== undefined && this.storageKey !== "" ? loadDraft(this.storageKey) : this.draft;
      this.clearAttachmentOwnership();
      this.currentInputMode = this.resolveInputMode(this.draft);
      this.completions = [];
      this.selectedIndex = 0;
      this.completionError = undefined;
      this.requestVersion += 1;
    }
    if (changed.has("promptHistory")) this.promptHistoryState = createPromptHistory(this.promptHistory);
    if (changed.has("runtime")) {
      this.requestVersion += 1;
      this.completions = [];
      this.selectedIndex = 0;
      this.completionError = undefined;
    }
  }

  override firstUpdated(): void {
    this.createEditor();
    this.publishDisplayState();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("placeholderText")) this.updateEditorPlaceholder();
    if (changed.has("storageKey")) this.syncEditorDoc();
    this.syncEditorAccessibility();
    this.syncCompletionMenuBoundary();
    this.publishDisplayState();
  }

  override disconnectedCallback(): void {
    this.requestVersion += 1;
    this.completions = [];
    this.selectedIndex = 0;
    this.completionError = undefined;
    const disconnectedGeneration = this.attachmentGeneration;
    queueMicrotask(() => {
      if (!this.isConnected && !this.settleAttachmentCaptureAfterDisconnect && this.attachmentGeneration === disconnectedGeneration) {
        this.attachmentGeneration += 1;
      }
    });
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasUpdated) return;
    void this.updateComplete.then(() => {
      if (!this.isConnected) return;
      this.createEditor();
      this.syncEditorDoc();
    });
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const classes = ["editor-wrap", shellMode ? "shell-mode" : "", this.resting ? "resting" : ""].filter((name) => name !== "").join(" ");
    return html`
      <div
        class=${classes}
        @focusin=${() => { this.focused = true; }}
        @focusout=${(event: FocusEvent) => { this.releaseFocus(event); }}
        @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }}
        @dragover=${(event: DragEvent) => { this.handleDragOver(event); }}
        @drop=${(event: DragEvent) => { void this.handleDrop(event); }}
      >
        <div class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`} aria-label=${this.editorLabel} aria-disabled=${this.disabled ? "true" : "false"}></div>
        <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
        ${shellMode ? html`<div class="mode-hint">Shell command${shellInputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
        ${this.compacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
        <div class="composer-live-region" aria-live="polite" aria-atomic="true" data-live="attachments">${this.politeAnnouncement}</div>
        <div class="composer-live-region" aria-live="assertive" aria-atomic="true" data-live="attachment-errors">${this.assertiveAnnouncement}</div>
        ${this.renderAttachments()}
        <autocomplete-menu
          .items=${this.completions}
          .selectedIndex=${this.selectedIndex}
          .listboxId=${this.completionListboxId}
          .optionIdPrefix=${this.completionOptionIdPrefix}
          .onPick=${(item: CompletionItem) => { this.pick(item); }}
        ></autocomplete-menu>
        ${this.completionError === undefined ? null : html`<div class="completion-error" role="alert">${this.completionError.message}</div>`}
      </div>
    `;
  }

  focusInput(): void {
    this.editor?.focus();
  }

  openAttachmentPicker(): void {
    if (this.disabled || this.submissionDisabled) return;
    this.attachmentInput?.click();
  }

  replaceText(text: string): void {
    this.promptHistoryState = leavePromptHistory(this.promptHistoryState);
    if (this.draft !== text) this.mutationVersion += 1;
    this.draft = text;
    if (this.storageKey !== undefined && this.storageKey !== "") saveDraft(this.storageKey, text);

    const editor = this.editor;
    if (editor !== undefined) {
      const current = editor.state.doc.toString();
      editor.dispatch({
        ...(current === text ? {} : { changes: { from: 0, to: current.length, insert: text } }),
        selection: EditorSelection.cursor(text.length),
      });
    }

    this.requestVersion += 1;
    this.currentInputMode = this.resolveInputMode(text);
    this.completions = [];
    this.selectedIndex = 0;
    this.completionError = undefined;
    this.publishDisplayState();
  }

  get view(): EditorView | undefined {
    return this.editor;
  }

  currentSnapshot(): ComposerDraftSubmitSnapshot {
    const attachments = this.attachments.length > 0 ? this.currentAttachments() : undefined;
    return {
      text: this.draft,
      ...(attachments === undefined ? {} : { attachments, delivery: this.effectiveAttachmentDelivery() }),
    };
  }

  whenAttachmentCaptureSettled(): Promise<void> {
    if (this.attachmentCaptureCount === 0) return Promise.resolve();
    return new Promise((resolve) => { this.attachmentCaptureWaiters.push(resolve); });
  }

  retainPendingAttachmentCaptureAfterDisconnect(): Promise<void> {
    if (this.attachmentCaptureCount === 0) return Promise.resolve();
    this.settleAttachmentCaptureAfterDisconnect = true;
    return this.whenAttachmentCaptureSettled().finally(() => { this.settleAttachmentCaptureAfterDisconnect = false; });
  }

  closeCompletionMenu(): boolean {
    return this.closeCompletions();
  }

  submit(streamingBehavior?: "steer" | "followUp"): void {
    if (this.disabled || this.submissionDisabled || this.attachmentCaptureCount > 0) return;
    const snapshot = this.createSubmitSnapshot();
    if (snapshot === undefined) return;
    const submittedMutationVersion = this.mutationVersion;
    let result: ComposerDraftSubmitOutcome | Promise<ComposerDraftSubmitOutcome>;
    try {
      result = this.onSubmit?.(snapshot, this.working ? streamingBehavior : undefined) ?? "rejected";
    } catch {
      return;
    }
    if (isPromiseLike(result)) {
      void result
        .then((outcome) => { this.resolveSubmitOutcome(outcome, snapshot, submittedMutationVersion); })
        .catch(() => undefined);
      return;
    }
    this.resolveSubmitOutcome(result, snapshot, submittedMutationVersion);
  }

  restoreSeed(seed: ComposerDraftSeed): boolean {
    if (this.restoredSeedIds.has(seed.id)) return false;
    this.restoredSeedIds.add(seed.id);
    this.applySnapshot(seed.snapshot, false);
    return true;
  }

  restoreSnapshot(snapshot: ComposerDraftSubmitSnapshot): void {
    this.applySnapshot(snapshot, true);
  }

  restoreTransientSnapshot(snapshot: ComposerDraftSubmitSnapshot): void {
    this.applySnapshot(snapshot, false);
  }

  clearAfterAcceptance(): void {
    this.resetComposer();
  }

  discardDraft(): void {
    this.resetComposer();
  }

  private releaseFocus(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.contains(next)) return;
    this.focused = false;
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    const canUseInlineDelivery = promptAttachmentsCanUseInlineDelivery(this.attachments);
    const delivery = this.effectiveAttachmentDelivery();
    const total = this.attachments.length;
    return html`
      <div class="attachments" aria-label="Pending attachments">
        ${this.attachments.map((attachment, index) => {
          const attachmentLabel = attachmentAccessibleLabel(attachment, index, total);
          return html`
            <div
              class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`}
              title=${attachment.name}
              role="group"
              tabindex="0"
              aria-label=${attachmentLabel}
            >
              ${this.renderAttachmentPreview(attachment)}
              <button
                type="button"
                class="attachment-remove"
                title="Remove attachment"
                aria-label=${`Remove ${attachmentLabel}`}
                @click=${() => { this.removeAttachment(attachment.id); }}
              >×</button>
            </div>
          `;
        })}
        ${this.attachments.length > 0 ? html`
          <fieldset class="attachment-delivery" aria-label="Attachment delivery">
            <legend>Attachment delivery</legend>
            <label>
              <input
                type="radio"
                name=${this.attachmentDeliveryGroupName}
                value="inline"
                ?checked=${delivery === "inline"}
                ?disabled=${!canUseInlineDelivery}
                @change=${(event: Event) => { this.changeDelivery(event); }}
              />
              <span>Attach to message${canUseInlineDelivery ? "" : " (images only)"}</span>
            </label>
            <label>
              <input
                type="radio"
                name=${this.attachmentDeliveryGroupName}
                value="folder"
                ?checked=${delivery === "folder"}
                @change=${(event: Event) => { this.changeDelivery(event); }}
              />
              <span>Save to .forgerie/attachments</span>
            </label>
          </fieldset>
        ` : null}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error" role="alert">${this.attachmentError}</div>` : null}
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

  private changeDelivery(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== "radio" || !event.target.checked) return;
    const requested = event.target.value === "folder" ? "folder" : "inline";
    if (requested === "inline" && !promptAttachmentsCanUseInlineDelivery(this.attachments)) {
      event.target.checked = false;
      this.attachmentError = "Only image attachments can be attached directly to a message.";
      this.announceAssertive(this.attachmentError);
      return;
    }
    if (this.attachmentDelivery !== requested) this.mutationVersion += 1;
    this.attachmentDelivery = requested;
    saveAttachmentDelivery(this.attachmentDelivery);
    this.attachmentError = undefined;
    this.announcePolite(requested === "inline" ? "Attachments will be attached to the message." : "Attachments will be saved to .forgerie/attachments.");
    this.onDraftEdited?.();
  }

  private removeAttachment(id: string): void {
    const index = this.attachments.findIndex((attachment) => attachment.id === id);
    const removed = index === -1 ? undefined : this.attachments[index];
    const total = this.attachments.length;
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
    if (removed !== undefined) this.mutationVersion += 1;
    if (removed !== undefined) this.announcePolite(`Removed ${attachmentAccessibleLabel(removed, index, total)}.`);
    this.onDraftEdited?.();
    this.publishDisplayState();
  }

  private createSubmitSnapshot(): ComposerDraftSubmitSnapshot | undefined {
    const text = this.draft;
    const pending = this.attachments;
    if (text.trim() === "" && pending.length === 0) return undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.effectiveAttachmentDelivery();
    return attachments === undefined ? { text } : { text, attachments, delivery };
  }

  private resolveSubmitOutcome(outcome: ComposerDraftSubmitOutcome, snapshot: ComposerDraftSubmitSnapshot, submittedMutationVersion: number): void {
    if (outcome !== "accepted") return;
    this.promptHistoryState = addPromptHistoryEntry(this.promptHistoryState, snapshot.text);
    if (this.mutationVersion === submittedMutationVersion) this.resetComposer();
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    if (!this.canMutateAttachments()) return;
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent): void {
    if (!this.canMutateAttachments() || event.dataTransfer === null) return;
    if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
  }

  private async handleDrop(event: DragEvent): Promise<void> {
    if (!this.canMutateAttachments()) return;
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private async handleFileInput(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!this.canMutateAttachments()) {
      event.target.value = "";
      return;
    }
    if (event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]): Promise<void> {
    if (!this.canMutateAttachments()) return;
    const generation = this.attachmentGeneration;
    this.attachmentCaptureCount += 1;
    this.attachmentError = undefined;
    this.publishDisplayState();
    try {
      const { attachments, error } = await capturePromptAttachments(files, readFileAsBase64);
      if (!this.canAcceptAttachmentResult(generation)) return;
      if (attachments.length > 0) {
        const previousTotal = this.attachments.length;
        const added = attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }));
        this.attachments = [...this.attachments, ...added];
        this.mutationVersion += 1;
        this.announcePolite(attachmentAddedAnnouncement(added, previousTotal, this.attachments.length));
        this.onDraftEdited?.();
      }
      if (error !== undefined) {
        this.attachmentError = error;
        this.announceAssertive(error);
      }
    } finally {
      this.attachmentCaptureCount = Math.max(0, this.attachmentCaptureCount - 1);
      if (this.attachmentCaptureCount === 0) {
        const waiters = this.attachmentCaptureWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
      this.publishDisplayState();
    }
  }

  private canMutateAttachments(): boolean {
    return this.isConnected && !this.disabled && !this.submissionDisabled;
  }

  private canAcceptAttachmentResult(generation: number): boolean {
    const ownsDisconnectedSettlement = !this.isConnected && this.settleAttachmentCaptureAfterDisconnect;
    return generation === this.attachmentGeneration
      && (this.isConnected || ownsDisconnectedSettlement)
      && !this.disabled
      && !this.submissionDisabled;
  }

  private clearAttachmentOwnership(): void {
    this.attachmentGeneration += 1;
    if (this.attachments.length > 0) this.mutationVersion += 1;
    this.attachments = [];
    this.attachmentError = undefined;
    this.assertiveAnnouncement = "";
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  private effectiveAttachmentDelivery(): PromptAttachmentDelivery {
    return effectivePromptAttachmentDelivery(this.attachmentDelivery, this.attachments);
  }

  private createEditor(): void {
    if (!this.editorHost || this.editor !== undefined) return;
    const root = this.editorHost.getRootNode();
    if (root instanceof ShadowRoot && !(root.host instanceof Element)) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      ...(usesHappyDom() ? { root: document } : {}),
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(this.resolveInputMode(view.state.sliceDoc(0, view.state.selection.main.head)))),
          EditorView.domEventHandlers({
            keyup: (event) => this.handleEditorKeyUp(event),
            blur: () => this.resetEditorModifierState(),
          }),
          this.placeholderCompartment.of(placeholder(this.placeholderText)),
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.applyingSnapshot) this.updateDraft(update.state.doc.toString());
            else if (update.selectionSet && !this.applyingSnapshot) void this.refreshCompletions();
          }),
          keymap.of([
            { any: (view, event) => this.handleEditorKeyDown(event, view) },
            { key: "ArrowDown", run: (view) => this.moveCompletion(1) || this.movePromptHistory(view, "newer") },
            { key: "ArrowUp", run: (view) => this.moveCompletion(-1) || this.movePromptHistory(view, "older") },
            { key: "Escape", run: () => this.handleEditorEscape() },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
    this.syncEditorAccessibility();
    this.syncCompletionMenuBoundary();
  }

  private syncEditorDoc(): void {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState(): void {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
    });
  }

  private updateEditorPlaceholder(): void {
    this.editor?.dispatch({ effects: this.placeholderCompartment.reconfigure(placeholder(this.placeholderText)) });
  }

  private resolveInputMode(draft: string): InputMode {
    return this.runtime?.inputModeForDraft(draft) ?? inputModeForDraft(draft);
  }

  private applySnapshot(snapshot: ComposerDraftSubmitSnapshot, persist: boolean): void {
    this.promptHistoryState = leavePromptHistory(this.promptHistoryState);
    this.mutationVersion += 1;
    this.draft = snapshot.text;
    this.attachmentGeneration += 1;
    this.attachments = (snapshot.attachments ?? []).map((attachment) => restoredPendingAttachment(attachment, `attachment-${String(++this.attachmentSeq)}`));
    if (snapshot.delivery !== undefined) this.attachmentDelivery = snapshot.delivery;
    this.attachmentError = undefined;
    this.completionError = undefined;
    if (persist && this.storageKey !== undefined && this.storageKey !== "") saveDraft(this.storageKey, this.draft);
    this.requestVersion += 1;
    this.currentInputMode = this.resolveInputMode(this.draft);
    this.completions = [];
    this.selectedIndex = 0;
    this.applyingSnapshot = true;
    try {
      this.syncEditorDoc();
    } finally {
      this.applyingSnapshot = false;
    }
    this.publishDisplayState();
  }

  private updateDraft(value: string): void {
    if (!this.applyingPromptHistory) this.promptHistoryState = leavePromptHistory(this.promptHistoryState);
    this.mutationVersion += 1;
    this.draft = value;
    if (this.storageKey !== undefined && this.storageKey !== "") saveDraft(this.storageKey, this.draft);
    const nextInputMode = this.resolveInputMode(this.draft);
    if (!inputModesEqual(nextInputMode, this.currentInputMode)) this.currentInputMode = nextInputMode;
    this.publishDisplayState();
    this.onDraftEdited?.();
    void this.refreshCompletions();
  }

  private async refreshCompletions(): Promise<void> {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    this.completionError = undefined;
    const runtime = this.runtime;
    if (trigger === undefined || runtime?.supportedCompletionKinds.has(trigger.kind) !== true) {
      this.completions = [];
      this.syncEditorAccessibility();
      return;
    }
    try {
      const completions = await runtime.resolveCompletion(trigger);
      if (version !== this.requestVersion) return;
      this.completions = [...completions];
      this.syncEditorAccessibility();
      this.syncCompletionMenuBoundary();
    } catch (error) {
      if (version !== this.requestVersion) return;
      this.completions = [];
      this.syncEditorAccessibility();
      this.completionError = { kind: trigger.kind, message: errorMessage(error, "Completions unavailable.") };
      this.onCompletionError?.(this.completionError);
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    this.syncEditorAccessibility();
    return true;
  }

  private closeCompletions(): boolean {
    if (!this.completions.length) return false;
    this.completions = [];
    this.syncEditorAccessibility();
    return true;
  }

  private handleEditorEscape(): boolean {
    if (this.closeCompletions()) return true;
    if (this.onEscape?.({ draft: this.draft, inputMode: this.currentInputMode }) === true) return true;
    if (this.currentInputMode.kind === "shell") {
      this.replaceText("");
      return true;
    }
    return false;
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
    this.submit(this.working ? "followUp" : undefined);
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

  private pick(item: CompletionItem): void {
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
    editor.focus();
    this.syncEditorAccessibility();
  }

  private resetComposer(): void {
    this.mutationVersion += 1;
    this.draft = "";
    this.currentInputMode = { kind: "normal" };
    if (this.storageKey !== undefined && this.storageKey !== "") clearDraft(this.storageKey);
    this.completions = [];
    this.clearAttachmentOwnership();
    this.completionError = undefined;
    this.syncEditorDoc();
    this.publishDisplayState();
  }

  private publishDisplayState(): void {
    const state: ComposerDraftDisplayState = {
      inputMode: this.currentInputMode,
      empty: this.draft.trim() === "",
      focused: this.focused,
      attachmentCount: this.attachments.length,
      attachmentCapturePending: this.attachmentCaptureCount > 0,
    };
    if (displayStatesEqual(state, this.lastDisplayState)) return;
    this.lastDisplayState = state;
    this.onDisplayStateChange?.(state);
  }

  private syncEditorAccessibility(): void {
    const content = this.editor?.contentDOM;
    if (content === undefined) return;
    content.setAttribute("role", "combobox");
    content.setAttribute("aria-label", this.editorLabel);
    content.setAttribute("aria-autocomplete", "list");
    content.setAttribute("aria-haspopup", "listbox");
    content.setAttribute("aria-controls", this.completionListboxId);
    content.setAttribute("aria-expanded", this.completions.length > 0 ? "true" : "false");
    if (this.completions.length > 0) {
      content.setAttribute("aria-activedescendant", `${this.completionOptionIdPrefix}${String(this.selectedIndex)}`);
    } else {
      content.removeAttribute("aria-activedescendant");
    }
  }

  private syncCompletionMenuBoundary(): void {
    const menu = this.querySelector<HTMLElement>("autocomplete-menu");
    if (menu === null) return;
    const blockSize = this.completionMenuBlockSize();
    if (blockSize === undefined) {
      menu.style.removeProperty("--composer-completion-menu-max-block-size");
      return;
    }
    menu.style.setProperty("--composer-completion-menu-max-block-size", `${String(blockSize)}px`);
  }

  private completionMenuBlockSize(): number | undefined {
    const editorHost = this.editorHost;
    if (editorHost === undefined || this.completions.length === 0) return undefined;
    const boundary = this.closest(".composer") ?? this.closest("footer") ?? this.parentElement;
    if (!(boundary instanceof HTMLElement)) return undefined;
    const boundaryRect = boundary.getBoundingClientRect();
    const editorRect = editorHost.getBoundingClientRect();
    if (boundaryRect.height <= 0 || editorRect.height <= 0) return undefined;
    const availableAboveEditor = Math.floor(editorRect.top - boundaryRect.top - 8);
    const availableInsideBoundary = Math.floor(boundaryRect.height - 16);
    const available = Math.min(availableAboveEditor > 0 ? availableAboveEditor : availableInsideBoundary, availableInsideBoundary);
    return Math.max(64, available);
  }

  private announcePolite(message: string): void {
    this.politeAnnouncement = message;
  }

  private announceAssertive(message: string): void {
    this.assertiveAnnouncement = message;
  }

  static override styles = promptEditorStyles;
}


function attachmentAccessibleLabel(attachment: PendingAttachment, index: number, total: number): string {
  const position = total <= 1 ? "attachment 1 of 1" : `attachment ${String(index + 1)} of ${String(total)}`;
  return `${position}: ${attachment.name}, ${attachment.mimeType}, ${String(attachment.size)} bytes`;
}

function attachmentAddedAnnouncement(added: readonly PendingAttachment[], previousTotal: number, total: number): string {
  const first = added[0];
  if (added.length === 1 && first !== undefined) return `Added ${attachmentAccessibleLabel(first, previousTotal, total)}.`;
  return `Added ${String(added.length)} attachments. ${String(total)} attachments pending.`;
}

function displayStatesEqual(left: ComposerDraftDisplayState, right: ComposerDraftDisplayState | undefined): boolean {
  if (right === undefined) return false;
  return left.empty === right.empty
    && left.focused === right.focused
    && left.attachmentCount === right.attachmentCount
    && left.attachmentCapturePending === right.attachmentCapturePending
    && inputModesEqual(left.inputMode, right.inputMode);
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

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
}

function restoredPendingAttachment(attachment: PromptAttachment, id: string): PendingAttachment {
  return {
    id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    data: attachment.data,
    name: attachment.name ?? "attachment",
    size: base64ByteLength(attachment.data),
  };
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

function usesHappyDom(): boolean {
  return navigator.userAgent.includes("HappyDOM");
}

function isPromiseLike(value: unknown): value is PromiseLike<ComposerDraftSubmitOutcome> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
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

function inputAssistanceContentAttributes(inputMode: InputMode): Record<string, string> {
  return inputMode.kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
}
