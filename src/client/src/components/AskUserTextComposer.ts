import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { ComposerDraftDisplayState, ComposerDraftSubmitOutcome, ComposerDraftSubmitSnapshot } from "./ComposerDraft";
import type { PromptEditor } from "./PromptEditor";
import "./PromptEditor";

/** The chat composer reduced to the controls that help write one text answer. */
@customElement("ask-user-text-composer")
export class AskUserTextComposer extends LitElement {
  @property() seedKey = "";
  @property({ attribute: false }) initialSnapshot: ComposerDraftSubmitSnapshot = { text: "" };
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property({ attribute: false }) dictation?: ComposerDictationCapability;
  @property({ attribute: false }) onChange?: (snapshot: ComposerDraftSubmitSnapshot) => void;
  @property({ attribute: false }) onDisplayStateChange?: (source: AskUserTextComposer, state: ComposerDraftDisplayState) => void;
  @property({ type: Boolean }) disabled = false;
  @property() editorLabel = "Custom answer";

  @query("prompt-editor") private editor?: PromptEditor;
  private restoredSeedKey: string | undefined;

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("seedKey") && !changed.has("initialSnapshot")) return;
    if (this.restoredSeedKey === this.seedKey) return;
    this.restoredSeedKey = this.seedKey;
    this.editor?.restoreSnapshot(this.initialSnapshot);
  }

  override render() {
    return html`
      <prompt-editor
        .sessionId=${this.sessionId}
        .draftStorageKeyOverride=${null}
        .cwd=${this.cwd}
        .machineId=${this.machineId}
        .disabled=${this.disabled}
        .submissionAvailable=${true}
        .sendAvailable=${false}
        .runtimeControlsAvailable=${false}
        .primaryActionVisible=${false}
        .surfaceMode=${"embedded"}
        .enterKeyBehavior=${"newline"}
        .forcedAttachmentDelivery=${"folder"}
        .capabilities=${this.dictation === undefined ? {} : { dictation: this.dictation }}
        placeholderText="Type an answer…"
        .editorLabel=${this.editorLabel}
        .onDraftEdited=${() => { this.publishSnapshot(); }}
        .onDraftDisplayStateChange=${(state: ComposerDraftDisplayState) => { this.onDisplayStateChange?.(this, state); }}
        .onDraftSubmit=${(snapshot: ComposerDraftSubmitSnapshot) => this.retainSnapshot(snapshot)}
      ></prompt-editor>
    `;
  }

  override focus(options?: FocusOptions): void {
    if (this.editor?.focusInput() === true) return;
    super.focus(options);
    void this.updateComplete.then(() => { this.editor?.focus(); });
  }

  private publishSnapshot(): void {
    this.onChange?.(this.editor?.currentSnapshot() ?? { text: "" });
  }

  private retainSnapshot(snapshot: ComposerDraftSubmitSnapshot): ComposerDraftSubmitOutcome {
    this.onChange?.(snapshot);
    return "rejected";
  }

  static override styles = css`
    :host { display: block; min-width: 0; }
    prompt-editor { min-width: 0; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ask-user-text-composer": AskUserTextComposer;
  }
}
