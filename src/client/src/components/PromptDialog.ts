import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api } from "../api";
import "./ModalSurface";

/**
 * Saves a reusable prompt into the agent profile's prompt library. It is
 * deliberately independent of the composer and of any open session: the dialog
 * owns the whole authoring flow, and the machine's prompt endpoint owns the file.
 */
export type PromptDialogState =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "saved"; name: string; path: string }
  | { kind: "failed"; message: string };

@customElement("prompt-dialog")
export class PromptDialog extends LitElement {
  @property({ attribute: false }) onClose?: () => void;
  /** Set when the caller already knows what the prompt should contain. */
  @property() initialBody = "";
  @property() machineId = "local";
  @state() private name = "";
  @state() private body = "";
  @state() private status: PromptDialogState = { kind: "editing" };

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.initialBody !== "") this.body = this.initialBody;
  }

  override render() {
    const status = this.status;
    return html`
      <modal-surface
        .onClose=${() => { this.onClose?.(); }}
        .busy=${status.kind === "saving"}
        .initialFocus=${"input[name='prompt-name']"}
        .label=${"New prompt"}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <strong>New prompt</strong>
          <button @click=${() => { this.onClose?.(); }} aria-label="Close">×</button>
        </header>
        <div class="body">
          ${status.kind === "saved" ? this.renderSaved(status) : this.renderForm()}
        </div>
        <footer>
          ${status.kind === "saved"
            ? html`
              <button @click=${() => { this.startAnother(); }}>Write another</button>
              <button class="primary" @click=${() => { this.onClose?.(); }}>Done</button>
            `
            : html`
              <button ?disabled=${status.kind === "saving"} @click=${() => { this.onClose?.(); }}>Cancel</button>
              <button class="primary" ?disabled=${!this.canSave()} @click=${() => { void this.save(); }}>
                ${status.kind === "saving" ? "Saving…" : "Save prompt"}
              </button>
            `}
        </footer>
      </modal-surface>
    `;
  }

  private renderForm() {
    const status = this.status;
    return html`
      <label>
        Command name
        <input
          name="prompt-name"
          .value=${this.name}
          ?disabled=${status.kind === "saving"}
          placeholder="tell"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          @input=${(event: Event) => { this.name = inputValue(event); }}
        />
        <small>Saved as <code>/${this.name === "" ? "name" : this.name}</code> in every session on this machine.</small>
      </label>
      <label class="grow">
        Prompt
        <textarea
          name="prompt-body"
          .value=${this.body}
          ?disabled=${status.kind === "saving"}
          placeholder="Speak in ASD-STE100 Simplified Technical English."
          @input=${(event: Event) => { this.body = inputValue(event); }}
        ></textarea>
        <small>The first line becomes the description shown in the command picker.</small>
      </label>
      ${status.kind === "failed" ? html`<p class="error" role="alert">${status.message}</p>` : nothing}
    `;
  }

  private renderSaved(status: { name: string; path: string }) {
    return html`
      <p class="saved" role="status">Saved <code>/${status.name}</code></p>
      <p class="path">${status.path}</p>
      <p class="hint">New sessions pick it up at once. In sessions that are already open, run <code>/reload</code> first.</p>
    `;
  }

  private canSave(): boolean {
    return this.status.kind !== "saving" && this.name.trim() !== "" && this.body.trim() !== "";
  }

  private startAnother(): void {
    this.name = "";
    this.body = "";
    this.status = { kind: "editing" };
  }

  private async save(): Promise<void> {
    if (!this.canSave()) return;
    this.status = { kind: "saving" };
    try {
      const saved = await api.savePrompt(this.name.trim(), this.body, this.machineId);
      this.status = { kind: "saved", name: saved.name, path: saved.path };
    } catch (error: unknown) {
      this.status = { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  // Escape and backdrop presses belong to the modal surface. Ctrl/Cmd+Enter
  // saves from either field, because Enter itself types a newline in the
  // prompt body and must keep doing so.
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void this.save();
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 30; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; }
    modal-surface { --modal-surface-place-items: start center; --modal-surface-backdrop-padding: min(4vh, 48px) 0 0; --modal-surface-width: min(640px, calc(100vw - 24px)); --modal-surface-max-height: min(760px, calc(100dvh - 16px)); }
    header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border-muted); }
    footer { border-top: 1px solid var(--pi-border-muted); border-bottom: 0; justify-content: end; }
    .body { display: grid; align-content: start; gap: 12px; padding: 12px; min-height: 0; overflow: auto; }
    label { display: grid; gap: 6px; color: var(--pi-muted); min-height: 0; }
    /* The prompt field takes what the surface can spare: a comfortable six
       lines when there is room, less on a short landscape posture, so the
       description hint and footer stay reachable without scrolling. */
    .grow { grid-template-rows: auto minmax(var(--prompt-field-min), 1fr) auto; --prompt-field-min: min(6lh, 22dvh); }
    small { color: var(--pi-muted); font-size: var(--pi-text-sm, .85em); }
    input, textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-bg); color: var(--pi-text); padding: 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    textarea { min-height: var(--prompt-field-min, 6lh); resize: vertical; line-height: 1.45; }
    code { font-family: var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .error { margin: 0; color: var(--pi-danger-text, var(--pi-text)); }
    .saved { margin: 0; font-size: 1.1em; }
    .path { margin: 0; color: var(--pi-muted); overflow-wrap: anywhere; font: var(--pi-text-sm) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .hint { margin: 0; color: var(--pi-muted); }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
    header button { border: 0; background: transparent; color: var(--pi-muted); font-size: 22px; padding: 0 8px; }
    .primary { border-color: var(--pi-success-border); background: var(--pi-success-border); }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `;
}

function inputValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : "";
}
