/**
 * Session inbox board panel.
 *
 * Renders the machine-global session inbox derived from `globalSessions` (U4 store)
 * through the `sessionBoard.ts` pure derivation (U3). Replaces the four-section
 * project→workspace→session drill-down as the primary navigation pane content.
 *
 * Design rules (from AGENTS.md + plan):
 *  - Six groups in BOARD_GROUPS order; Open collapsed by default, Archived hidden
 *    behind its own toggle so the archive is opt-in rather than ambient.
 *  - Archive action ≥44px hit area via min-height.
 *  - Theme tokens only; pane-level container query so rows respond to pane width.
 *  - Group-by and collapsed-groups persist per machine in localStorage
 *    (non-sensitive). Archived visibility resets closed whenever the inbox mounts.
 *  - Board-local keys mirror the design prototype: J/K move, G group-by,
 *    A archived, E archive (owned by the shell, which also confirms).
 *  - Selected session's group auto-expands.
 *  - Deleted-workspace rows are disabled with a label; clicks do not fire selection.
 *  - No viewport breakpoints; no device or user-agent sniffing.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Project, SessionInfo, Workspace } from "../api";
import type { GlobalSessionsState } from "../appState";
import { renderBuiltinTabIcon } from "./tabIcons";
import { NEW_SESSION_LABEL } from "./shared";
import "./SessionWorkingRuntime";
import { isKeyEventInEditableContext } from "../keyboardContext";
import { ROW_PRESS, pressTravel, readRowPress } from "../rowPress";

import { createInboxLocationResolver, type InboxLocation, type InboxLocationResolver } from "../inboxLocation";
import {
  attentionCount,
  deriveSessionInboxBoard,
  groupSessionsByProject,
  relativeTime,
  type BoardGroupKind,
  type SessionBoard,
  type SessionBoardGroup,
  type SessionBoardRow,
} from "../sessionBoard";

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

function storageKey(machineId: string, suffix: string): string {
  return `forgerie:inbox:${machineId}:${suffix}`;
}

/** Returns localStorage when available, or undefined in environments that lack it. */
function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readGroupBy(machineId: string): "state" | "project" {
  const raw = browserStorage()?.getItem(storageKey(machineId, "groupBy"));
  if (raw === "project") return "project";
  return "state";
}

function writeGroupBy(machineId: string, groupBy: "state" | "project"): void {
  browserStorage()?.setItem(storageKey(machineId, "groupBy"), groupBy);
}

const DEFAULT_COLLAPSED: ReadonlySet<string> = new Set(["open", "archived"]);

/** Where a finger went down on a row, and when. */
interface RowPressOrigin {
  readonly x: number;
  readonly y: number;
  readonly at: number;
  readonly session: SessionInfo;
  readonly pointerId: number;
  readonly row: HTMLElement;
}

function readCollapsedGroups(machineId: string): Set<string> {
  const raw = browserStorage()?.getItem(storageKey(machineId, "collapsed"));
  if (raw !== null && raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
    } catch { /* corrupt data — fall through to default */ }
  }
  return new Set(DEFAULT_COLLAPSED);
}

function writeCollapsedGroups(machineId: string, collapsed: ReadonlySet<string>): void {
  browserStorage()?.setItem(storageKey(machineId, "collapsed"), JSON.stringify([...collapsed]));
}

// ---------------------------------------------------------------------------
// Board view types
// ---------------------------------------------------------------------------

/** Which of the header's two disclosures is open. Only ever one at a time. */
type InboxMenu = "group-by" | "board" | "row";

function groupByLabel(mode: "state" | "project"): string {
  return mode === "project" ? "Project" : "State";
}

/** Location shown for a cwd that belongs to no registered project. */
function unknownLocation(cwd: string): InboxLocation {
  return {
    projectId: cwd,
    projectName: "Unknown workspace",
    projectPath: cwd,
    workspaceLabel: unknownLocationLabel(cwd),
    isMain: false,
  };
}

/**
 * Last path segment of an unregistered cwd. The full path stays available as
 * the chip's tooltip; the row itself keeps the calm one-token shape.
 */
function unknownLocationLabel(cwd: string): string {
  const segments = cwd.split(/[/\\]/u).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? cwd;
}

type InboxGroup =
  | SessionBoardGroup<SessionInfo>
  | { readonly kind: string; readonly label: string; readonly tone: string; readonly rows: readonly SessionBoardRow<SessionInfo>[] };

interface InboxPanelDerivation {
  readonly board: SessionBoard<SessionInfo>;
  readonly resolveLocation: InboxLocationResolver;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@customElement("session-inbox-panel")
export class SessionInboxPanel extends LitElement {
  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  @property({ attribute: false }) globalSessions: GlobalSessionsState | undefined;
  @property({ attribute: false }) selectedSession: SessionInfo | undefined;
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadCompletedAt: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onDeleteSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onNewSession?: () => void;
  /**
   * Opens the app-wide action palette. Rendered inside the header's overflow
   * menu, which is the only place the board keeps app-level commands.
   */
  @property({ attribute: false }) onShowActions?: () => void;
  /**
   * App refresh control, supplied by the shell in the display modes that need
   * one. Passed through rather than rebuilt, so reload behaviour stays owned
   * by the shell.
   */
  @property({ attribute: false }) refreshControl?: unknown;
  /** The panel's own pin and close, rendered beside these commands, not over them. */
  @property({ attribute: false }) panelControls?: unknown;
  /**
   * Active undo toast state. Set by the controller after a successful archive.
   * Cleared by the controller's 5-second timer, by explicit dismissal, or on
   * navigation / dispose. When `undefined`, no toast is shown.
   */
  @property({ attribute: false }) undoToast?: { readonly session: SessionInfo; readonly machineId?: string };
  /**
   * Execute the undo (restore) for the active undo toast.
   * Called when the user clicks the Undo button in the toast.
   */
  @property({ attribute: false }) onUndoArchive?: () => void;
  /**
   * Dismiss the undo toast without restoring (e.g. the user explicitly closes
   * it). The archive stands; the controller cancels the expiry timer.
   */
  @property({ attribute: false }) onDismissUndoToast?: () => void;
  /**
   * Opens the workspace management picker (manage mode). Fires when the
   * persistent 'Workspaces' entry in the inbox header is clicked.
   */
  @property({ attribute: false }) onManageWorkspaces?: () => void;
  /**
   * True while the panel is summoned as a full-width overlay over the session.
   * The overlay covers the shell's own tab strip, so the board must carry the
   * way back; docked mode has no overlay to leave and renders no such control.
   */
  @property({ type: Boolean, reflect: true }) compact = false;
  /** Dismiss the navigation overlay and return to the session underneath. */
  /**
   * Cwds confirmed to have no matching workspace after lazy loading all
   * known projects. Rows whose session.cwd is in this set render as disabled
   * with a 'workspace removed' label, identical to unknown-location rows.
   * Cleared by PiWebApp when navigation succeeds or when machine/topology refreshes.
   */
  @property({ attribute: false }) unavailableCwds: ReadonlySet<string> = new Set();

  // -------------------------------------------------------------------------
  // Internal state (persisted to localStorage)
  // -------------------------------------------------------------------------

  @state() private groupBy: "state" | "project" = "state";
  @state() private collapsedGroups = new Set<string>(DEFAULT_COLLAPSED);
  @state() private showArchived = false;
  @state() private openMenu: InboxMenu | undefined;
  @state() private rowMenuSession: SessionInfo | undefined;
  /** Deleting is the one command with no undo, so it asks twice in place. */
  @state() private rowMenuConfirmingDelete = false;

  /** Previous machine id — used to detect machine switches and reload prefs. */
  private loadedMachineId: string | undefined;
  /**
   * Sessions in rendered order across expanded groups, refreshed every render.
   * J/K walk this list so keyboard order and visual order cannot diverge.
   */
  private navigableSessions: readonly SessionInfo[] = [];
  /** Last visible group of the selected row, including the grouping mode. */
  private previousSelectedGroupKey: string | undefined;
  /** Board and resolver owned by the current Lit update and shared by lifecycle and render. */
  private updateDerivation: InboxPanelDerivation | undefined;
  /** First observed instant for Working rows whose server activity predates this browser. */
  private readonly observedWorkingSince = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.onBoardKeyDown);
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("keydown", this.onBoardKeyDown);
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  /** A click anywhere outside this board closes whichever menu is open. */
  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.openMenu = undefined;
  };

  /**
   * Board-local shortcuts from the design prototype. `E` (archive) stays with
   * the shell, which owns the confirm step and the undo toast; these three only
   * move or reshape the view, so they are safe to own here.
   */
  private readonly onBoardKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === "Escape" && this.openMenu !== undefined) {
      event.preventDefault();
      this.closeRowMenu();
      return;
    }
    if (isKeyEventInEditableContext(event)) return;
    switch (event.key.toLowerCase()) {
      case "j":
        event.preventDefault();
        this.moveSelection(1);
        return;
      case "k":
        event.preventDefault();
        this.moveSelection(-1);
        return;
      case "g":
        event.preventDefault();
        this.setGroupBy(this.groupBy === "state" ? "project" : "state");
        return;
      case "a":
        event.preventDefault();
        this.setShowArchived(!this.showArchived);
        return;
      default:
        return;
    }
  };

  /** Step the selection through the rendered rows, clamping at both ends. */
  private moveSelection(delta: number): void {
    const sessions = this.navigableSessions;
    if (sessions.length === 0) return;
    const currentIndex = sessions.findIndex((session) => session.id === this.selectedSession?.id);
    // No selection yet: J enters at the top, K at the bottom.
    const nextIndex = currentIndex === -1
      ? (delta > 0 ? 0 : sessions.length - 1)
      : Math.min(Math.max(currentIndex + delta, 0), sessions.length - 1);
    const next = sessions[nextIndex];
    if (next === undefined || next.id === this.selectedSession?.id) return;
    if (this.unavailableCwds.has(next.cwd)) return;
    this.onSelectSession?.(next);
  }

  override willUpdate(): void {
    // Re-load prefs when the machine changes.
    const machineId = this.globalSessions?.machineId;
    if (machineId !== undefined && machineId !== this.loadedMachineId) {
      this.loadedMachineId = machineId;
      this.groupBy = readGroupBy(machineId);
      this.collapsedGroups = readCollapsedGroups(machineId);
      this.showArchived = false;
      this.previousSelectedGroupKey = undefined;
      this.observedWorkingSince.clear();
    }

    // Own one derivation for this Lit update. Auto-expand and render consume
    // this same snapshot, so their view of row state and location cannot differ.
    this.updateDerivation = this.deriveForUpdate();
    this.syncWorkingStarts(this.updateDerivation?.board, Date.now());
    if (this.updateDerivation === undefined) {
      // Loading and empty renders have no keyboard-visible rows. Do not let
      // J/K reuse the prior board's navigation order during a transition.
      this.navigableSessions = [];
    }

    // Auto-expand whenever the selected row's visible destination changes.
    // This covers live state moves with the same id and state/project mode changes.
    const selectedId = this.selectedSession?.id;
    const row = this.updateDerivation?.board.rows.find((candidate) => candidate.session.id === selectedId);
    const groupKind = row === undefined
      ? undefined
      : this.groupBy === "project"
        ? row.location.projectId
        : row.state.kind;
    const selectedGroupKey = groupKind === undefined ? undefined : `${this.groupBy}:${groupKind}`;
    if (selectedGroupKey !== this.previousSelectedGroupKey) {
      this.previousSelectedGroupKey = selectedGroupKey;
      if (groupKind !== undefined && this.collapsedGroups.has(groupKind)) {
        const next = new Set(this.collapsedGroups);
        next.delete(groupKind);
        this.collapsedGroups = next;
        if (machineId !== undefined) writeCollapsedGroups(machineId, next);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Board derivation
  // -------------------------------------------------------------------------

  /** Keep one stable start per continuous stay in the Working state. */
  private syncWorkingStarts(board: SessionBoard<SessionInfo> | undefined, now: number): void {
    const workingIds = new Set<string>();
    for (const row of board?.rows ?? []) {
      if (row.state.kind !== "working") continue;
      const sessionId = row.session.id;
      workingIds.add(sessionId);
      const reported = this.globalSessions?.activities[sessionId]?.activeSince;
      if (reported !== undefined && Number.isFinite(Date.parse(reported))) {
        this.observedWorkingSince.set(sessionId, reported);
      } else if (!this.observedWorkingSince.has(sessionId)) {
        this.observedWorkingSince.set(sessionId, new Date(now).toISOString());
      }
    }
    for (const sessionId of this.observedWorkingSince.keys()) {
      if (!workingIds.has(sessionId)) this.observedWorkingSince.delete(sessionId);
    }
  }

  private deriveForUpdate(): InboxPanelDerivation | undefined {
    const gs = this.globalSessions;
    if (gs === undefined || gs.status === "loading" || gs.sessions.length === 0) return undefined;
    const resolveLocation = this.buildLocationResolver();
    const board = this.deriveBoard(resolveLocation);
    return board === undefined ? undefined : { board, resolveLocation };
  }

  private buildLocationResolver(): InboxLocationResolver {
    return createInboxLocationResolver(this.projects, this.workspacesByProjectId);
  }

  private deriveBoard(resolveLocation: InboxLocationResolver): SessionBoard<SessionInfo> | undefined {
    const gs = this.globalSessions;
    if (gs === undefined || gs.sessions.length === 0) return undefined;
    return deriveSessionInboxBoard<SessionInfo>({
      projection: gs,
      unreadSessionIds: this.unreadSessionIds,
      unreadCompletedAt: this.unreadCompletedAt,
      locationOf: (session) => resolveLocation(session.cwd) ?? unknownLocation(session.cwd),
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  override render() {
    const gs = this.globalSessions;

    // Loading state — skip location resolution: no rows to render yet.
    if (gs === undefined || gs.status === "loading") {
      return html`
        <div class="board-header">
          ${this.renderHeader()}
        </div>
        <div class="board-state" data-state="loading" role="status" aria-live="polite">
          Loading sessions…
        </div>
      `;
    }

    const derivation = this.updateDerivation;

    // Empty machine (no sessions at all).
    if (derivation === undefined) {
      return html`
        <div class="board-header">
          ${this.renderHeader()}
        </div>
        <div class="board-state" data-state="empty">
          <p>No sessions yet.</p>
        </div>
      `;
    }

    const { board, resolveLocation } = derivation;

    // All-clear: every non-archived row is zero and there are archived sessions.
    const attentionTotal = attentionCount(board);
    const openCount = board.counts.open;
    const workingCount = board.counts.working;
    const nonArchivedTotal = attentionTotal + openCount + workingCount;

    if (nonArchivedTotal === 0 && board.counts.archived > 0) {
      return html`
        <div class="board-header">
          ${this.renderHeader()}
        </div>
        ${gs.status === "stale" ? html`<div class="stale-notice" data-state="stale" role="status">Reconnecting…</div>` : nothing}
        <div class="board-state" data-state="all-clear">
          <p>All clear — nothing waiting for you.</p>
        </div>
        ${this.renderBoardScroll(board, resolveLocation)}
      `;
    }

    return html`
      <div class="board-header">
        ${this.renderHeader()}
      </div>
      ${gs.status === "stale" ? html`<div class="stale-notice" data-state="stale" role="status">Reconnecting…</div>` : nothing}
      ${this.renderBoardScroll(board, resolveLocation)}
    `;
  }

  /**
   * Identity, grouping, and the one action that starts work — in a single row
   * at every pane width. Grouping belongs to the title because it names how
   * the board below is arranged; as a separate chip it read as a row filter.
   * Everything secondary sits behind the overflow menu. Deliberately carries
   * no attention summary: the group headers below already report what is
   * waiting, and say which kind.
   */
  private renderHeader(): TemplateResult {
    return html`
      <div class="board-identity">
        <h2 class="board-title-row">
          <button
            class="board-title-btn"
            data-action="group-by-menu"
            aria-haspopup="menu"
            aria-expanded=${String(this.openMenu === "group-by")}
            aria-controls="inbox-group-by-menu"
            title="Change grouping"
            @click=${() => { this.toggleMenu("group-by"); }}
          >
            <span class="board-title">Inbox</span>
            <span class="board-grouping">Grouped by <span class="board-grouping-value">${groupByLabel(this.groupBy)}</span><span class="board-caret" aria-hidden="true">▾</span></span>
          </button>
        </h2>
      </div>
      <div class="board-actions">
        <button
          class="new-session-btn"
          data-action="new-session"
          title=${NEW_SESSION_LABEL}
          aria-label=${NEW_SESSION_LABEL}
          @click=${() => { this.onNewSession?.(); }}
        >+ New</button>
        ${this.refreshControl}
        <button
          class="icon-btn"
          data-action="board-menu"
          aria-haspopup="menu"
          aria-expanded=${String(this.openMenu === "board")}
          aria-controls="inbox-board-menu"
          title="More inbox commands"
          aria-label="More inbox commands"
          @click=${() => { this.toggleMenu("board"); }}
        >⋯</button>
        ${this.panelControls}
      </div>
      ${this.renderGroupByMenu()}
      ${this.renderBoardMenu()}
    `;
  }

  /**
   * A row's own commands. Archived rows can come back or go for good; every
   * other row can be put away. The workspace path is here because it is the one
   * thing a reader routinely wants out of the inbox and into a terminal.
   */
  /**
   * The commands for one row, opened under that row.
   *
   * This used to be a floating panel placed at a screen coordinate. Inside a
   * sheet that is transformed, a fixed panel is anchored to the sheet and clipped
   * by it, so the commands went missing. A drawer is part of the list: it opens
   * where it was asked for and cannot be cut off by anything.
   */
  private renderRowMenu(session: SessionInfo): TemplateResult | typeof nothing {
    if (this.openMenu !== "row" || this.rowMenuSession?.id !== session.id) return nothing;
    const archived = session.archived === true;
    return html`
      <div class="menu-panel" id="inbox-row-menu" role="menu" aria-label="Session commands">
        <div class="menu-heading" aria-hidden="true">${session.name ?? (session.firstMessage || session.id)}</div>
        ${archived
          ? html`
              <button role="menuitem" data-action="menu-restore" @click=${() => { this.runRowCommand(this.onRestoreSession); }}>Restore</button>
              ${this.rowMenuConfirmingDelete
                ? html`<button class="danger" role="menuitem" data-action="menu-delete-confirm" @click=${() => { this.runRowCommand(this.onDeleteSession); }}>Delete for good?</button>`
                : html`<button class="danger" role="menuitem" data-action="menu-delete" @click=${() => { this.rowMenuConfirmingDelete = true; }}>Delete permanently</button>`}
            `
          : html`<button role="menuitem" data-action="menu-archive" @click=${() => { this.runRowCommand(this.onArchiveSession); }}>Archive</button>`}
        <button role="menuitem" data-action="menu-copy-path" @click=${() => { void this.copyWorkspacePath(session); }}>Copy workspace path</button>
      </div>
    `;
  }

  private runRowCommand(command: ((session: SessionInfo) => void) | undefined): void {
    const session = this.rowMenuSession;
    this.closeRowMenu();
    if (session !== undefined) command?.(session);
  }

  private async copyWorkspacePath(session: SessionInfo): Promise<void> {
    this.closeRowMenu();
    try {
      await navigator.clipboard.writeText(session.cwd);
    } catch {
      // A refused clipboard is not worth an error banner; the path is on the row.
    }
  }

  private closeRowMenu(): void {
    this.openMenu = undefined;
    this.rowMenuSession = undefined;
    this.rowMenuConfirmingDelete = false;
  }

  private renderGroupByMenu(): TemplateResult | typeof nothing {
    if (this.openMenu !== "group-by") return nothing;
    const modes: readonly ("state" | "project")[] = ["state", "project"];
    return html`
      <div class="menu-panel" id="inbox-group-by-menu" role="menu" aria-label="Group sessions by">
        ${modes.map((mode) => html`
          <button
            role="menuitemradio"
            data-group-by=${mode}
            aria-checked=${String(this.groupBy === mode)}
            @click=${() => { this.chooseGroupBy(mode); }}
          >${groupByLabel(mode)}</button>
        `)}
      </div>
    `;
  }

  private renderBoardMenu(): TemplateResult | typeof nothing {
    if (this.openMenu !== "board") return nothing;
    return html`
      <div class="menu-panel" id="inbox-board-menu" role="menu" aria-label="Inbox commands">
        <button
          role="menuitem"
          data-action="manage-workspaces"
          @click=${() => { this.runMenuCommand(this.onManageWorkspaces); }}
        >Manage workspaces</button>
        ${this.onShowActions === undefined ? nothing : html`
          <button
            role="menuitem"
            data-action="show-actions"
            @click=${() => { this.runMenuCommand(this.onShowActions); }}
          >Actions</button>
        `}
      </div>
    `;
  }

  private renderBoardScroll(board: SessionBoard<SessionInfo>, resolveLocation: InboxLocationResolver): TemplateResult {
    // Compute once per render so every row in this frame shares the same timestamp.
    const now = Date.now();

    // The archive is disclosed from a pinned shelf, so it only takes list space
    // once it has been asked for.
    const groups: readonly InboxGroup[] = this.groupBy === "project"
      ? groupSessionsByProject(board, { includeArchived: this.showArchived }).groups
      : board.groups.filter((group) => group.kind !== "archived" || this.showArchived);

    const visibleGroups = groups.filter((g) => g.rows.length > 0);
    const archivedRows = board.groups.find((group) => group.kind === "archived")?.rows ?? [];
    // Keyboard J/K walks exactly what the eye can walk: expanded groups only.
    this.navigableSessions = visibleGroups
      .filter((group) => !this.collapsedGroups.has(group.kind))
      .flatMap((group) => group.rows.map((row) => row.session));

    return html`
      <div class="board-scroll" role="listbox" aria-label="Sessions">
        ${visibleGroups.map((group) => this.renderGroup(group, resolveLocation, now))}
      </div>
      ${archivedRows.length === 0 ? nothing : this.renderArchiveShelf(archivedRows.length)}
      ${this.renderUndoToast()}
    `;
  }

  /**
   * The archive's disclosure, pinned below the list rather than placed at the
   * end of it: with thousands of open sessions, "last in the list" is a place
   * no one scrolls to. Opening it reveals the group in the list itself, so the
   * archive is browsed the same way every other group is.
   */
  private renderArchiveShelf(count: number): TemplateResult {
    return html`
      <button
        class="archive-shelf"
        data-action="toggle-archived"
        data-archive-shelf
        aria-expanded=${String(this.showArchived)}
        aria-controls="group-rows-archived"
        title="Show archived sessions"
        @click=${() => { this.setShowArchived(!this.showArchived); }}
      >
        <span class="group-chevron" aria-hidden="true">▾</span>
        <span class="group-label">Archived</span>
        <span class="group-count" data-archive-count>${String(count)}</span>
      </button>
    `;
  }

  private renderUndoToast(): TemplateResult | typeof nothing {
    const toast = this.undoToast;
    if (toast === undefined) return nothing;
    const title = toast.session.name ?? (toast.session.firstMessage || toast.session.id);
    return html`
      <div class="undo-toast" role="status" aria-live="polite" data-undo-toast>
        <span class="undo-label">Archived: <em>${title}</em></span>
        <div class="undo-actions">
          <button
            class="undo-btn"
            data-action="undo-archive"
            @click=${() => { this.onUndoArchive?.(); }}
          >Undo</button>
          <button
            class="undo-dismiss"
            data-action="dismiss-undo"
            aria-label="Dismiss"
            @click=${() => { this.onDismissUndoToast?.(); }}
          >×</button>
        </div>
      </div>
    `;
  }

  private renderGroup(group: InboxGroup, resolveLocation: InboxLocationResolver, now: number): TemplateResult {
    const kind = group.kind;
    // The archive has one control, the shelf; it is never also collapsed.
    const collapsed = kind === "archived" ? false : this.collapsedGroups.has(kind);
    const tone = this.groupBy === "project"
      ? "var(--pi-muted)"
      : `var(--tone-${kind}, var(--pi-muted))`;

    return html`
      <section
        class="group"
        data-group=${kind}
        aria-expanded=${String(!collapsed)}
      >
        <button
          class="group-header"
          style="--group-tone: ${tone}"
          aria-expanded=${String(!collapsed)}
          aria-controls="group-rows-${kind}"
          @click=${() => { this.toggleGroup(kind); }}
        >
          <span class="group-chevron" aria-hidden="true">▾</span>
          <span class="group-label">${group.label}</span>
          <span class="group-count" data-group-count>${String(group.rows.length)}</span>
          <span class="group-spacer"></span>
        </button>
        <div
          id="group-rows-${kind}"
          class="group-rows"
          role="group"
          aria-label=${group.label}
          ?hidden=${collapsed}
        >
          ${collapsed ? nothing : group.rows.map((row) => this.renderRow(row, resolveLocation, now))}
        </div>
      </section>
    `;
  }

  /**
   * What this session has working right now, as counts rather than words:
   * delegated agents and managed processes. Both are omitted when zero, so a
   * resting row shows nothing and the inbox stays quiet.
   */
  private renderLiveWork(sessionId: string): TemplateResult | typeof nothing {
    const status = this.globalSessions?.statuses[sessionId];
    const agents = status?.workingAgents ?? 0;
    const processes = status?.runningProcesses ?? 0;
    if (agents === 0 && processes === 0) return nothing;
    const parts: TemplateResult[] = [];
    if (agents > 0) {
      parts.push(html`<span class="live-work-item" title=${`${String(agents)} ${agents === 1 ? "agent" : "agents"} working`}>
        ${renderBuiltinTabIcon("agents")}${String(agents)}
      </span>`);
    }
    if (processes > 0) {
      parts.push(html`<span class="live-work-item" title=${`${String(processes)} ${processes === 1 ? "process" : "processes"} running`}>
        ${renderBuiltinTabIcon("terminal")}${String(processes)}
      </span>`);
    }
    return html`<span class="live-work" data-live-work>${parts}</span>`;
  }

  private renderRow(
    row: SessionBoardRow<SessionInfo>,
    resolveLocation: InboxLocationResolver,
    now: number,
  ): TemplateResult {
    const session = row.session;
    const kind: BoardGroupKind = row.state.kind;
    const isSelected = session.id === this.selectedSession?.id;
    const location = resolveLocation(session.cwd);
    // An uncached workspace is still resolvable on demand. Only disable the
    // row after navigation has exhausted every project and confirmed removal.
    const isDeleted = this.unavailableCwds.has(session.cwd);

    // State detail label.
    let detail: string | undefined;
    if (row.state.kind === "blocked") detail = row.state.question;
    else if (row.state.kind === "errored") detail = row.state.detail;
    else if (row.state.kind === "working") detail = row.state.detail;

    const handleRowClick = () => {
      if (isDeleted) return;
      // A hold ends with a click. The row opens on a tap, so a press that asked
      // for the commands must not also open the session.
      if (this.pressConsumedClick) {
        this.pressConsumedClick = false;
        return;
      }
      this.onSelectSession?.(session);
    };

    const handleArchive = (event: Event) => {
      event.stopPropagation();
      this.onArchiveSession?.(session);
    };

    const handleRestore = (event: Event) => {
      event.stopPropagation();
      this.onRestoreSession?.(session);
    };

    return html`
      <div class="row-slot">
      <div
        class="row"
        role="option"
        tabindex=${isDeleted ? "-1" : "0"}
        @pointerdown=${isDeleted ? nothing : (e: PointerEvent) => { this.onRowPointerDown(e, session); }}
        @pointermove=${isDeleted ? nothing : (e: PointerEvent) => { this.onRowPointerMove(e); }}
        @pointerup=${isDeleted ? nothing : (e: PointerEvent) => { this.onRowPointerUp(e); }}
        @pointercancel=${isDeleted ? nothing : () => { this.cancelRowPress(); }}
        @contextmenu=${isDeleted ? nothing : (e: MouseEvent) => { this.onRowContextMenu(e, session); }}
        data-session=${session.id}
        data-state=${kind}
        style="--row-tone: var(--tone-${kind}, var(--pi-dim))"
        aria-selected=${String(isSelected)}
        aria-disabled=${isDeleted ? "true" : "false"}
        @click=${handleRowClick}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
          }
        }}
      >
        <span class="row-marker" aria-hidden="true"></span>
        <div class="row-title">${session.name ?? (session.firstMessage || session.id)}</div>
        <div class="row-meta">
          ${isDeleted
            ? html`<span class="chip chip-deleted" data-location-chip>workspace removed</span>`
            : location !== undefined
              ? html`
                  <span class="chip" data-location-chip>
                    ${location.projectName}${!location.isMain ? html` · <span class="chip-branch">${location.workspaceLabel}</span>` : nothing}
                  </span>
                `
              : html`<span class="chip" data-location-chip title=${session.cwd}>${unknownLocationLabel(session.cwd)}</span>`}
          ${detail !== undefined ? html`<span class="row-detail">${detail}</span>` : nothing}
          ${this.renderLiveWork(session.id)}
        </div>
        <span class="row-time">
          ${kind === "working"
            ? html`<session-working-runtime .startedAt=${this.observedWorkingSince.get(session.id) ?? new Date(now).toISOString()}></session-working-runtime>`
            : relativeTime(session.modified, now)}
        </span>
        <div class="row-actions">
          ${kind === "archived"
            ? html`<button class="row-action" data-action="restore" title="Restore" aria-label="Restore session" @click=${handleRestore}>↩</button>`
            : html`<button class="row-action" data-action="archive" title="Archive" aria-label="Archive session" @click=${handleArchive}>✓</button>`}
        </div>
      </div>
      ${this.renderRowMenu(session)}
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Press to open a row's commands
  //
  // Only a finger holds. A pointer carries its own type, so the handler reads
  // the interaction and asks nothing about the device; a mouse arrives at the
  // same commands through the context menu.
  //
  // Horizontal travel is deliberately not read here. It belongs to the shell,
  // which pulls its side panels in, so the row never gives one gesture two
  // meanings.
  // -------------------------------------------------------------------------

  private pressOrigin: RowPressOrigin | undefined;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressConsumedClick = false;

  private onRowPointerDown(event: PointerEvent, session: SessionInfo): void {
    if (event.pointerType !== "touch") return;
    const row = event.currentTarget;
    if (!(row instanceof HTMLElement)) return;

    this.cancelRowPress();
    this.pressOrigin = { x: event.clientX, y: event.clientY, at: Date.now(), session, pointerId: event.pointerId, row };
    // The hold has to land while the finger is still down, so it is a timer
    // rather than a reading taken on release.
    this.pressTimer = setTimeout(() => { this.openRowCommandsFromPress(); }, ROW_PRESS.holdMs);
  }

  private onRowPointerMove(event: PointerEvent): void {
    const origin = this.pressOrigin;
    if (origin === undefined || event.pointerType !== "touch") return;
    const travel = pressTravel(event.clientX - origin.x, event.clientY - origin.y);
    if (readRowPress(travel, Date.now() - origin.at, ROW_PRESS) === "abandoned") this.cancelRowPress();
  }

  private onRowPointerUp(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    this.cancelRowPress();
  }

  private cancelRowPress(): void {
    if (this.pressTimer !== undefined) clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
    this.pressOrigin = undefined;
  }

  private openRowCommandsFromPress(): void {
    const origin = this.pressOrigin;
    this.cancelRowPress();
    if (origin === undefined) return;
    // The release still fires a click; the row must not also open the session.
    this.pressConsumedClick = true;
    // The finger is still down. Releasing capture keeps the row from swallowing
    // the tap that dismisses or chooses from the menu.
    if (origin.row.hasPointerCapture(origin.pointerId)) origin.row.releasePointerCapture(origin.pointerId);
    this.openRowCommands(origin.session);
  }

  private onRowContextMenu(event: MouseEvent, session: SessionInfo): void {
    event.preventDefault();
    this.openRowCommands(session);
  }

  private openRowCommands(session: SessionInfo): void {
    this.rowMenuSession = session;
    this.rowMenuConfirmingDelete = false;
    this.openMenu = "row";
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private setShowArchived(showArchived: boolean): void {
    this.showArchived = showArchived;
    // Opening the shelf reveals a group far below the fold; take the reader there.
    if (showArchived) void this.scrollArchivedIntoView();
  }

  private async scrollArchivedIntoView(): Promise<void> {
    await this.updateComplete;
    const archived = this.shadowRoot?.querySelector("[data-group='archived']");
    archived?.scrollIntoView({ block: "start" });
  }

  private toggleGroup(kind: string): void {
    const next = new Set(this.collapsedGroups);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    this.collapsedGroups = next;
    const machineId = this.globalSessions?.machineId;
    if (machineId !== undefined) writeCollapsedGroups(machineId, next);
  }

  private setGroupBy(mode: "state" | "project"): void {
    this.groupBy = mode;
    const machineId = this.globalSessions?.machineId;
    if (machineId !== undefined) writeGroupBy(machineId, mode);
  }

  private chooseGroupBy(mode: "state" | "project"): void {
    this.openMenu = undefined;
    this.setGroupBy(mode);
  }

  /** Close first, then run: a command that opens a dialog must not leave a menu behind it. */
  private runMenuCommand(command: (() => void) | undefined): void {
    this.openMenu = undefined;
    command?.();
  }

  private toggleMenu(menu: InboxMenu): void {
    if (this.openMenu === menu) {
      this.openMenu = undefined;
      return;
    }
    this.openMenu = menu;
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      color: var(--pi-text);
      font: 14px system-ui, sans-serif;
      container-type: inline-size;

      /*
       * One tone per group kind, read by var(--tone-KIND) in group headers and
       * row markers. These must stay inside a selector block: a stray
       * top-level declaration is a parse error, and CSS error recovery then
       * discards the whole rule that follows it.
       */
      --tone-blocked: var(--pi-warning, #ffb000);
      --tone-errored: var(--pi-danger, #ff4f7b);
      --tone-working: var(--pi-success, #00f0d8);
      --tone-unread: var(--pi-purple, #b7a2ff);
      --tone-open: var(--pi-dim, #817a99);
      --tone-archived: var(--pi-dim, #817a99);
    }

    /*
     * Rows and headers are width:100% with padding; without this they overflow
     * their pane and clip their trailing time and actions.
     */
    *, *::before, *::after { box-sizing: border-box; }

    /* ---- header ---- */

    /*
     * One row at every pane width. Identity and grouping read as a single
     * block on the left; the actions that start or reach work sit on the
     * right. Nothing here keys off a width threshold: the title truncates and
     * the controls keep their size, so folding or rotating never re-flows the
     * toolbar into a different shape.
     */
    .board-header {
      flex: 0 0 auto;
      display: flex;
      /* A drawer takes the row below the title rather than a seat beside it. */
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--pi-border);
      background: var(--pi-surface, #101527);
    }

    .board-identity {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }

    .board-title-row {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      font: inherit;
    }

    /*
     * The whole two-line block is the grouping control, so the target is a
     * full-height row rather than the width of the word 'State'. It stops at
     * its own text: the menu below is anchored to the trigger's edge, and a
     * full-width trigger would push the menu away from the words it changes.
     */
    .board-title-btn {
      display: grid;
      justify-items: start;
      gap: 1px;
      width: fit-content;
      max-width: 100%;
      min-width: 0;
      min-height: 40px;
      margin-inline-start: -6px;
      padding: 2px 6px;
      font: inherit;
      color: inherit;
      text-align: start;
      background: none;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
    }

    .board-title-btn:hover { background: var(--pi-surface-hover, #151b31); }
    .board-title-btn:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }

    .board-title,
    .board-grouping {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .board-title {
      font-size: clamp(1rem, 0.98rem + 0.12cqi, 1.0625rem);
      font-weight: 650;
      line-height: 1.15;
      color: var(--pi-text-bright, #fff);
    }

    .board-grouping {
      font-size: clamp(0.75rem, 0.73rem + 0.1cqi, 0.8125rem);
      line-height: 1.2;
      color: var(--pi-muted, #aaa4bd);
    }

    .board-grouping-value { color: var(--pi-text, #f7f4ff); font-weight: 600; }
    .board-caret { margin-inline-start: 3px; }

    .board-actions {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .new-session-btn {
      display: inline-grid;
      place-items: center;
      min-height: 40px;
      padding: 0 12px;
      font: inherit;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-text, #f7f4ff);
      white-space: nowrap;
      background: var(--pi-surface, #101527);
      border: 1px solid var(--pi-border, #26304f);
      border-radius: 8px;
      cursor: pointer;
    }

    .new-session-btn:hover { background: var(--pi-surface-hover, #151b31); }

    /* Fixed to the viewport, like every other action menu in the shell. */
    /*
     * A drawer, not a pop-out. It opens under whatever asked for it and takes
     * its share of the panel's height, so the list moves down to make room.
     * Nothing is positioned against the screen, so nothing can be clipped by a
     * sheet that is transformed.
     */
    /*
     * The opening is the whole point. A drawer is a compartment that was always
     * there and is now pulled out, so its height grows from nothing and its
     * contents arrive with it. Without this it is a menu that appears at full
     * size in a fixed spot, which is what it was.
     */
    @keyframes drawer-open {
      from { height: 0; opacity: 0; transform: translateY(-6px); }
      to { height: auto; opacity: 1; transform: translateY(0); }
    }
    /*
     * Cut into the surface rather than laid on top of it. A border, a radius and
     * a drop shadow all say the same thing -- that this floats above the list --
     * and it does not. It is recessed instead: a darker face, and a rule at each
     * end where the list was parted to make room.
     */
    .menu-panel {
      box-sizing: border-box;
      /* Takes a whole row of the header rather than a place beside its title. */
      flex: 1 0 100%;
      width: 100%;
      /*
       * Growth has to stop at the content, not at some ceiling far above it. A
       * max-height large enough for a long menu is passed within a frame or two
       * by a short one, so the drawer appeared to open instantly. This lets the
       * keyframe interpolate to the height the content actually wants.
       */
      interpolate-size: allow-keywords;
      max-height: 60vh;
      overflow: hidden auto;
      /* Same inline inset as the header above it, so the two edges agree. */
      padding: 4px 12px;
      animation: drawer-open 180ms ease-out;
      border-block: 1px solid var(--pi-border-muted);
      background: var(--pi-surface-hover);
      box-shadow: inset 0 6px 8px -8px var(--pi-shadow), inset 0 -6px 8px -8px var(--pi-shadow);
    }

    .menu-panel button {
      display: block;
      width: 100%;
      min-height: 36px;
      padding: 6px 10px;
      font: inherit;
      color: var(--pi-text);
      text-align: start;
      white-space: nowrap;
      background: transparent;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }

    .menu-panel button:hover { background: var(--pi-surface-hover, #151b31); }
    .menu-panel button[aria-checked="true"] { color: var(--pi-text-bright, #fff); background: var(--pi-selection-bg, #1d2547); }
    .menu-panel button.danger { color: var(--pi-danger); }

    /* Which row the commands belong to, since a held finger covers the row. */
    .menu-heading {
      max-width: min(240px, calc(100vw - 32px));
      padding: 4px 10px 6px;
      border-bottom: 1px solid var(--pi-border-muted);
      margin-bottom: 4px;
      color: var(--pi-muted);
      font-size: 12px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }


    .icon-btn {
      display: inline-grid;
      place-items: center;
      min-width: 40px;
      min-height: 40px;
      padding: 0;
      font: inherit;
      font-size: 1rem;
      color: var(--pi-muted, #aaa4bd);
      background: var(--pi-surface, #101527);
      border: 1px solid var(--pi-border, #26304f);
      border-radius: 8px;
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--pi-text, #f7f4ff);
      background: var(--pi-surface-hover, #151b31);
    }

    .icon-btn svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.4;
    }

    /* ---- states ---- */

    .board-state {
      flex: 1 1 auto;
      display: grid;
      place-content: center;
      gap: 12px;
      padding: 24px;
      text-align: center;
      color: var(--pi-dim, #817a99);
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
    }

    .board-state button {
      display: inline-flex;
      align-items: center;
      justify-self: center;
      gap: 6px;
      padding: 8px 16px;
      font: inherit;
      color: var(--pi-text-bright, #fff);
      background: var(--pi-accent, #7c3cff);
      border: 1px solid var(--pi-accent-border, #5a47b0);
      border-radius: 8px;
      cursor: pointer;
    }

    .board-state button .new-session-icon {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
    }

    .stale-notice {
      flex: 0 0 auto;
      padding: 4px 12px;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-warning, #ffb000);
      background: color-mix(in srgb, var(--pi-warning, #ffb000) 10%, transparent);
      border-bottom: 1px solid var(--pi-border-muted, #1b2340);
    }

    /* ---- board scroll ---- */

    .board-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: var(--pi-border, #26304f) transparent;
    }

    /* ---- groups ---- */

    .group + .group {
      margin-top: 4px;
    }

    .group-header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 12px;
      text-align: left;
      font: inherit;
      cursor: pointer;
      background: color-mix(in srgb, var(--pi-bg, #070912) 88%, transparent);
      backdrop-filter: blur(8px);
      border: none;
      border-block: 1px solid var(--pi-border-muted, #1b2340);
      color: inherit;
    }

    .group-chevron {
      flex: 0 0 auto;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-dim, #817a99);
      transition: transform 140ms ease;
    }

    .group[aria-expanded="false"] .group-chevron {
      transform: rotate(-90deg);
    }

    .group-label {
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--group-tone, var(--pi-muted, #aaa4bd));
    }

    .group-count {
      flex: 0 0 auto;
      min-width: 1.5em;
      padding: 1px 6px;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--group-tone, var(--pi-muted, #aaa4bd));
      background: color-mix(in srgb, var(--group-tone, var(--pi-dim, #817a99)) 14%, transparent);
      border-radius: 999px;
    }

    .group-spacer { flex: 1 1 auto; }

    /*
     * The archive is a shelf, not a state you are working through: it sits
     * last, stays quiet, and does not stick to the top while scrolling past.
     */
    .archive-shelf { margin-top: 8px; }

    .archive-shelf .group-header {
      position: static;
      background: none;
      backdrop-filter: none;
    }

    .archive-shelf .group-label,
    .archive-shelf .group-count { color: var(--pi-dim, #817a99); }

    /* ---- rows ---- */

    .row-slot {
      position: relative;
    }

    .row {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: start;
      gap: 2px 10px;
      width: 100%;
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--pi-border-muted, #1b2340);
      cursor: pointer;
      transition: background 120ms ease;
      /*
       * The list keeps its vertical scroll and hands the horizontal movement to
       * the shell, which pulls its side panels in. A hold on a still finger is
       * what opens this row's commands, and holding does not scroll.
       */
      touch-action: pan-y;
      -webkit-touch-callout: none;
    }

    .row:hover { background: var(--pi-surface, #101527); }

    .row[aria-selected="true"] {
      background: var(--pi-selection-bg, #1d2547);
    }

    .row[aria-selected="true"]::before {
      content: "";
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      width: 2px;
      background: var(--pi-accent, #7c3cff);
    }

    .row[aria-disabled="true"] {
      cursor: default;
      opacity: 0.6;
    }

    .row-marker {
      grid-row: 1 / span 2;
      align-self: center;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--row-tone, transparent);
    }

    .row[data-state="open"] .row-marker,
    .row[data-state="archived"] .row-marker { background: none; }

    .row[data-state="working"] .row-marker {
      animation: pulse 1.6s ease-in-out infinite;
    }

    /* Blocked is the one state that is waiting on the person reading the row. */
    .row[data-state="blocked"] .row-marker {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone-blocked, #ffb000) 22%, transparent);
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tone-working, #00f0d8) 40%, transparent); }
      50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--tone-working, #00f0d8) 0%, transparent); }
    }

    @media (prefers-reduced-motion: reduce) {
      .row[data-state="working"] .row-marker { animation: none; }
      .group-chevron { transition: none; }
    }

    .row-title {
      grid-column: 2;
      min-width: 0;
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      color: var(--pi-text, #f7f4ff);
      line-height: 1.35;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
    }

    .row[data-state="unread"] .row-title,
    .row[data-state="blocked"] .row-title {
      font-weight: 620;
      color: var(--pi-text-bright, #fff);
    }

    .row[data-state="archived"] .row-title { color: var(--pi-muted, #aaa4bd); }

    .row-meta {
      grid-column: 2;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-dim, #817a99);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex: 0 1 auto;
      min-width: 0;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-dim, #817a99);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chip-branch { color: var(--pi-muted, #aaa4bd); }

    /* Live work sits with the location chip: icon plus count, never a word. */
    .live-work { display: inline-flex; align-items: center; gap: 8px; }
    .live-work-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--pi-muted, #aaa4bd);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .live-work-item .tab-icon { width: 13px; height: 13px; }
    .chip-deleted { color: var(--pi-danger, #ff4f7b); font-style: italic; }

    .row-detail {
      flex: 0 1 auto;
      min-width: 0;
      color: var(--pi-dim, #817a99);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row[data-state="errored"] .row-detail { color: var(--pi-danger, #ff4f7b); }

    /*
     * The right column mirrors the left's two-line rhythm: when on the title's
     * line, act on the location's line. Sharing baselines is what makes the
     * time read as part of the session rather than as a label on a button.
     */
    .row-time {
      grid-column: 3;
      grid-row: 1;
      justify-self: end;
      align-self: baseline;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      font-variant-numeric: tabular-nums;
      color: var(--pi-dim, #817a99);
      white-space: nowrap;
    }

    .row-actions {
      /*
       * A finger removes these controls rather than hiding them: it reaches a
       * row's commands by holding it, so a button on every row is a column of
       * noise. A pointer keeps them, because a pointer has hover and reveals
       * them for free. The value arrives from the root, written by
       * observeInputMode from the input in use -- not from a query about what
       * the device supports.
       *
       * Removed, not made transparent: a transparent control still answers a
       * tap, and on iOS a hover rule stays active after a tap, so a transparent
       * row would appear and then stay.
       */
      display: var(--pi-row-actions-display, flex);
      grid-column: 3;
      grid-row: 2;
      justify-self: end;
      align-self: center;
      gap: 3px;
      /* Sits with the location line without making the row taller than it. */
      margin-block-start: -4px;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .row:hover .row-actions,
    .row:focus-within .row-actions,
    .row[aria-selected="true"] .row-actions { opacity: 1; }

    /* ≥44px touch target as required by plan. */
    /*
     * The control reads as a glyph and only takes on a surface under the
     * pointer: a bordered box on every row would out-weigh the titles it sits
     * beside and draw a hard rail down the pane.
     */
    .row-action {
      position: relative;
      display: grid;
      place-items: center;
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      font: inherit;
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      line-height: 1;
      color: var(--pi-dim, #817a99);
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
    }

    /*
     * The tap target is larger than the glyph, but deliberately stops inside
     * the row: expanding past it would lose the tap to the next row anyway,
     * and expanding up would swallow the timestamp above.
     */
    .row-action::after {
      content: "";
      position: absolute;
      inset-inline: -8px;
      inset-block-start: -2px;
      inset-block-end: -8px;
    }

    .row-action:hover {
      color: var(--pi-text-bright, #fff);
      border-color: var(--pi-accent-border, #5a47b0);
      background: var(--pi-surface-hover, #151b31);
    }

    :host(:focus-visible),
    .row:focus-visible,
    .group-header:focus-visible,
    .row-action:focus-visible {
      outline: 2px solid var(--pi-accent, #7c3cff);
      outline-offset: 2px;
      border-radius: 6px;
    }

    /* ---- undo toast ---- */

    .undo-toast {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      background: var(--pi-surface, #101527);
      border-top: 1px solid var(--pi-border, #26304f);
      animation: toast-slide-up 200ms ease;
    }

    @keyframes toast-slide-up {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .undo-label {
      flex: 1 1 auto;
      min-width: 0;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-text, #f7f4ff);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .undo-label em {
      font-style: normal;
      color: var(--pi-muted, #aaa4bd);
    }

    .undo-actions {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .undo-btn {
      display: inline-grid;
      place-items: center;
      min-height: 44px;
      padding: 0 12px;
      font: inherit;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      font-weight: 600;
      color: var(--pi-accent, #7c3cff);
      background: color-mix(in srgb, var(--pi-accent, #7c3cff) 12%, transparent);
      border: 1px solid var(--pi-accent-border, #5a47b0);
      border-radius: 6px;
      cursor: pointer;
    }

    .undo-btn:hover {
      background: color-mix(in srgb, var(--pi-accent, #7c3cff) 22%, transparent);
    }

    .undo-dismiss {
      display: inline-grid;
      place-items: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      font: inherit;
      color: var(--pi-dim, #817a99);
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
    }

    .undo-dismiss:hover {
      color: var(--pi-text, #f7f4ff);
      border-color: var(--pi-border-muted, #1b2340);
    }
  `;
}
