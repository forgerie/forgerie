import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  notificationDismissLabel,
  notificationFocusTargetAfterDismiss,
  notificationInboxOverflowLabel,
  notificationInboxTotalCount,
  notificationMessageTruncationLabel,
  notificationPanelHeading,
  notificationSeverityLabel,
  notificationTargetKey,
  type NotificationFocusTarget,
  type SelectedSessionNotificationView,
} from "../sessionNotifications";
import { workspacePanelStyles } from "./shared";

const notificationTimestampFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

interface PendingNotificationFocus {
  inboxKey: string;
  target: NotificationFocusTarget;
}

function renderNotificationCloseIcon(): TemplateResult {
  return html`
    <svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12"></path>
      <path d="M18 6 6 18"></path>
    </svg>
  `;
}

@customElement("session-notifications-panel")
export class SessionNotificationsPanel extends LitElement {
  @property({ attribute: false }) inbox: SelectedSessionNotificationView | undefined;
  @property({ attribute: false }) onDismissNotification: ((notificationId: string) => void) | undefined;
  @property({ attribute: false }) onDismissAllNotifications: (() => void) | undefined;

  private pendingFocus: PendingNotificationFocus | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("inbox")) return;
    const previous = changed.get("inbox");
    if (previous !== undefined && this.inbox !== undefined && notificationTargetKey(previous) !== notificationTargetKey(this.inbox)) {
      this.pendingFocus = undefined;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("inbox") && this.pendingFocus !== undefined) this.focusPendingTarget();
  }

  override render(): TemplateResult {
    const inbox = this.inbox;
    const totalCount = inbox === undefined ? 0 : notificationInboxTotalCount(inbox);
    return html`
      <section class="notifications-panel" aria-labelledby="session-notifications-heading">
        <section class="toolbar notification-header" data-notification-focus="header" tabindex="-1">
          <strong id="session-notifications-heading">${inbox === undefined ? "Notifications" : notificationPanelHeading(inbox)}</strong>
          <button
            type="button"
            class="notification-clear"
            aria-label="Clear all notifications"
            title="Clear all notifications"
            ?disabled=${inbox === undefined || inbox.dismissAllPending || totalCount === 0 || this.onDismissAllNotifications === undefined}
            @click=${this.dismissAllNotifications}
          >Clear</button>
        </section>
        ${this.renderInbox(inbox)}
      </section>
    `;
  }

  private renderInbox(inbox: SelectedSessionNotificationView | undefined): TemplateResult {
    if (inbox === undefined) return html`<p class="empty-state">Notifications are loading for this session.</p>`;
    if (notificationInboxTotalCount(inbox) === 0) return html`<p class="empty-state">No notifications for this session.</p>`;
    return html`
      <div class="notification-list">
        ${inbox.discardedCount === 0 ? null : html`
          <p class="notification-overflow">${notificationInboxOverflowLabel(inbox.discardedCount)}</p>
        `}
        ${inbox.notifications.map((notification) => {
          const truncationLabel = notificationMessageTruncationLabel(notification);
          return html`
            <article class=${`notification-row ${notification.severity}`} data-notification-id=${notification.id} tabindex="-1">
              <div class="notification-metadata">
                <strong class="notification-severity">${notificationSeverityLabel(notification.severity)}</strong>
                <span aria-hidden="true">·</span>
                <time datetime=${notification.receivedAt}>${notificationTimestampFormatter.format(new Date(notification.receivedAt))}</time>
              </div>
              <p class="notification-message" dir="auto">${notification.message}</p>
              ${truncationLabel === undefined ? null : html`<p class="notification-truncated">${truncationLabel}</p>`}
              <button
                type="button"
                class="notification-row-dismiss"
                aria-label=${notificationDismissLabel(notification)}
                title="Dismiss notification"
                ?disabled=${inbox.pendingDismissedIds.has(notification.id) || inbox.dismissAllPending || this.onDismissNotification === undefined}
                @click=${() => { this.dismissNotification(notification.id); }}
              >${renderNotificationCloseIcon()}</button>
            </article>
          `;
        })}
      </div>
    `;
  }

  private dismissNotification(notificationId: string): void {
    const inbox = this.inbox;
    if (inbox === undefined || this.onDismissNotification === undefined) return;
    this.pendingFocus = {
      inboxKey: notificationTargetKey(inbox),
      target: notificationFocusTargetAfterDismiss(inbox.notifications, notificationId),
    };
    this.onDismissNotification(notificationId);
  }

  private readonly dismissAllNotifications = (): void => {
    const inbox = this.inbox;
    if (inbox === undefined || this.onDismissAllNotifications === undefined) return;
    this.pendingFocus = { inboxKey: notificationTargetKey(inbox), target: { kind: "header" } };
    this.onDismissAllNotifications();
  };

  private focusPendingTarget(): void {
    const pending = this.pendingFocus;
    this.pendingFocus = undefined;
    const inbox = this.inbox;
    if (pending === undefined || inbox === undefined || pending.inboxKey !== notificationTargetKey(inbox)) return;
    if (pending.target.kind === "notification") {
      const notificationId = pending.target.notificationId;
      const row = [...this.renderRoot.querySelectorAll<HTMLElement>("[data-notification-id]")]
        .find((candidate) => candidate.dataset["notificationId"] === notificationId);
      if (row !== undefined) {
        row.focus();
        return;
      }
    }
    this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
  }

  static override styles = [
    workspacePanelStyles,
    css`
      :host { flex: 1 1 auto; }
      .notifications-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
      .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; padding: 0 10px 5px; }
      .notification-overflow { margin: 0; padding: 7px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
      .notification-row { position: relative; min-width: 0; display: grid; gap: 4px; padding: 9px 38px 9px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); }
      .notification-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
      .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: 5px; color: var(--pi-muted); font-size: 11px; }
      .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
      .notification-row.warning .notification-severity { color: var(--pi-warning); }
      .notification-row.error .notification-severity { color: var(--pi-danger); }
      .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; }
      .notification-truncated { margin: 0; color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
      .notification-row-dismiss { position: absolute; top: 5px; right: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; background: transparent; color: var(--pi-muted); }
      .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
      .notification-row-dismiss:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
      .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
      .notification-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: 24px; color: var(--pi-muted); text-align: center; }
      @media (pointer: coarse) {
        .notification-row-dismiss { width: 34px; height: 34px; min-height: 34px; }
        .notification-row { padding-right: 40px; }
      }
    `,
  ];
}
