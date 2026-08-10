import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { NavigationSection } from "../../appShell/navigationState";
import type { AppState } from "../../appState";
import type { Machine, Project, SessionInfo, Workspace } from "../../api";
import { controlSheetStyles } from "../shared";
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
  @property({ attribute: false }) onSelectView?: (view: AppState["mainView"]) => void;
  @property({ attribute: false }) onOpenSection?: (section: NavigationSection) => void;
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

  private renderNotificationSummary() {
    if (this.notificationCount <= 0) return null;
    const count = this.notificationCount;
    return html`
      <p class="control-sheet-notifications">${String(count)} ${count === 1 ? "notification" : "notifications"}</p>
    `;
  }
}
