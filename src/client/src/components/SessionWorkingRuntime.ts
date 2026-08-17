import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { elapsedSince, formatWorkingRuntime, nextWorkingRuntimeTick, workingRuntimeLabel } from "../sessionWorkingRuntime";

/** The quiet minute-precision runtime shown in a Working inbox row. */
@customElement("session-working-runtime")
export class SessionWorkingRuntime extends LitElement {
  @property() startedAt = "";

  @state() private now = Date.now();

  private timer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.scheduleTick();
  }

  override disconnectedCallback(): void {
    this.stopTicking();
    super.disconnectedCallback();
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("startedAt")) this.scheduleTick();
  }

  override render() {
    // No clock glyph: the pulsing row marker already says "working", and a
    // glyph on every working row read as a column of repeated chrome.
    const elapsed = elapsedSince(this.startedAt, this.now) ?? 0;
    return html`<span aria-label=${workingRuntimeLabel(elapsed)}>${formatWorkingRuntime(elapsed)}</span>`;
  }

  private scheduleTick(): void {
    this.stopTicking();
    if (!this.isConnected) return;
    this.now = Date.now();
    const elapsed = elapsedSince(this.startedAt, this.now) ?? 0;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduleTick();
    }, nextWorkingRuntimeTick(elapsed));
  }

  private stopTicking(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      font-variant-numeric: tabular-nums;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "session-working-runtime": SessionWorkingRuntime;
  }
}
