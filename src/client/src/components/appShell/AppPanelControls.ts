import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * A panel's own pin and close.
 *
 * These belong to the panel, not to whatever is presenting it. A docked panel
 * used to have neither and depended on a control outside itself, which is how
 * it became possible to pin a panel and have no way to unpin it.
 *
 * It carries its own styles because it is handed to a panel and rendered inside
 * that panel's shadow root, beside the panel's own header buttons. An earlier
 * attempt floated these over the header instead, where they covered the New and
 * More commands they were supposed to sit next to.
 */
@customElement("app-panel-controls")
export class AppPanelControls extends LitElement {
  @property({ type: String }) noun = "panel";
  @property({ type: String }) controls = "";
  @property({ type: Boolean }) pinned = false;
  @property({ type: Boolean }) pinnable = false;
  @property({ type: String }) promoteTitle?: string;
  @property({ attribute: false }) onPin?: () => void;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onPromote?: () => void;

  override render() {
    return html`
      ${this.onPromote === undefined ? null : html`
        <button
          type="button"
          class="control"
          data-action="promote"
          title=${this.promoteTitle ?? `Open ${this.noun} as tab`}
          aria-label=${this.promoteTitle ?? `Open ${this.noun} as tab`}
          aria-controls=${this.controls}
          @click=${() => { this.onPromote?.(); }}
        >
          <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16" />
          </svg>
        </button>
      `}
      ${this.pinnable ? html`
        <button
          type="button"
          class="control"
          data-action="pin"
          data-pressed=${String(this.pinned)}
          title=${this.pinned ? `Unpin ${this.noun}` : `Pin ${this.noun} open`}
          aria-label=${this.pinned ? `Unpin ${this.noun}` : `Pin ${this.noun} open`}
          aria-pressed=${String(this.pinned)}
          aria-controls=${this.controls}
          @click=${() => { this.onPin?.(); }}
        >
          <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" /><path d="M12 15v5" />
          </svg>
        </button>
      ` : null}
      <button
        type="button"
        class="control"
        data-action="close"
        title=${`Close ${this.noun}`}
        aria-label=${`Close ${this.noun}`}
        aria-controls=${this.controls}
        @click=${() => { this.onClose?.(); }}
      >
        <svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12" /><path d="M18 6L6 18" />
        </svg>
      </button>
    `;
  }

  static override styles = css`
    :host { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
    .control { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--pi-radius-control); background: transparent; color: var(--pi-muted); opacity: .75; cursor: pointer; }
    .control:hover, .control:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
    .control[data-pressed="true"] { color: var(--pi-accent); opacity: 1; }
    .control-icon { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-panel-controls": AppPanelControls;
  }
}
