import { LitElement, css, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { elapsedSince, formatWorkingRuntime, nextWorkingRuntimeTick, workingRuntimeLabel } from "../sessionWorkingRuntime";

const clockIcon = svg`
  <svg data-runtime-clock viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="5.75"></circle>
    <path d="M8 4.5v3.8l2.4 1.5"></path>
  </svg>
`;

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
    const elapsed = elapsedSince(this.startedAt, this.now) ?? 0;
    return html`${clockIcon}<span aria-label=${workingRuntimeLabel(elapsed)}>${formatWorkingRuntime(elapsed)}</span>`;
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
      gap: 4px;
    }

    svg {
      width: 13px;
      height: 13px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.35;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "session-working-runtime": SessionWorkingRuntime;
  }
}
