import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatElapsed } from "../chatLiveness";
import { elapsedSince } from "../sessionWorkingRuntime";
import { transcriptLivenessStyles } from "./shared";

/**
 * The liveness line shown at the foot of a running turn.
 *
 * Owns its own ticking so the elapsed count does not re-render the transcript
 * once a second. A long session holds hundreds of message groups, and driving
 * the clock from ChatView would revalidate all of them on every tick.
 */
@customElement("transcript-liveness")
export class TranscriptLivenessView extends LitElement {
  static override styles = transcriptLivenessStyles;

  /** ISO timestamp the current activity started at. */
  @property() startedAt = "";

  /** What the session is doing right now. */
  @property() step = "";

  @state() private now = Date.now();

  private timer: ReturnType<typeof setInterval> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.startTicking();
  }

  override disconnectedCallback(): void {
    this.stopTicking();
    super.disconnectedCallback();
  }

  override render() {
    const elapsed = elapsedSince(this.startedAt, this.now);
    return html`
      <p class="liveness" aria-live="polite">
        <span class="liveness-dot" aria-hidden="true"></span>
        <span>${elapsed === undefined ? this.step : `${formatElapsed(elapsed)} · ${this.step}`}</span>
      </p>
    `;
  }

  private startTicking(): void {
    if (this.timer !== undefined) return;
    this.now = Date.now();
    this.timer = setInterval(() => { this.now = Date.now(); }, 1000);
  }

  private stopTicking(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "transcript-liveness": TranscriptLivenessView;
  }
}
