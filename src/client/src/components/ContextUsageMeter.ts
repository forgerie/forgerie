import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";

/**
 * Context use earns a rule on screen only once it is close enough to the window
 * to change what someone does next. Below this it is a permanent mark on the
 * line the eye crosses on every turn, reporting a number nobody can act on.
 */
export const CONTEXT_USAGE_VISIBLE_PERCENT = 60;

/**
 * Whether context use is far enough along to be worth showing.
 *
 * An unknown measurement counts as not worth showing: a reading nobody can act
 * on and a reading that has not arrived are the same thing to a reader, and
 * both are quieter as an absence than as an indeterminate mark.
 */
export function contextUsageWorthShowing(contextUsage: SessionStatus["contextUsage"]): boolean {
  const percent = contextUsage?.percent;
  if (percent === undefined || percent === null || !Number.isFinite(percent)) return false;
  return percent >= CONTEXT_USAGE_VISIBLE_PERCENT;
}

@customElement("context-usage-meter")
export class ContextUsageMeter extends LitElement {
  @property({ attribute: false }) contextUsage?: SessionStatus["contextUsage"];

  override render() {
    const context = this.contextUsage;
    if (context === undefined || !contextUsageWorthShowing(context)) return nothing;

    const percent = clampPercent(context.percent ?? 0);
    const label = contextUsageLabel(context, percent);
    return html`
      <div
        class="meter"
        style=${`--context-usage:${percent.toFixed(2)}%;`}
        role="progressbar"
        aria-label=${label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${String(percent)}
        title=${label}
      >
        <div class="fill" aria-hidden="true"></div>
      </div>
    `;
  }

  /*
   * One hairline, not two: the meter is the composer's top rule while it is
   * present (the shell blanks the composer's own border via --pi-composer-rule),
   * so the used fraction tints a line the layout already had.
   */
  static override styles = css`
    :host { display: block; height: 1px; }
    .meter { height: 1px; background: var(--pi-border); }
    .fill {
      width: var(--context-usage);
      height: 100%;
      background: color-mix(in srgb, var(--pi-accent) 45%, transparent);
      transition: width 180ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .fill { transition: none; }
    }
  `;
}

function contextUsageLabel(context: NonNullable<SessionStatus["contextUsage"]>, percent: number): string {
  const percentage = `${percent.toFixed(1)}%`;
  if (context.tokens === null) return `Context usage: ${percentage} of ${context.contextWindow.toLocaleString("en-US")} tokens`;
  return `Context usage: ${percentage} · ${context.tokens.toLocaleString("en-US")} of ${context.contextWindow.toLocaleString("en-US")} tokens`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
