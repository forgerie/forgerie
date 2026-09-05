/**
 * Session inbox board panel.
 *
 * Renders the machine-global session inbox derived from `globalSessions` (U4 store)
 * through the `sessionBoard.ts` pure derivation (U3). Replaces the four-section
 * project→workspace→session drill-down as the primary navigation pane content.
 *
 * Design rules (from AGENTS.md + plan):
 *  - BOARD_GROUPS order, with Open replaced by the AGE_BANDS split: the states
 *    that want something keep the top, and only the idle pile is dated. Archived
 *    stays hidden behind the inbox overflow menu so the archive is opt-in.
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
import { DEFAULT_INBOX_DENSITY, inboxRowShape, type InboxDensity } from "../inboxDensity";
import { ROW_PRESS, pressTravel, readRowPress } from "../rowPress";

import { createInboxLocationResolver, inboxLocationChip, type InboxLocation, type InboxLocationResolver } from "../inboxLocation";
import {
  DEFAULT_COLLAPSED_AGE_BANDS,
  ageBandKind,
  attentionCount,
  deriveSessionInboxBoard,
  groupIdleSessionsByAge,
  groupSessionsByProject,
  relativeTime,
  type BoardGroupKind,
  type SessionBoard,
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

/**
 * Bumped when Open became the age bands. The stored set from the old board
 * collapsed `open`, a group that no longer exists; re-reading it would leave
 * every band expanded, including the widest one.
 */
const COLLAPSED_STORAGE_SUFFIX = "collapsed-bands";

function readGroupBy(machineId: string): "state" | "project" {
  const raw = browserStorage()?.getItem(storageKey(machineId, "groupBy"));
  if (raw === "project") return "project";
  return "state";
}

function writeGroupBy(machineId: string, groupBy: "state" | "project"): void {
  browserStorage()?.setItem(storageKey(machineId, "groupBy"), groupBy);
}

const DEFAULT_COLLAPSED: ReadonlySet<string> = new Set([...DEFAULT_COLLAPSED_AGE_BANDS, "archived"]);

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
  const raw = browserStorage()?.getItem(storageKey(machineId, COLLAPSED_STORAGE_SUFFIX));
  if (raw !== null && raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
    } catch { /* corrupt data — fall through to default */ }
  }
  return new Set(DEFAULT_COLLAPSED);
}

function writeCollapsedGroups(machineId: string, collapsed: ReadonlySet<string>): void {
  browserStorage()?.setItem(storageKey(machineId, COLLAPSED_STORAGE_SUFFIX), JSON.stringify([...collapsed]));
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

/** The same pin drawing the shell's panel controls use, so "pin" reads as one concept. */
function pinGlyph(): TemplateResult {
  return html`<svg class="pin-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" /><path d="M12 15v5" /></svg>`;
}

/** The least a board group has to be for the panel to draw it. */
interface InboxGroup {
  readonly kind: string;
  readonly label: string;
  readonly rows: readonly SessionBoardRow<SessionInfo>[];
}

/**
 * The scroller's contents in order. A label is not a group: it names the run of
 * bands that follows it, so a reader does not take "Yesterday" for a peer of
 * "Blocked on you".
 */
type InboxSection =
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "group"; readonly group: InboxGroup };

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
  /**
   * How tall an ordinary row is. Owned by the app, which reads the stored
   * choice, so the panel never reaches into storage during a render.
   */
  @property({ attribute: false }) density: InboxDensity = DEFAULT_INBOX_DENSITY;
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void;
  /** Pin: the row sorts to the top of its group and archiving is refused until unpinned. */
  @property({ attribute: false }) onPinSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onUnpinSession?: (session: SessionInfo) => void;
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
  /** Trusted plugin surfaces pinned below the inbox scroller. */
  @property({ attribute: false }) inboxShelves: readonly unknown[] = [];

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
        // An idle row's visible destination is its age band, not "open".
        : row.groupKind === "open"
          ? ageBandKind(row.session.modified, Date.now())
          : row.groupKind;
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
        ${this.renderInboxShelves()}
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
        ${this.renderInboxShelves()}
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
        ${this.renderInboxShelves()}
      `;
    }

    return html`
      <div class="board-header">
        ${this.renderHeader()}
      </div>
      ${gs.status === "stale" ? html`<div class="stale-notice" data-state="stale" role="status">Reconnecting…</div>` : nothing}
      ${this.renderBoardScroll(board, resolveLocation)}
      ${this.renderInboxShelves()}
    `;
  }

  private renderInboxShelves(): TemplateResult | typeof nothing {
    if (this.inboxShelves.length === 0) return nothing;
    return html`<div class="inbox-plugin-shelves" data-inbox-plugin-shelves>${this.inboxShelves}</div>`;
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
            <span class="board-grouping"><span class="board-grouping-hidden">Grouped by </span><span class="board-grouping-value">${groupByLabel(this.groupBy)}</span><span class="board-caret" aria-hidden="true">▾</span></span>
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
          : html`
              ${session.pinned === true
                ? html`<button role="menuitem" data-action="menu-unpin" @click=${() => { this.runRowCommand(this.onUnpinSession); }}>Unpin</button>`
                : html`
                    <button role="menuitem" data-action="menu-pin" @click=${() => { this.runRowCommand(this.onPinSession); }}>Pin to top</button>
                    <button role="menuitem" data-action="menu-archive" @click=${() => { this.runRowCommand(this.onArchiveSession); }}>Archive</button>
                  `}
            `}
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
    const archivedCount = this.updateDerivation?.board.counts.archived ?? 0;
    return html`
      <div class="menu-panel" id="inbox-board-menu" role="menu" aria-label="Inbox commands">
        ${archivedCount === 0 ? nothing : html`
          <button
            role="menuitemcheckbox"
            data-action="toggle-archived"
            aria-checked=${String(this.showArchived)}
            @click=${() => { this.runMenuCommand(() => { this.setShowArchived(!this.showArchived); }); }}
          >Show archived (${String(archivedCount)})</button>
        `}
        <button
          role="menuitem"
          data-action="manage-workspaces"
          title="Manage projects and workspaces"
          @click=${() => { this.runMenuCommand(this.onManageWorkspaces); }}
        >Manage projects and workspaces</button>
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

  /**
   * The scroller's contents in order.
   *
   * In state mode the Open group is replaced in place by its age bands, under a
   * label that says the bands belong to it. Everything above Open is untouched:
   * blocked, errored, working and unread say what a session wants from you now,
   * and age cannot say that.
   */
  private inboxSections(board: SessionBoard<SessionInfo>, now: number): readonly InboxSection[] {
    if (this.groupBy === "project") {
      return groupSessionsByProject(board, { includeArchived: this.showArchived }).groups
        .filter((group) => group.rows.length > 0)
        .map((group) => ({ kind: "group", group }));
    }

    const bands = groupIdleSessionsByAge(board, now).filter((band) => band.rows.length > 0);
    const sections: InboxSection[] = [];
    for (const group of board.groups) {
      // The archive stays out of the list until the overflow command reveals it.
      if (group.kind === "archived" && !this.showArchived) continue;
      if (group.kind === "open") {
        if (bands.length === 0) continue;
        sections.push({ kind: "label", text: `Open · ${String(board.counts.open)} · by age` });
        for (const band of bands) sections.push({ kind: "group", group: band });
        continue;
      }
      if (group.rows.length === 0) continue;
      sections.push({ kind: "group", group });
    }
    return sections;
  }

  private renderBoardScroll(board: SessionBoard<SessionInfo>, resolveLocation: InboxLocationResolver): TemplateResult {
    // Compute once per render so every row in this frame shares the same timestamp.
    const now = Date.now();
    const sections = this.inboxSections(board, now);

    // Keyboard J/K walks exactly what the eye can walk: expanded groups only.
    this.navigableSessions = sections
      .filter((section) => section.kind === "group" && !this.collapsedGroups.has(section.group.kind))
      .flatMap((section) => (section.kind === "group" ? section.group.rows.map((row) => row.session) : []));

    return html`
      <div class="board-scroll" role="listbox" aria-label="Sessions">
        ${sections.map((section) => section.kind === "label"
          ? html`<div class="band-label" data-band-label>${section.text}</div>`
          : this.renderGroup(section.group, resolveLocation, now))}
      </div>
      ${this.renderUndoToast()}
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
    // The overflow command owns archive visibility, so the revealed group is not also collapsed.
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
   *
   * It is a row of its own, not a tail on the location chip: the board gives
   * it a column, and a badge that hung off the chip would start at a different
   * place on every row.
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
    return html`<span class="row-work" data-live-work>${parts}</span>`;
  }

  /**
   * Where the session is, plus the state detail on a two-line row.
   *
   * Rendered only when there is something to say. A row with nothing here
   * draws no element at all, so the board's location column closes up on it
   * and the title takes the width; an empty element would still be a grid
   * item and still cost the column its gap.
   */
  private renderLocation(
    session: SessionInfo,
    location: InboxLocation | undefined,
    isDeleted: boolean,
    detail: string | undefined,
  ): TemplateResult | typeof nothing {
    const chip = this.renderLocationChip(session, location, isDeleted);
    if (chip === nothing && detail === undefined) return nothing;
    return html`
      <div class="row-meta">
        ${chip}
        ${detail !== undefined ? html`<span class="row-detail">${detail}</span>` : nothing}
      </div>
    `;
  }

  private renderLocationChip(
    session: SessionInfo,
    location: InboxLocation | undefined,
    isDeleted: boolean,
  ): TemplateResult | typeof nothing {
    if (isDeleted) return html`<span class="chip chip-deleted" data-location-chip>workspace removed</span>`;
    if (location === undefined) {
      return html`<span class="chip" data-location-chip title=${session.cwd}>${unknownLocationLabel(session.cwd)}</span>`;
    }
    const chip = inboxLocationChip(location, this.groupBy);
    switch (chip.kind) {
      case "none":
        return nothing;
      case "branch":
        return html`<span class="chip" data-location-chip><span class="chip-branch">${chip.branch}</span></span>`;
      case "project":
        return html`
          <span class="chip" data-location-chip>
            ${chip.project}${chip.branch !== undefined ? html` · <span class="chip-branch">${chip.branch}</span>` : nothing}
          </span>
        `;
    }
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

    const handleUnpin = (event: Event) => {
      event.stopPropagation();
      this.onUnpinSession?.(session);
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
        data-shape=${inboxRowShape(this.density, detail !== undefined)}
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
        ${this.renderLocation(session, location, isDeleted, detail)}
        ${this.renderLiveWork(session.id)}
        <span class="row-mark">
          ${session.pinned === true ? html`<span class="row-pin" title="Pinned" data-pinned-marker>${pinGlyph()}</span>` : nothing}
        </span>
        <span class="row-time">
          ${kind === "working"
            ? html`<session-working-runtime .startedAt=${this.observedWorkingSince.get(session.id) ?? new Date(now).toISOString()}></session-working-runtime>`
            : relativeTime(session.modified, now)}
        </span>
        <div class="row-actions">
          ${kind === "archived"
            ? html`<button class="row-action" data-action="restore" title="Restore" aria-label="Restore session" @click=${handleRestore}>↩</button>`
            : session.pinned === true
              ? html`<button class="row-action" data-action="unpin" title="Unpin" aria-label="Unpin session" @click=${handleUnpin}>${pinGlyph()}</button>`
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
    // A touch browser raises contextmenu from its own long-press timer, racing
    // ROW_PRESS. Arriving mid-press means the finger is still down: the hold
    // asked for the commands, so its release must not also open the session.
    // A mouse never has a press in flight, so its next click stays a click.
    if (this.pressOrigin !== undefined) {
      this.cancelRowPress();
      this.pressConsumedClick = true;
    }
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
    // Revealing the archive can place its group far below the fold; take the reader there.
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
      font: var(--pi-text-md) system-ui, sans-serif;
      container-type: inline-size;

      /*
       * The rows lead with a state marker and a column gap before the title.
       * Named once so anything that wants to line up with the titles -- the
       * drawer's heading and commands -- steps past the same rail.
       */
      --row-marker-size: 7px;
      --row-title-gap: 10px;

      /*
       * The trailing slot that holds one mark: the pin at rest, the row's
       * action while the row is under a pointer. Both draw in the same place,
       * so revealing the action moves nothing. Reserved on every row, pinned
       * or not, because a slot that appeared on hover would shove the
       * timestamp sideways under the pointer.
       */
      --row-mark-size: 20px;

      /*
       * One tone per group kind, read by var(--tone-KIND) in group headers and
       * row markers. These must stay inside a selector block: a stray
       * top-level declaration is a parse error, and CSS error recovery then
       * discards the whole rule that follows it.
       */
      --tone-blocked: var(--pi-warning, #d0a04a);
      --tone-errored: var(--pi-danger, #e06c75);
      --tone-working: var(--pi-success, #56b380);
      --tone-pinned: var(--pi-accent, #6f9bd8);
      --tone-unread: var(--pi-purple, #a89ede);
      --tone-open: var(--pi-dim, #62656b);
      --tone-archived: var(--pi-dim, #62656b);

      /*
       * What the board keeps when a floor shelf opens: a group header and two
       * rows. The board is what yields space to an opening shelf, and this is
       * the point past which it stops yielding. Kept tight on purpose --
       * opening a shelf is a request to read the shelf, and the board is one
       * scroll away the whole time.
       */
      --inbox-board-floor: 96px;
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
      border-bottom: 1px solid var(--pi-border-muted);
      background: var(--pi-surface, #191a1d);
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
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .board-title-btn:hover { background: var(--pi-surface-hover, #202225); }
    .board-title-btn:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -2px; }

    .board-title,
    .board-grouping {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .board-title {
      font-size: var(--pi-text-lg);
      font-weight: 650;
      line-height: 1.15;
      color: var(--pi-text-bright, #fff);
    }

    .board-grouping {
      font-size: var(--pi-text-sm);
      line-height: 1.2;
      color: var(--pi-muted, #85888e);
    }

    .board-grouping-value { color: var(--pi-text, #e6e7e9); font-weight: 600; }
    /* The words "Grouped by" truncated on narrow sidebars; the value plus the
       caret carries the meaning visually, the prefix stays for readers. */
    .board-grouping-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
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
      font-size: var(--pi-text-sm);
      color: var(--pi-text, #e6e7e9);
      white-space: nowrap;
      background: var(--pi-surface, #191a1d);
      border: 1px solid var(--pi-border, #2a2c30);
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .new-session-btn:hover { background: var(--pi-surface-hover, #202225); }

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
      /*
       * Growth has to stop at the content, not at some ceiling far above it. A
       * max-height large enough for a long menu is passed within a frame or two
       * by a short one, so the drawer appeared to open instantly. This lets the
       * keyframe interpolate to the height the content actually wants.
       */
      interpolate-size: allow-keywords;
      max-height: 60vh;
      overflow: hidden auto;
      padding: 4px 12px;
      /* Opens under a finger that is still down; its labels are commands, not text. */
      user-select: none;
      animation: drawer-open var(--pi-motion-move) ease-out;
      /*
       * A rule at each end. The header's own border is below the drawer, not
       * above it, so it separates the drawer from the list and leaves the title
       * row touching it. The near edge is the one the drawer is drawn out of and
       * needs a line of its own.
       */
      border-block: 1px solid var(--pi-border-muted);
      background: var(--pi-surface-hover);
      box-shadow: inset 0 6px 8px -8px var(--pi-shadow);
    }

    /*
     * Flush with the panel, not inset within the header.
     *
     * The header pads its contents by 6 and 12, and the drawer is one of
     * those contents -- so it sat in the middle of that padding with air on
     * three sides and read as a box inside a box. It steps back out of that
     * padding so its own edges are the panel's edges, and its bottom edge is
     * the seam the list begins at: a drawer pulled from the header's border
     * rather than a card floating inside it.
     *
     * Only the header pads its contents. The row menu opens inside a row slot
     * that has no padding of its own, so the same escape there pushed the
     * drawer past the panel's left edge. The escape stays scoped to the
     * header.
     */
    .board-header .menu-panel {
      margin-inline: -12px;
      margin-block-end: -6px;
      width: calc(100% + 24px);
    }

    .menu-panel button {
      display: block;
      width: 100%;
      min-height: 36px;
      /* Command text sits on the same vertical line as the row titles. */
      padding: 6px 10px 6px calc(var(--row-marker-size) + var(--row-title-gap));
      font: inherit;
      color: var(--pi-text);
      text-align: start;
      white-space: nowrap;
      background: transparent;
      border: 0;
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .menu-panel button:hover { background: var(--pi-surface-hover, #202225); }
    .menu-panel button[aria-checked="true"] { color: var(--pi-text-bright, #fff); background: var(--pi-selection-bg, #1d2331); }
    .menu-panel button.danger { color: var(--pi-danger); }

    /* Which row the commands belong to, since a held finger covers the row. */
    .menu-heading {
      max-width: min(240px, calc(100vw - 32px));
      padding: 4px 10px 6px calc(var(--row-marker-size) + var(--row-title-gap));
      border-bottom: 1px solid var(--pi-border-muted);
      margin-bottom: 4px;
      color: var(--pi-muted);
      font-size: var(--pi-text-sm);
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
      color: var(--pi-muted, #85888e);
      /* Ghost: header utilities separate by hover surface, not by outline. */
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .icon-btn:hover {
      color: var(--pi-text, #e6e7e9);
      background: var(--pi-surface-hover, #202225);
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
      color: var(--pi-dim, #62656b);
      font-size: var(--pi-text-md);
    }

    .board-state button {
      display: inline-flex;
      align-items: center;
      justify-self: center;
      gap: 6px;
      padding: 8px 16px;
      font: inherit;
      color: var(--pi-text-bright, #fff);
      background: var(--pi-accent, #6699e0);
      border: 1px solid var(--pi-accent-border, #4a7cc4);
      border-radius: var(--pi-radius-control);
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
      font-size: var(--pi-text-sm);
      color: var(--pi-warning, #d0a04a);
      background: color-mix(in srgb, var(--pi-warning, #d0a04a) 10%, transparent);
      border-bottom: 1px solid var(--pi-border-muted, #202225);
    }

    /* ---- board scroll ---- */

    /*
     * Basis 0, not auto: the board asks for the space that is left rather than
     * for the height of its own list. A floor shelf that opens is then shown
     * at the height it asks for, and the board -- which already scrolls --
     * gives up the difference until it reaches its floor.
     */
    .board-scroll {
      flex: 1 1 0;
      min-height: var(--inbox-board-floor);
      overflow-y: auto;
      overscroll-behavior: contain;
      /* Scrollbar style inherits from the document root (index.html). */

      /*
       * The board is one table, not a stack of independently sized rows.
       *
       * Every row used to be its own grid, so each row sized its own columns
       * from its own content: a short timestamp pulled that row's pin right, a
       * missing live-work badge pulled its location chip right, and the eye
       * running down the list met a different edge on every line. The tracks
       * are declared once here and every row borrows them through subgrid, so
       * a column is as wide as the widest thing in the whole board and each
       * row draws its part of it in the same place.
       *
       * Six tracks: state marker, title, location, live work, mark, time. The
       * title is the flexible one, so the title is what truncates -- sizing
       * the location track with 1fr instead cut project names mid-word.
       *
       * The title is also the one with a floor. Without it the location
       * column, shared by the whole board, took its cap from every title at
       * once: a 360px pane gave 108px to a project name and 125px -- thirteen
       * characters -- to the title beside it. The title is the readout the
       * row exists for, so it is the chip that yields: the location track's
       * minimum is zero (row-meta has min-width: 0), the title's is the floor,
       * and the track algorithm hands the chip what is free after the floor,
       * up to its cap, before the title takes the rest.
       *
       * The floor is the least of three: half the pane, so the chip keeps a
       * share; 26 characters, so a wide pane does not hold a long title's
       * width hostage; and the pane less the columns' fixed cost, so a pane
       * dragged to its 180px minimum overflows nothing. The 140px is the
       * marker, gaps, mark slot, timestamp and row padding, plus room for a
       * few characters of chip -- a guess until scripts/layout-checks.mjs
       * measures it at each posture.
       *
       * The floor is what the text gets. The title's cell carries the column
       * gap as its own margin (see below), so the track is the floor plus the
       * gap; scripts/layout-checks.mjs measures the text box against the
       * floor, at every posture.
       */
      --row-title-floor: min(50cqi, 26ch, calc(100cqi - 140px));
      display: grid;
      grid-template-columns:
        auto
        minmax(calc(var(--row-title-floor) + var(--row-title-gap)), 1fr)
        auto auto auto auto;
      align-content: start;
    }

    /*
     * Each level between the board and a row passes the tracks down untouched.
     */
    .group,
    .group-rows,
    .row-slot,
    .row {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: subgrid;
    }

    /*
     * The space between columns is carried by the cells, not by the grid.
     *
     * A grid gap is paid between every pair of tracks, including a track no
     * row has anything in: a board with no live work anywhere still spent two
     * gaps on the live-work column, and one on the location column when
     * grouping made every chip go quiet. A cell's own margin costs nothing
     * when the cell is not there, so an empty column closes to zero.
     *
     * The action shares the mark's margin so it keeps drawing exactly where
     * the pin was: its insets are measured from the grid area, and the
     * margin moves them the same distance the pin's box moved.
     */
    .row > :not(.row-marker) { margin-inline-start: var(--row-title-gap); }

    /*
     * A collapsed group is hidden by its hidden attribute, and the display
     * rule above outranks the user-agent rule that would have honoured it.
     */
    .group-rows[hidden] { display: none; }

    /* Everything that is not a row takes the whole width and keeps its own layout. */
    .band-label,
    .group-header,
    .row-slot > .menu-panel {
      grid-column: 1 / -1;
    }

    /* ---- groups ---- */

    .group + .group {
      margin-top: 4px;
    }

    /*
     * The one mark that says the bands below are all Open. Without it five
     * dated headers sit at the same level as "Blocked on you" and read as five
     * more states. It is a caption, not a control: no chevron, no hit area, and
     * it does not stick -- the band header that follows it does, and two sticky
     * strips would eat the short panes twice over.
     */
    .band-label {
      margin-top: 10px;
      padding: 4px 12px 2px;
      font-size: var(--pi-text-xs);
      font-weight: 650;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--pi-dim, #62656b);
    }

    .band-label + .group {
      margin-top: 0;
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
      background: color-mix(in srgb, var(--pi-bg, #111214) 88%, transparent);
      backdrop-filter: blur(8px);
      border: none;
      border-block: 1px solid var(--pi-border-muted, #202225);
      color: inherit;
    }

    .group-chevron {
      flex: 0 0 auto;
      font-size: var(--pi-text-sm);
      color: var(--pi-dim, #62656b);
      transition: transform var(--pi-motion-fast) ease;
    }

    .group[aria-expanded="false"] .group-chevron {
      transform: rotate(-90deg);
    }

    .group-label {
      font-size: var(--pi-text-sm);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--group-tone, var(--pi-muted, #85888e));
    }

    .group-count {
      flex: 0 0 auto;
      min-width: 1.5em;
      padding: 1px 6px;
      font-size: var(--pi-text-sm);
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--group-tone, var(--pi-muted, #85888e));
      background: color-mix(in srgb, var(--group-tone, var(--pi-dim, #62656b)) 14%, transparent);
      border-radius: var(--pi-radius-pill);
    }

    .group-spacer { flex: 1 1 auto; }

    /* ---- rows ---- */

    .row-slot {
      position: relative;
    }

    /*
     * Two shapes, chosen by inboxRowShape and written to data-shape. The
     * styles never work out the combination of density and detail for
     * themselves: they select on the answer.
     *
     * One line: marker, title, location, trailing. The location takes a track
     * of its own rather than a line of its own, so nothing is dropped.
     * Two lines: the title keeps the first line and the location drops to the
     * second, where a detail joins it.
     */
    .row {
      position: relative;
      width: 100%;
      padding: 6px 12px;
      row-gap: 0;
      text-align: left;
      border-bottom: 1px solid var(--pi-border-muted, #202225);
      cursor: pointer;
      transition: background var(--pi-motion-fast) ease;
      /*
       * The list keeps its vertical scroll and hands the horizontal movement to
       * the shell, which pulls its side panels in. A hold on a still finger is
       * what opens this row's commands, and holding does not scroll.
       */
      touch-action: pan-y;
      -webkit-touch-callout: none;
      /*
       * A hold means commands here, so the browser must not also start
       * selecting the title under the finger. The callout line above quiets
       * iOS; this quiets Chromium, whose own long-press starts a selection.
       */
      user-select: none;
    }

    .row:hover { background: var(--pi-surface, #191a1d); }

    .row[aria-selected="true"] {
      background: var(--pi-selection-bg, #1d2331);
    }

    .row[aria-selected="true"]::before {
      content: "";
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      width: 2px;
      background: var(--pi-accent, #6699e0);
    }

    .row[aria-disabled="true"] {
      cursor: default;
      opacity: 0.6;
    }

    /*
     * Both shapes borrow the same six board columns. They differ in which line
     * the location sits on, never in what a column means, so a two-line row
     * and a one-line row still share every edge to the right of the title.
     */
    .row[data-shape="one-line"] { align-items: center; }

    /* The location drops under the title; the trailing columns do not move. */
    .row[data-shape="two-line"] {
      align-items: start;
      row-gap: 2px;
    }

    .row-marker {
      align-self: center;
      width: var(--row-marker-size);
      height: var(--row-marker-size);
      border-radius: 50%;
      background: var(--row-tone, transparent);
    }

    .row[data-shape="one-line"] .row-marker { grid-column: 1; grid-row: 1; }
    .row[data-shape="two-line"] .row-marker { grid-column: 1; grid-row: 1 / span 2; }

    .row[data-state="open"] .row-marker,
    .row[data-state="archived"] .row-marker { background: none; }

    .row[data-state="working"] .row-marker {
      animation: pulse 1.6s ease-in-out infinite;
    }

    /* Blocked is the one state that is waiting on the person reading the row. */
    .row[data-state="blocked"] .row-marker {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--tone-blocked, #d0a04a) 22%, transparent);
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tone-working, #56b380) 40%, transparent); }
      50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--tone-working, #56b380) 0%, transparent); }
    }

    @media (prefers-reduced-motion: reduce) {
      .row[data-state="working"] .row-marker { animation: none; }
      .group-chevron { transition: none; }
      .menu-panel { animation: none; }
      .undo-toast { animation: none; }
    }

    /*
     * One line, always. A title too long for the pane ends in an ellipsis
     * rather than pushing every row below it down the pane.
     */
    .row-title {
      grid-column: 2 / 3;
      grid-row: 1;
      min-width: 0;
      font-size: var(--pi-text-md);
      color: var(--pi-text, #e6e7e9);
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /*
     * A row with nothing beside the title on its first line -- a two-line row,
     * whose location is on the second, or a one-line row with no chip at all --
     * lends the location column to the title, so the title reads into it
     * instead of ending in an ellipsis with clear space beside it.
     */
    .row[data-shape="two-line"] .row-title,
    .row:not(:has(> .row-meta)) .row-title { grid-column: 2 / 4; }

    .row[data-state="unread"] .row-title,
    .row[data-state="blocked"] .row-title {
      font-weight: 620;
      color: var(--pi-text-bright, #fff);
    }

    /*
     * The pin sits with the time, not before the title.
     *
     * Leading it indented every pinned row's title by the width of the glyph,
     * so a group of pinned rows -- and pinned rows sort to the top, so they
     * arrive as a group -- had a ragged left edge against the rows below them.
     * The titles are what the eye runs down.
     */
    .row-mark {
      grid-row: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--row-mark-size);
    }

    /*
     * Both lines named, never a single line number. An absolutely positioned
     * grid child takes its grid area as its containing block, but an auto end
     * line resolves to the grid container's padding edge rather than to
     * start + 1. A single-line grid-column: 5 therefore gave the action a 57px
     * box running from the mark slot to the row's edge, and centring in it put
     * the glyph 19px right of the pin it replaces.
     */
    .row-mark { grid-column: 5 / 6; }
    .row-actions { grid-column: 5 / 6; }
    .row-time { grid-column: 6 / 7; }

    /*
     * The mark centres in its track in both shapes, because the action that
     * replaces it centres in the same track. Sharing the title's baseline moved
     * the resting pin 3.5px off the action that takes its place. The timestamp
     * is text and keeps the baseline.
     */
    .row-mark { align-self: center; }
    .row[data-shape="two-line"] .row-time { align-self: baseline; }

    /*
     * The pin stands down exactly when the action takes its slot, so the two
     * never draw over each other and the glyph never appears to move.
     */
    .row:hover .row-mark,
    .row:focus-within .row-mark,
    .row[aria-selected="true"] .row-mark { visibility: hidden; }

    .row-pin {
      display: inline-flex;
      color: var(--pi-accent, #4a7cc4);
    }

    .pin-glyph {
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }

    .row-action .pin-glyph { width: 13px; height: 13px; }

    .row[data-state="archived"] .row-title { color: var(--pi-muted, #85888e); }

    .row-meta {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--pi-text-sm);
      color: var(--pi-dim, #62656b);
    }

    /* Beside the title, in the board's location column. */
    .row[data-shape="one-line"] .row-meta {
      grid-column: 3 / 4;
      grid-row: 1;
      flex-wrap: nowrap;
      white-space: nowrap;
    }

    /*
     * Under the title, across the rest of the row. The second line carries a
     * whole question, so it takes every column the row has left rather than
     * wrapping to a third line inside the title's column.
     *
     * Spanning is safe here only because the span crosses the flexible title
     * track: track sizing leaves the intrinsic tracks alone for such an item,
     * so a long question cannot widen the location column -- and with it every
     * row's title -- the way it would from a span of auto tracks alone.
     */
    .row[data-shape="two-line"] .row-meta {
      grid-column: 2 / -1;
      grid-row: 2;
      flex-wrap: nowrap;
    }

    /*
     * A block, not a flex container: text-overflow acts on a block's own line
     * box and never on text inside a flex container, which is why a chip used
     * to end in a cut letter ("team-context-assistan") rather than an ellipsis.
     */
    .chip {
      display: inline-block;
      flex: 0 1 auto;
      min-width: 0;
      font-size: var(--pi-text-sm);
      color: var(--pi-dim, #62656b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /*
     * The location column belongs to the whole board, so one long name -- a
     * project plus a worktree branch, say -- would take width from every title
     * in the list, not only from its own row's. Two caps, whichever is
     * smaller: a share of the pane, so a narrow pane keeps its titles, and a
     * character count, so a wide pane does not hand a third of itself to a
     * project name. The name ellipsises inside the cap.
     *
     * One-line rows only: a two-line row keeps its location under the title,
     * where it is nobody else's column and can use the width it needs.
     */
    .row[data-shape="one-line"] .chip { max-width: min(30cqi, 22ch); }

    .chip-branch { color: var(--pi-muted, #85888e); }

    /*
     * Live work: icon plus count, never a word, in a column of its own on the
     * title's line in both shapes. Rows without it leave the column empty
     * rather than closing it up, so the counts that do exist read down the
     * board as one column.
     */
    .row-work {
      grid-column: 4 / 5;
      grid-row: 1;
      align-self: center;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .live-work-item {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--pi-muted, #85888e);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .live-work-item .tab-icon { width: 13px; height: 13px; }
    .chip-deleted { color: var(--pi-danger, #e06c75); font-style: italic; }

    .row-detail {
      flex: 0 1 auto;
      min-width: 0;
      color: var(--pi-dim, #62656b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row[data-state="errored"] .row-detail { color: var(--pi-danger, #e06c75); }

    .row-time {
      grid-row: 1;
      justify-self: end;
      font-size: var(--pi-text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--pi-dim, #62656b);
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
      /*
       * Positioned, so the controls cost the row no height at all. An
       * absolutely positioned grid child takes its grid area as its containing
       * block, so the placement below is what confines it, and the track it
       * names is never grown by it. Laying it out instead set the second row's
       * floor at the button's 28px against 14px of text, which is where the ten
       * dead pixels came from -- and only for a mouse, since a finger removes
       * the controls, so the same list changed height with the input in use.
       */
      position: absolute;
      /*
       * The mark slot is the containing block, in both shapes, so the action
       * draws exactly where the pin was rather than at the row's edge. The
       * timestamp keeps its own column and never stands down for a control.
       */
      grid-row: 1 / 2;
      inset-block: 0;
      inset-inline: 0;
      align-items: center;
      justify-content: center;
      gap: 3px;
      opacity: 0;
      transition: opacity var(--pi-motion-fast) ease;
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
    /*
     * Sized to the mark slot it sits in, not to a tap target. The pseudo below
     * carries the tap target, so the glyph can match the pin it replaces
     * without the control growing past the slot and clipping the timestamp.
     */
    .row-action {
      position: relative;
      display: grid;
      place-items: center;
      min-width: var(--row-mark-size);
      min-height: var(--row-mark-size);
      padding: 0;
      font: inherit;
      font-size: var(--pi-text-md);
      line-height: 1;
      color: var(--pi-dim, #62656b);
      background: none;
      border: 1px solid transparent;
      border-radius: var(--pi-radius-control);
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
      border-color: var(--pi-accent-border, #4a7cc4);
      background: var(--pi-surface-hover, #202225);
    }

    :host(:focus-visible),
    .row:focus-visible,
    .group-header:focus-visible,
    .row-action:focus-visible {
      outline: var(--pi-focus-ring, 2px solid var(--pi-accent));
      outline-offset: 2px;
      border-radius: var(--pi-radius-control);
    }

    /*
     * Shelves open at their content height. They shrink only once the board
     * sits on its floor, and a shelf that can be compressed is expected to
     * carry its own scroller -- a column here so it can.
     */
    .inbox-plugin-shelves {
      display: flex;
      flex-direction: column;
      flex: 0 1 auto;
      min-width: 0;
      min-height: 0;
    }

    /* ---- undo toast ---- */

    .undo-toast {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      background: var(--pi-surface, #191a1d);
      border-top: 1px solid var(--pi-border-muted, #2a2c30);
      animation: toast-slide-up var(--pi-motion-move) ease;
    }

    @keyframes toast-slide-up {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .undo-label {
      flex: 1 1 auto;
      min-width: 0;
      font-size: var(--pi-text-sm);
      color: var(--pi-text, #e6e7e9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .undo-label em {
      font-style: normal;
      color: var(--pi-muted, #85888e);
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
      font-size: var(--pi-text-sm);
      font-weight: 600;
      color: var(--pi-accent, #6699e0);
      background: color-mix(in srgb, var(--pi-accent, #6699e0) 12%, transparent);
      border: 1px solid var(--pi-accent-border, #4a7cc4);
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .undo-btn:hover {
      background: color-mix(in srgb, var(--pi-accent, #6699e0) 22%, transparent);
    }

    .undo-dismiss {
      display: inline-grid;
      place-items: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      font: inherit;
      color: var(--pi-dim, #62656b);
      background: none;
      border: 1px solid transparent;
      border-radius: var(--pi-radius-control);
      cursor: pointer;
    }

    .undo-dismiss:hover {
      color: var(--pi-text, #e6e7e9);
      border-color: var(--pi-border-muted, #202225);
    }
  `;
}
