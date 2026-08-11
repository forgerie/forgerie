import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { SESSION_GUIDANCE_ENTRIES } from "../../../shared/sessionGuidance";

@customElement("guidance-picker")
export class GuidancePicker extends LitElement {
  @property({ attribute: false }) activeIds: readonly string[] = [];
  @property({ type: Boolean }) pending = false;
  @property({ type: Boolean }) working = false;
  @property({ type: Boolean }) readOnly = false;
  @property() error?: string;
  @property({ attribute: false }) trigger?: HTMLElement;
  @property({ attribute: false }) onToggle?: (entryId: string, enabled: boolean) => void;
  @property({ attribute: false }) onClose?: (restoreFocus: boolean) => void;

  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (path.includes(this) || (this.trigger !== undefined && path.includes(this.trigger))) return;
    this.onClose?.(false);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    const firstEnabled = this.optionButtons().find((button) => !button.disabled);
    if (firstEnabled !== undefined) firstEnabled.focus();
    else this.shadowRoot?.querySelector<HTMLElement>(".guidance-panel")?.focus();
  }

  override render() {
    return html`
      <section class="guidance-panel" tabindex="-1" aria-label="Session guidance" @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
        <header><strong>Guidance</strong></header>
        <div class="guidance-options">
          ${SESSION_GUIDANCE_ENTRIES.map((entry) => {
            const active = this.activeIds.includes(entry.id);
            return html`
              <button
                data-guidance-id=${entry.id}
                aria-pressed=${active ? "true" : "false"}
                ?disabled=${this.pending || this.readOnly}
                @click=${() => { this.onToggle?.(entry.id, !active); }}
              >
                <span class="guidance-copy"><strong>${entry.name}</strong><small>${entry.description}</small></span>
                <span class="guidance-state" aria-hidden="true">${active ? "✓" : ""}</span>
              </button>
            `;
          })}
        </div>
        ${this.working ? html`<p class="guidance-note">Changes apply to the next turn.</p>` : null}
        ${this.readOnly ? html`<p class="guidance-note">Restore this session to change guidance.</p>` : null}
        ${this.error === undefined ? null : html`<p class="guidance-error" role="alert">${this.error}</p>`}
      </section>
    `;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.onClose?.(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const target = event.composedPath()[0];
      if (!(target instanceof HTMLButtonElement) || target.disabled) return;
      const entryId = target.dataset["guidanceId"];
      if (entryId === undefined) return;
      event.preventDefault();
      this.onToggle?.(entryId, !this.activeIds.includes(entryId));
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = this.optionButtons().filter((button) => !button.disabled);
    if (buttons.length === 0) return;
    const current = this.shadowRoot?.activeElement;
    const index = Math.max(0, buttons.findIndex((button) => button === current));
    const delta = event.key === "ArrowDown" ? 1 : -1;
    event.preventDefault();
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }

  private optionButtons(): HTMLButtonElement[] {
    return Array.from(this.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-guidance-id]") ?? []);
  }

  static override styles = css`
    :host { position: absolute; right: clamp(6px, 2cqi, 12px); bottom: calc(100% + 8px); left: clamp(6px, 2cqi, 12px); z-index: 20; display: block; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .guidance-panel { max-height: 260px; overflow-y: auto; border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow-strong); }
    header { padding: 9px 11px; border-bottom: 1px solid var(--pi-border-muted); }
    .guidance-options button { box-sizing: border-box; width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 11px; border: 0; border-bottom: 1px solid var(--pi-border-muted); border-radius: 0; background: transparent; color: var(--pi-text); font: inherit; text-align: left; cursor: pointer; }
    .guidance-options button:hover:not(:disabled), .guidance-options button:focus-visible { background: var(--pi-selection-bg); }
    .guidance-options button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .guidance-options button:disabled { opacity: .65; cursor: wait; }
    .guidance-copy { min-width: 0; display: grid; gap: 3px; }
    .guidance-copy small { color: var(--pi-muted); line-height: 1.35; white-space: normal; }
    .guidance-state { color: var(--pi-accent); font-weight: 700; }
    .guidance-note, .guidance-error { margin: 0; padding: 8px 11px; color: var(--pi-muted); font-size: 12px; }
    .guidance-error { color: var(--pi-danger); }
  `;
}
