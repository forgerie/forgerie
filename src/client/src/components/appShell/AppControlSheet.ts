import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { NavigationSection } from "../../appShell/navigationState";
import type { AppState } from "../../appState";
import type { Machine, Project, SessionInfo, SessionStatus, Workspace } from "../../api";
import { sessionWarningControlContent } from "../../sessionWarningVisibility";
import { formatCost, formatTokenCount } from "../../utils/format";
import { controlSheetStyles, renderSessionWarningIcon } from "../shared";
import type { AppMobileMainTab } from "./AppMobileMainTabs";
import "./AppContextBar";
import "./AppMobileMainTabs";

/**
 * The chat surface's controls, on request.
 *
 * Once the chrome bands are retired the conversation owns the screen, and this
 * is the way back to everything they carried. It hosts the existing context bar
 * and tab strip rather than restating their contents, so location labels,
 * icons, badges, and selection keep exactly one implementation.
 *
 * It rises from the composer because that is where it was summoned. Dismissal
 * is always explicit — scrim, the summon control again, or choosing a
 * destination. Nothing here closes on a timer: the user is holding the device,
 * not watching from across the room.
 *
 * It is also where the retired status bar's readings live. Tokens, cost, queued
 * count, and the warning control are consulted occasionally, so they are worth
 * a sheet section and not a permanent row above the keyboard. The sections are
 * named so the sheet reads as three groups — do this, know this, go there —
 * rather than one list.
 */
@customElement("app-control-sheet")
export class AppControlSheet extends LitElement {
  static override styles = controlSheetStyles;

  /** Reflected so the host can claim a real box only while open — see controlSheetStyles. */
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) machine?: Machine;
  @property({ attribute: false }) project?: Project;
  @property({ attribute: false }) workspace?: Workspace;
  @property({ attribute: false }) session?: SessionInfo;
  @property({ attribute: false }) tabs: AppMobileMainTab[] = [];
  @property({ attribute: false }) selectedView: AppState["mainView"] = "chat";
  @property({ type: Number }) notificationCount = 0;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Number }) warningCount = 0;
  @property({ type: Boolean }) warningsExpanded = false;
  @property({ attribute: false }) onSelectView?: (view: AppState["mainView"]) => void;
  @property({ attribute: false }) onOpenSection?: (section: NavigationSection) => void;
  @property({ type: Boolean }) canArchive = false;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onAttachFiles?: () => void;
  @property({ attribute: false }) onArchiveAndNext?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  /** Choosing a destination is a completed intent, so the sheet leaves with it. */
  selectView(view: AppState["mainView"]): void {
    this.onSelectView?.(view);
    this.onClose?.();
  }

  openSection(section: NavigationSection): void {
    this.onOpenSection?.(section);
    this.onClose?.();
  }

  override render(): TemplateResult | null {
    if (!this.open) return null;
    return html`
      <button
        type="button"
        class="control-sheet-scrim"
        aria-label="Close session controls"
        @click=${() => this.onClose?.()}
      ></button>
      <section class="control-sheet" role="dialog" aria-modal="true" aria-label="Session controls">
        <span class="control-sheet-grab" aria-hidden="true"></span>
        ${this.renderActions()}
        ${this.renderSessionReadings()}
        <p class="control-sheet-section" id="control-sheet-go">Go to</p>
        <app-context-bar
          .machines=${this.machines}
          .machine=${this.machine}
          .project=${this.project}
          .workspace=${this.workspace}
          .session=${this.session}
          .onOpenSection=${(section: NavigationSection) => { this.openSection(section); }}
        ></app-context-bar>
        <app-mobile-main-tabs
          .tabs=${this.tabs}
          .selectedView=${this.selectedView}
          .onSelect=${(view: AppState["mainView"]) => { this.selectView(view); }}
        ></app-mobile-main-tabs>
        ${this.renderNotificationSummary()}
      </section>
    `;
  }

  /** Attaching leaves with the sheet: the file picker must not open behind it. */
  attachFiles(): void {
    this.onAttachFiles?.();
    this.onClose?.();
  }

  private renderActions() {
    const canArchive = this.canArchive && this.onArchiveAndNext !== undefined;
    if (this.onAttachFiles === undefined && !canArchive) return null;
    return html`
      <p class="control-sheet-section">Do</p>
      ${this.onAttachFiles === undefined ? null : html`<button type="button" class="control-sheet-action" @click=${() => { this.attachFiles(); }}>Attach files</button>`}
      ${canArchive ? html`<button type="button" class="control-sheet-action" @click=${() => { this.onArchiveAndNext?.(); this.onClose?.(); }}>Archive &amp; next</button>` : null}
    `;
  }

  private renderSessionReadings() {
    const status = this.status;
    if (status === undefined) return html`<p class="control-sheet-note">No session status yet</p>`;
    const tokens = status.tokens;
    return html`
      <p class="control-sheet-section">Session</p>
      <div class="control-sheet-readings">
        <span title="Input tokens">↑${formatTokenCount(tokens.input)}</span>
        <span title="Output tokens">↓${formatTokenCount(tokens.output)}</span>
        <span title="Session cost">${formatCost(status.cost)}</span>
        ${status.pendingMessageCount > 0 ? html`<span>${String(status.pendingMessageCount)} queued</span>` : null}
      </div>
      ${this.renderWarningControl()}
      ${this.renderNotificationSummary()}
    `;
  }

  private renderWarningControl() {
    const warnings = sessionWarningControlContent(this.warningCount, this.warningsExpanded);
    if (warnings === undefined || this.onToggleWarnings === undefined) return null;
    return html`
      <button
        type="button"
        class="control-sheet-action"
        aria-expanded=${String(this.warningsExpanded)}
        @click=${() => { this.onToggleWarnings?.(); this.onClose?.(); }}
      >${renderSessionWarningIcon("warning", "control-sheet-warning-icon")}${warnings.summary}</button>
    `;
  }

  private renderNotificationSummary() {
    if (this.notificationCount <= 0) return null;
    const count = this.notificationCount;
    return html`
      <p class="control-sheet-notifications">${String(count)} ${count === 1 ? "notification" : "notifications"}</p>
    `;
  }
}
