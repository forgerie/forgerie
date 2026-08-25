import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { TurnLedgerRow } from "../turnRail";
import "./ToolExecutionView";

/**
 * The compact middle depth between a receipt and a full tool execution.
 *
 * Each step gets one row. A row shows only quantities its verb genuinely owns;
 * opening it reuses ToolExecutionView for the full path, error, result, or diff.
 */
@customElement("turn-rail-ledger")
export class TurnRailLedger extends LitElement {
  @property({ attribute: false }) rows: readonly TurnLedgerRow[] = [];

  override render() {
    return html`
      <div class="ledger">
        ${this.rows.map((row) => html`
          <details class=${`row ${row.outcome}`}>
            <summary>
              <span class="glyph" aria-hidden="true">${outcomeGlyph(row.outcome)}</span>
              ${row.outcome === "failed" ? null : html`<span class="sr-only">${outcomeLabel(row.outcome)}</span>`}
              <span class="verb">${row.verb}</span>
              <span class="target">${row.label}</span>
              ${row.editCount === undefined ? null : html`<span class="quantity">${String(row.editCount)} ${row.editCount === 1 ? "edit" : "edits"}</span>`}
              ${row.added === 0 && row.removed === 0 ? null : html`
                <span class="diff-stats"><b class="added">+${String(row.added)}</b><span>/</span><b class="removed">-${String(row.removed)}</b></span>
              `}
              ${row.outcome === "failed" ? html`<span class="outcome">failed</span>` : null}
            </summary>
            <div class="detail">
              ${row.evidence === undefined ? null : html`<p class="evidence">${row.evidence}</p>`}
              <tool-execution-view .execution=${row.execution} presentation="detail"></tool-execution-view>
            </div>
          </details>
        `)}
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; min-width: 0; color: var(--calm-ink-dim); font-size: var(--pi-text-sm); }
    .ledger { display: grid; min-width: 0; }
    .row { min-width: 0; border-bottom: 1px solid var(--pi-border-muted); }
    .row:last-child { border-bottom: 0; }
    summary { display: flex; align-items: baseline; gap: 7px; min-width: 0; padding: 5px 0; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .glyph { flex: 0 0 auto; color: var(--pi-muted); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .failed .glyph, .failed .outcome { color: var(--calm-danger); }
    .verb { flex: 0 0 auto; color: var(--calm-ink-muted); font-weight: 500; }
    .target { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--pi-accent); text-overflow: ellipsis; white-space: nowrap; font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
    .quantity, .outcome { flex: 0 0 auto; color: var(--pi-muted); font-variant-numeric: tabular-nums; }
    .diff-stats { flex: 0 0 auto; display: inline-flex; gap: 3px; font-variant-numeric: tabular-nums; }
    .added { color: var(--pi-success); }
    .removed { color: var(--pi-danger); }
    .detail { display: grid; gap: 8px; padding: 3px 0 10px 16px; }
    .evidence { margin: 0; overflow-wrap: anywhere; color: var(--calm-danger); font: var(--pi-text-sm) ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  `;
}

function outcomeGlyph(outcome: TurnLedgerRow["outcome"]): string {
  if (outcome === "done") return "✓";
  if (outcome === "failed") return "✗";
  return "●";
}

function outcomeLabel(outcome: TurnLedgerRow["outcome"]): string {
  if (outcome === "done") return "done";
  if (outcome === "failed") return "failed";
  return "working";
}

declare global {
  interface HTMLElementTagNameMap {
    "turn-rail-ledger": TurnRailLedger;
  }
}
