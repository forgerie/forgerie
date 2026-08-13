import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { composerPopoverPlacement, type ComposerPopoverPlacementInput } from "../composerPopoverPlacement";

export type ComposerPopoverMeasurement = Pick<ComposerPopoverPlacementInput, "anchor" | "space" | "host" | "panel">;

/**
 * One floating layer for the composer's choices.
 *
 * A popover is not a modal. It raises no scrim, traps no focus, and Escape
 * hands the caret back to the draft rather than closing a surface behind it.
 * It anchors to the control that opened it and may overflow the island, which
 * is what a dialog with `overflow:hidden` could never allow.
 */
@customElement("composer-popover")
export class ComposerPopover extends LitElement {
  /** Names the panel for a screen reader; usually the control's own label. */
  @property() label?: string;
  /** The control this panel belongs to. Measured to place the panel. */
  @property({ attribute: false }) anchor?: HTMLElement;
  /** Overrides measurement. Supplied by tests; the DOM answers otherwise. */
  @property({ attribute: false }) measure?: () => ComposerPopoverMeasurement;
  @property({ attribute: false }) onClose?: (restoreFocus: boolean) => void;

  @query(".popover-panel") private panel?: HTMLElement | null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this.handleKeyDown);
    // Capture, so a press is seen before a control inside can act on it.
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    window.addEventListener("resize", this.handleReposition);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    window.removeEventListener("resize", this.handleReposition);
  }

  protected override updated(): void {
    this.applyPlacement();
  }

  override render(): TemplateResult {
    return html`
      <div class="popover-panel" role="dialog" aria-label=${this.label ?? "Choice"}>
        <slot></slot>
      </div>
    `;
  }

  /** Re-measure and re-place, for a host whose rail has changed width. */
  reposition(): void {
    this.applyPlacement();
  }

  private applyPlacement(): void {
    const panel = this.panel;
    if (panel === undefined || panel === null) return;
    const measurement = this.measurement(panel);
    if (measurement === undefined) return;
    const placement = composerPopoverPlacement(measurement);
    this.dataset["side"] = placement.side;
    panel.style.left = `${String(placement.left)}px`;
    // A ceiling only. The panel takes its width from its content, so it is
    // never measured into a smaller and smaller box on each update.
    panel.style.maxWidth = `${String(placement.maxWidth)}px`;
  }

  private measurement(panel: HTMLElement): ComposerPopoverMeasurement | undefined {
    const supplied = this.measure;
    if (supplied !== undefined) return supplied();
    const anchor = this.anchor;
    const host = this.offsetParent;
    if (anchor === undefined || !(host instanceof HTMLElement)) return undefined;
    const anchorRect = anchor.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      anchor: { left: anchorRect.left - hostRect.left, width: anchorRect.width },
      space: { above: anchorRect.top, below: window.innerHeight - anchorRect.bottom },
      host: { width: hostRect.width },
      panel: { height: panelRect.height },
    };
  }

  private readonly handleReposition = (): void => {
    this.applyPlacement();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.onClose?.(true);
  };

  private readonly handleDocumentPointerDown = (event: Event): void => {
    const target = event.composedPath()[0];
    if (target instanceof Node && (this.contains(target) || this.shadowRoot?.contains(target) === true)) return;
    if (this.anchor !== undefined && target instanceof Node && this.anchor.contains(target)) return;
    this.onClose?.(false);
  };

  static override styles = css`
    :host { position: absolute; inset-inline: 0; z-index: 20; display: block; color: var(--pi-text); font: 14px system-ui, sans-serif; pointer-events: none; }
    :host([data-side="above"]) { bottom: calc(100% + 8px); }
    :host([data-side="below"]) { top: calc(100% + 8px); }
    .popover-panel {
      /* Sized by content, capped by placement. A minimum keeps a short list
         from collapsing to the width of its longest word. */
      position: absolute; width: max-content; min-width: 220px; max-height: 320px; overflow-y: auto; pointer-events: auto;
      border: 1px solid var(--pi-border); border-radius: 12px; background: var(--pi-surface);
      box-shadow: 0 10px 30px var(--pi-shadow-strong);
    }
    :host([data-side="below"]) .popover-panel { top: 0; }
    :host([data-side="above"]) .popover-panel { bottom: 0; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "composer-popover": ComposerPopover;
  }
}
