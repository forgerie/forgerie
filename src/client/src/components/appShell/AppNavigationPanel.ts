import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { Machine, MachineHealth, SessionActivity, SessionInfo, SessionStatus, Workspace, WorkspaceActivity } from "../../api";
import type { Project } from "../../api";
import type { GlobalSessionsState } from "../../appState";
import { EMPTY_UNREAD_PRESENCE, type UnreadPresence } from "../../unreadPresence";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "../MachineSwitcher";
import "../MachineList";
import "../SessionInboxPanel";

export type NavigationFocusTarget = "inbox" | "chat";

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  // ---- machine switcher (unchanged) ----
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineActivities: Record<string, Record<string, WorkspaceActivity>> = {};
  @property({ attribute: false }) unreadPresence: UnreadPresence = EMPTY_UNREAD_PRESENCE;

  // ---- inbox data (from U4 store) ----
  @property({ attribute: false }) globalSessions: GlobalSessionsState | undefined;
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadCompletedAt: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};

  // ---- layout flags ----
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) compact = false;

  // ---- callbacks ----
  @property({ attribute: false }) onShowActions?: () => void;
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onPinSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onUnpinSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) undoToast?: { readonly session: SessionInfo; readonly machineId?: string };
  @property({ attribute: false }) onUndoArchive?: () => void | Promise<void>;
  @property({ attribute: false }) onDismissUndoToast?: () => void | Promise<void>;
  /**
   * Entry point for U7 (new session from workspace picker).
   * Fires when the inbox new-session button is clicked.
   */
  @property({ attribute: false }) onNewSession?: () => void | Promise<void>;
  /**
   * Entry point for U7 (manage workspaces).
   * Fires when the inbox 'Workspaces' management button is clicked.
   */
  @property({ attribute: false }) onManageWorkspaces?: () => void | Promise<void>;
  @property({ attribute: false }) unavailableCwds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) onFocusNavigationTarget?: (target: NavigationFocusTarget) => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  /** Dismiss the navigation overlay. Only meaningful while `compact` is set. */
  @property({ attribute: false }) refreshControl?: unknown;
  @property({ attribute: false }) panelControls?: unknown;
  @property({ attribute: false }) inboxShelves: readonly unknown[] = [];

  @query("machine-list") private machineList?: KeyboardNavigableSection;
  @query("machine-switcher") private machineSwitcher?: KeyboardNavigableSection;

  async focusInbox(): Promise<boolean> {
    await this.updateComplete;
    // Currently the inbox has no KeyboardNavigableSection interface; focus the
    // panel element and let it manage inner focus.
    const inboxPanel = this.shadowRoot?.querySelector("session-inbox-panel");
    if (inboxPanel instanceof HTMLElement) {
      inboxPanel.focus();
      return true;
    }
    return false;
  }

  override render() {
    const machineId = this.selectedMachine?.id;

    return html`
      ${!this.compact && shouldShowMachinesSection(this.machines) ? html`
        <header>
          <machine-switcher
            .machines=${this.machines}
            .selected=${this.selectedMachine}
            .statuses=${this.machineStatuses}
            .activities=${this.machineActivities}
            .unreadMachineIds=${this.unreadPresence.machines}
            .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
            .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
            .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
          ></machine-switcher>
        </header>
      ` : null}
      ${this.compact && shouldShowMachinesSection(this.machines) ? html`
        <machine-list
          .machines=${this.machines}
          .selected=${this.selectedMachine}
          .statuses=${this.machineStatuses}
          .activities=${this.machineActivities}
          .unreadMachineIds=${this.unreadPresence.machines}
          .collapsible=${this.collapsible}
          .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
          .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
          .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
        ></machine-list>
      ` : null}
      <session-inbox-panel
        .globalSessions=${this.globalSessions}
        .selectedSession=${this.selectedSession}
        .sessionActivities=${this.sessionActivities}
        .unreadSessionIds=${this.unreadSessionIds}
        .unreadCompletedAt=${this.unreadCompletedAt}
        .projects=${this.projects}
        .workspacesByProjectId=${this.workspacesByProjectId}
        .onSelectSession=${this.onSelectSession}
        .onArchiveSession=${this.onArchiveSession}
        .onPinSession=${this.onPinSession}
        .onUnpinSession=${this.onUnpinSession}
        .onRestoreSession=${this.onRestoreSession}
        .onDeleteSession=${this.onDeleteSession}
        .onNewSession=${this.onNewSession}
        .onManageWorkspaces=${this.onManageWorkspaces}
        .onShowActions=${this.onShowActions}
        .refreshControl=${this.refreshControl}
        .panelControls=${this.panelControls}
        .undoToast=${this.undoToast}
        .onUndoArchive=${this.onUndoArchive}
        .onDismissUndoToast=${this.onDismissUndoToast}
        .unavailableCwds=${this.unavailableCwds}
        .inboxShelves=${this.inboxShelves}
        .compact=${this.compact}
        data-machine=${machineId ?? ""}
      ></session-inbox-panel>
    `;
  }

  private cancelKeyboardNavigation(): void {
    void this.onCancelKeyboardNavigation?.();
  }

  static override styles = css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    :host([compact]) { flex: 1 1 auto; }
    /* Only drawn when there is a machine choice to make; a single machine gets the space back. */
    header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); }
    machine-switcher { flex: 1 1 auto; min-width: 0; }
    machine-list { flex: 0 0 auto; overflow: hidden; border-bottom: 1px solid var(--pi-border-muted); }
    session-inbox-panel { flex: 1 1 0px; min-height: 0; overflow: hidden; }
  `;
}

export function shouldShowMachinesSection(machines: readonly Machine[]): boolean {
  return machines.length > 1;
}
