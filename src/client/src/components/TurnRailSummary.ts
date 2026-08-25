import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TurnRailState } from "../turnRail";
import "./SessionWorkingRuntime";

/**
 * The turn rail's collapsed register.
 *
 * A turn used to cost roughly one screen of scroll per step, because every step
 * restated its absolute path and opened its own diff. This says the same work in
 * one line plus one line per unresolved failure, and puts the rest one tap away.
 * The live register and finished receipt share one information layout. The
 * state marker and runtime change while work is active, but the totals stay in
 * place when the turn settles.
 */
type VisibleTurnRailState = Exclude<TurnRailState, { readonly kind: "idle" }>;

@customElement("turn-rail-summary")
export class TurnRailSummary extends LitElement {
  @property({ attribute: false }) state: TurnRailState | undefined;
  /** ISO timestamp for the whole live turn; empty on settled receipts. */
  @property() startedAt = "";
  @property({ type: Boolean }) open = false;

  override render() {
    const state = this.state;
    if (state === undefined || state.kind === "idle") return null;
    return html`<div class=${`quiet-line ${state.kind}`}>${this.renderSummary(state)}</div>`;
  }

  /** The transcript's liveness row names the current step, so this line owns totals only. */
  private renderSummary(state: VisibleTurnRailState) {
    const label = this.open ? "Hide steps" : `Show all ${String(state.stepCount)} steps`;
    const working = state.kind === "working";
    const unresolved = working ? state.pins : state.unresolved;
    const glyph = working ? "●" : state.outcome === "done" ? "✓" : "✗";
    return html`
      <button
        type="button"
        class=${`line ${working ? "heartbeat" : "receipt"} disclosure`}
        aria-expanded=${this.open ? "true" : "false"}
        title=${label}
        @click=${() => { this.toggle(); }}
      >
        <span class="sr-only">${label}. </span>
        <span class="glyph" aria-hidden="true">${glyph}</span>
        <span class="counts">${stepCountLabel(state.stepCount)}${state.fileCount === 0 ? "" : ` · ${fileCountLabel(state.fileCount)}`}</span>
        ${state.added === 0 && state.removed === 0
          ? null
          : html`<span class="diff-stats"><b class="added">+${String(state.added)}</b><span>/</span><b class="removed">-${String(state.removed)}</b></span>`}
        ${working && this.startedAt !== "" ? html`<session-working-runtime class="turn-runtime" .startedAt=${this.startedAt}></session-working-runtime>` : null}
        <span class="disclosure-glyph" aria-hidden="true">${this.open ? "▾" : "▸"}</span>
      </button>
      ${unresolved.length === 0
        ? null
        : html`<p class="sub unresolved">unresolved — ${unresolved.map((pin) => `${pin.verb} ${pin.label}`).join(", ")}</p>`}
      ${state.retries === 0 ? null : html`<p class="sub">${retryLabel(state.retries)}</p>`}
    `;
  }

  private toggle(): void {
    this.dispatchEvent(new CustomEvent("rail-toggle", { bubbles: true, composed: true }));
  }

  static override styles = css`
    :host { display: block; min-width: 0; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); }
    .quiet-line { display: grid; gap: 2px; min-width: 0; }
    .line {
      display: flex; align-items: baseline; gap: 7px; width: 100%; min-width: 0; box-sizing: border-box;
      padding: 3px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left;
      cursor: pointer; border-radius: var(--pi-radius-control, 4px);
    }
    .line:hover { color: var(--calm-ink); }
    .line:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .glyph { flex: 0 0 auto; color: var(--pi-muted); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .counts { flex: 0 0 auto; color: var(--calm-ink-muted); }
    .diff-stats { flex: 0 0 auto; display: inline-flex; gap: 3px; margin-inline-start: auto; font-variant-numeric: tabular-nums; }
    .turn-runtime { flex: 0 0 auto; margin-inline-start: auto; color: var(--pi-muted); }
    .added { color: var(--pi-success); }
    .removed { color: var(--pi-danger); }
    .sub { margin: 0 0 0 16px; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .sub.unresolved { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .disclosure-glyph {
      flex: 0 0 auto; margin-inline-start: auto;
      color: var(--pi-muted); padding: 0 2px; line-height: 1;
    }
    .diff-stats + .turn-runtime, .diff-stats + .disclosure-glyph, .turn-runtime + .disclosure-glyph { margin-inline-start: 0; }
    .line:hover .disclosure-glyph { color: var(--calm-ink-muted); }
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

declare global {
  interface HTMLElementTagNameMap {
    "turn-rail-summary": TurnRailSummary;
  }
}
