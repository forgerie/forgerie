import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { formatTokenCount } from "../utils/format";

@customElement("context-usage-meter")
export class ContextUsageMeter extends LitElement {
  @property({ attribute: false }) contextUsage?: SessionStatus["contextUsage"];

  override render() {
    const context = this.contextUsage;
    if (context === undefined) return nothing;

    const percent = context.percent === null ? undefined : clampPercent(context.percent);
    const label = contextUsageLabel(context, percent);
    return html`
      <div
        class=${percent === undefined ? "meter unknown" : "meter"}
        style=${`--context-usage:${(percent ?? 0).toFixed(2)}%;`}
        role="progressbar"
        aria-label=${label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${percent === undefined ? nothing : String(percent)}
        title=${label}
      >
        <div class="fill" aria-hidden="true"></div>
      </div>
    `;
  }

  static override styles = css`
    :host {
      box-sizing: border-box;
      display: block;
      height: 8px;
      padding: 3px 12px;
      background: var(--pi-bg);
    }
    .meter {
      height: 2px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--pi-border-muted) 54%, transparent);
    }
    .fill {
      width: var(--context-usage);
      height: 100%;
      border-radius: inherit;
      background: var(--pi-accent);
      transition: width 180ms ease-out;
    }
    .meter.unknown {
      background: repeating-linear-gradient(
        90deg,
        color-mix(in srgb, var(--pi-border-muted) 54%, transparent) 0 6px,
        transparent 6px 10px
      );
    }
    .unknown .fill { width: 0; }
    @media (prefers-reduced-motion: reduce) {
      .fill { transition: none; }
    }
  `;
}

function contextUsageLabel(context: NonNullable<SessionStatus["contextUsage"]>, percent: number | undefined): string {
  if (percent === undefined) return `Context usage unavailable · ${formatTokenCount(context.contextWindow)}-token context window`;
  const percentage = `${percent.toFixed(1)}%`;
  if (context.tokens === null) return `Context usage: ${percentage} of ${formatTokenCount(context.contextWindow)} tokens`;
  return `Context usage: ${percentage} · ${context.tokens.toLocaleString("en-US")} of ${context.contextWindow.toLocaleString("en-US")} tokens`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
