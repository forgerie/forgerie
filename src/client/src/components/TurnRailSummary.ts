import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TurnRailState, TurnStep } from "../turnRail";
import "./SessionWorkingRuntime";

/**
 * The turn rail's collapsed register.
 *
 * A turn used to cost roughly one screen of scroll per step, because every step
 * restated its absolute path and opened its own diff. This says the same work in
 * one line plus one line per unresolved failure, and puts the rest one tap away.
 * Success is a heartbeat that replaces itself; only failure is allowed to grow
 * the rail, because failure is the one status worth a glance.
 */
@customElement("turn-rail-summary")
export class TurnRailSummary extends LitElement {
  @property({ attribute: false }) state: TurnRailState | undefined;
  /** ISO timestamp for the whole live turn; empty on settled receipts. */
  @property() startedAt = "";
  @property({ type: Boolean }) open = false;

  override render() {
    const state = this.state;
    if (state === undefined || state.kind === "idle") return null;
    return html`
      <div class=${`quiet-line ${state.kind}`}>
        ${state.kind === "working" ? this.renderWorking(state) : this.renderSettled(state)}
      </div>
    `;
  }

  /**
   * While the turn runs, the transcript's liveness row already names the current
   * step and carries its elapsed clock. Naming it again here put the same
   * sentence on screen twice, so the working register keeps only what that row
   * cannot say: failures it has not recovered from, how much work has happened,
   * and the way into the ledger. `state.current` stays in the model because it
   * is the turn's real state; this view simply is not the surface that shows it.
   */
  private renderWorking(state: Extract<TurnRailState, { kind: "working" }>) {
    return html`
      ${state.pins.map((pin) => renderPin(pin))}
      <div class="line heartbeat">
        <span class="glyph" aria-hidden="true">●</span>
        <span class="counts">${stepCountLabel(state.stepCount)}${retrySuffix(state.retries)}</span>
        ${this.startedAt === "" ? null : html`<session-working-runtime class="turn-runtime" .startedAt=${this.startedAt}></session-working-runtime>`}
        ${this.renderDisclosure(`Show all ${String(state.stepCount)} steps`)}
      </div>
    `;
  }

  private renderSettled(state: Extract<TurnRailState, { kind: "settled" }>) {
    return html`
      <div class="line receipt">
        <span class="glyph" aria-hidden="true">${state.outcome === "done" ? "✓" : "✗"}</span>
        <span class="counts">${stepCountLabel(state.stepCount)}${state.fileCount === 0 ? "" : ` · ${fileCountLabel(state.fileCount)}`}</span>
        ${state.added === 0 && state.removed === 0
          ? null
          : html`<span class="diff-stats"><b class="added">+${String(state.added)}</b><span>/</span><b class="removed">-${String(state.removed)}</b></span>`}
        ${this.renderDisclosure(`Show all ${String(state.stepCount)} steps`)}
      </div>
      ${state.unresolved.length === 0
        ? null
        : html`<p class="sub unresolved">unresolved — ${state.unresolved.map((pin) => `${pin.verb} ${pin.label}`).join(", ")}</p>`}
      ${state.retries === 0 ? null : html`<p class="sub">${retryLabel(state.retries)}</p>`}
    `;
  }

  /**
   * One affordance for both lifetimes: the same control opens a running turn's
   * ledger and a finished turn's receipt, so there is nothing extra to learn
   * when a turn ends under the reader's eyes.
   */
  private renderDisclosure(label: string) {
    return html`
      <button
        type="button"
        class="disclosure"
        aria-expanded=${this.open ? "true" : "false"}
        aria-label=${this.open ? "Hide steps" : label}
        title=${this.open ? "Hide steps" : label}
        @click=${() => { this.dispatchEvent(new CustomEvent("rail-toggle", { bubbles: true, composed: true })); }}
      >${this.open ? "▾" : "▸"}</button>
    `;
  }

  static override styles = css`
    :host { display: block; min-width: 0; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); }
    .quiet-line { display: grid; gap: 2px; min-width: 0; }
    .line { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
    .glyph { flex: 0 0 auto; color: var(--pi-muted); }
    /* Failure is the only state that earns a tone, matching the tool card's rule. */
    .pin .glyph { color: var(--calm-danger); }
    .receipt.line .glyph { color: var(--pi-muted); }
    .quiet-line.settled .line .glyph { color: var(--pi-muted); }
    .verb { flex: 0 0 auto; color: var(--calm-ink-muted); font-weight: 500; }
    .counts { flex: 0 0 auto; color: var(--calm-ink-muted); }
    .target {
      flex: 1 1 auto; min-width: 0; overflow: hidden;
      color: var(--pi-accent); text-overflow: ellipsis; white-space: nowrap;
      font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      direction: ltr; text-align: left; unicode-bidi: isolate;
    }
    .diff-stats { flex: 0 0 auto; display: inline-flex; gap: 3px; margin-inline-start: auto; font-variant-numeric: tabular-nums; }
    .turn-runtime { flex: 0 0 auto; margin-inline-start: auto; color: var(--pi-muted); }
    .added { color: var(--pi-success); }
    .removed { color: var(--pi-danger); }
    .sub { margin: 0 0 0 16px; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .sub.evidence, .sub.unresolved { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .disclosure {
      flex: 0 0 auto; margin-inline-start: auto; border: 0; background: none;
      color: var(--pi-muted); padding: 0 2px; font: inherit; line-height: 1; cursor: pointer;
    }
    .diff-stats + .disclosure, .turn-runtime + .disclosure { margin-inline-start: 0; }
    .disclosure:hover, .disclosure:focus-visible { color: var(--calm-ink-muted); }
  `;
}

function renderPin(pin: TurnStep) {
  return html`
    <div class="line pin">
      <span class="glyph" aria-hidden="true">✗</span>
      <span class="verb">${pin.verb}</span>
      <span class="target">${pin.label}</span>
    </div>
    ${pin.evidence === undefined ? null : html`<p class="sub evidence">${pin.evidence}</p>`}
  `;
}

function stepCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "step" : "steps"}`;
}

function fileCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

function retryLabel(retries: number): string {
  return `${String(retries)} ${retries === 1 ? "retry" : "retries"}`;
}

function retrySuffix(retries: number): string {
  return retries === 0 ? "" : ` · ${retryLabel(retries)}`;
}

declare global {
  interface HTMLElementTagNameMap {
    "turn-rail-summary": TurnRailSummary;
  }
}
