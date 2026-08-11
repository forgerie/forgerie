import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ShellPanel } from "../../appShell/panelIntent";

/**
 * The click that asks for a side panel.
 *
 * A finger drags the panel in. A pointer has nothing to drag with, so it needs
 * a place to press. This is that place and nothing more: it is not a bar, it
 * does not span anything, and it puts no frame around the surface it sits on.
 * It floats over the top corner of the session and gets out of the way.
 *
 * Pressing it opens the same sheet the drag opens. There is one way a panel
 * appears, whichever way you asked for it.
 */
@customElement("app-panel-burger")
export class AppPanelBurger extends LitElement {
  @property({ type: String, reflect: true }) side: ShellPanel = "navigation";
  @property({ type: String }) controls = "";
  @property({ type: String }) label = "";
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) onPress?: () => void;

  override render() {
    return html`
      <button
        type="button"
        class="burger"
        title=${this.label}
        aria-label=${this.label}
        aria-controls=${this.controls}
        aria-expanded=${String(this.open)}
        @click=${() => { this.onPress?.(); }}
      >
        <svg class="burger-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
        </svg>
      </button>
    `;
  }

  static override styles = css`
    :host { position: absolute; top: 0; z-index: 5; }
    :host([side="navigation"]) { inset-inline-start: 0; }
    :host([side="workspace"]) { inset-inline-end: 0; }
    /*
     * Quiet until wanted. It sits over the transcript, so it stays muted and
     * gains contrast on approach rather than holding a border all the time.
     */
    .burger { display: grid; place-items: center; width: 40px; height: 40px; margin: 4px; padding: 0; border: 0; border-radius: 10px; background: transparent; color: var(--pi-muted); opacity: .6; cursor: pointer; }
    .burger:hover, .burger:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
    .burger-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; pointer-events: none; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-panel-burger": AppPanelBurger;
  }
}
