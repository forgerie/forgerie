import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionActivity, SessionStatus } from "../api";
import { sessionActivityIndicator } from "../sessionStatusStrip";
import { formatCost, formatTokenCount } from "../utils/format";
import { renderSessionWarningIcon, statusBarStyles } from "./shared";

export interface StatusBarWarningControlContent {
  countText: string;
  accessibleLabel: string;
}

export function statusBarWarningControlContent(count: number, expanded: boolean): StatusBarWarningControlContent | undefined {
  if (!Number.isInteger(count) || count <= 0) return undefined;
  const warningText = `${String(count)} ${count === 1 ? "warning" : "warnings"}`;
  return {
    countText: String(count),
    accessibleLabel: expanded ? `Minimise ${warningText}` : `Show ${warningText} in the warning area`,
  };
}

@customElement("status-bar")
export class StatusBar extends LitElement {
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Number }) warningCount = 0;
  @property({ type: Boolean }) warningsExpanded = false;
  @property({ attribute: false }) onToggleWarnings?: () => void;

  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  private renderActivity() {
    const indicator = sessionActivityIndicator({ status: this.status, activity: this.activity, isSendingPrompt: this.isSendingPrompt });
    if (indicator === undefined) return null;
    return html`
      <span class=${indicator.active ? "activity active" : "activity"} aria-live="polite">
        <span class="dot"></span>
        <span class="activity-text">${indicator.text}</span>
      </span>
    `;
  }

  override render() {
    const status = this.status;
    if (status === undefined) return html`<div class="bar muted">${this.renderActivity() ?? "No session status yet"}</div>`;
    const context = status.contextUsage;
    const contextText = context
      ? context.percent == null
        ? `context ${formatTokenCount(context.contextWindow)}`
        : `${context.percent.toFixed(1)}%/${formatTokenCount(context.contextWindow)}`
      : "context unknown";
    const tokens = status.tokens;
    const warningControl = statusBarWarningControlContent(this.warningCount, this.warningsExpanded);
    return html`
      <div class="bar">
        ${this.renderActivity()}
        ${warningControl === undefined || this.onToggleWarnings === undefined ? null : html`
          <button
            type="button"
            class="warning-toggle"
            title=${warningControl.accessibleLabel}
            aria-label=${warningControl.accessibleLabel}
            aria-expanded=${String(this.warningsExpanded)}
            @click=${this.handleToggleWarnings}
          >
            ${renderSessionWarningIcon("warning", "warning-toggle-icon")}
            <span>${warningControl.countText}</span>
          </button>
        `}
        <span>↑${formatTokenCount(tokens.input)}</span>
        <span>↓${formatTokenCount(tokens.output)}</span>
        <span class="context">${contextText}</span>
        <span>${formatCost(status.cost)}</span>
        ${status.pendingMessageCount > 0 ? html`<span>${String(status.pendingMessageCount)} queued</span>` : null}
      </div>
    `;
  }

  static override styles = statusBarStyles;
}
