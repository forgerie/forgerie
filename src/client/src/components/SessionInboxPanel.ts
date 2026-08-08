/**
 * Session inbox board panel.
 *
 * Renders the machine-global session inbox derived from `globalSessions` (U4 store)
 * through the `sessionBoard.ts` pure derivation (U3). Replaces the four-section
 * project→workspace→session drill-down as the primary navigation pane content.
 *
 * Design rules (from AGENTS.md + plan):
 *  - Six groups in BOARD_GROUPS order; Open and Archived collapsed by default.
 *  - Archive action ≥44px hit area via min-height.
 *  - Theme tokens only; pane-level container query so rows respond to pane width.
 *  - Group-by and collapsed-groups persisted per machine in localStorage (non-sensitive).
 *  - Selected session's group auto-expands.
 *  - Deleted-workspace rows are disabled with a label; clicks do not fire selection.
 *  - No viewport breakpoints; no device or user-agent sniffing.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Project, SessionActivity, SessionInfo, Workspace } from "../api";
import type { GlobalSessionsState } from "../appState";
import {
  attentionCount,
  deriveSessionBoard,
  groupSessionsByProject,
  relativeTime,
  type BoardGroupKind,
  type SessionBoard,
  type SessionBoardGroup,
  type SessionBoardLocation,
  type SessionBoardRow,
} from "../sessionBoard";

// ---------------------------------------------------------------------------
// Internal location type (extends the board's structural location)
// ---------------------------------------------------------------------------

interface InboxLocation extends SessionBoardLocation {
  readonly workspaceLabel: string;
  readonly isMain: boolean;
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

function storageKey(machineId: string, suffix: string): string {
  return `forgerie:inbox:${machineId}:${suffix}`;
}

function readGroupBy(machineId: string): "state" | "project" {
  try {
    const raw = localStorage.getItem(storageKey(machineId, "groupBy"));
    if (raw === "project") return "project";
  } catch {
    // localStorage unavailable (e.g., privacy mode).
  }
  return "state";
}

function writeGroupBy(machineId: string, groupBy: "state" | "project"): void {
  try {
    localStorage.setItem(storageKey(machineId, "groupBy"), groupBy);
  } catch {
    // Ignore.
  }
}

const DEFAULT_COLLAPSED: ReadonlySet<string> = new Set(["open", "archived"]);

function readCollapsedGroups(machineId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(machineId, "collapsed"));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === "string"));
    }
  } catch {
    // Ignore.
  }
  return new Set(DEFAULT_COLLAPSED);
}

function writeCollapsedGroups(machineId: string, collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(storageKey(machineId, "collapsed"), JSON.stringify([...collapsed]));
  } catch {
    // Ignore.
  }
}

// ---------------------------------------------------------------------------
// Board view types
// ---------------------------------------------------------------------------

type InboxGroup =
  | SessionBoardGroup<SessionInfo>
  | { readonly kind: string; readonly label: string; readonly tone: string; readonly rows: readonly SessionBoardRow<SessionInfo>[] };

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
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadCompletedAt: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) projects: Project[] = [];
  @property({ attribute: false }) workspacesByProjectId: Record<string, Workspace[]> = {};
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onNewSession?: () => void;
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

  /** Previous machine id — used to detect machine switches and reload prefs. */
  private loadedMachineId: string | undefined;
  /** Previous selected session id — used to detect selection moves to trigger auto-expand. */
  private prevSelectedId: string | undefined;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override updated(): void {
    // Re-load prefs when the machine changes.
    const machineId = this.globalSessions?.machineId;
    if (machineId !== undefined && machineId !== this.loadedMachineId) {
      this.loadedMachineId = machineId;
      this.groupBy = readGroupBy(machineId);
      this.collapsedGroups = readCollapsedGroups(machineId);
    }

    // Auto-expand the group containing the selected session.
    const selectedId = this.selectedSession?.id;
    if (selectedId !== undefined && selectedId !== this.prevSelectedId) {
      this.prevSelectedId = selectedId;
      const board = this.deriveBoard();
      if (board !== undefined) {
        const row = board.rows.find((r) => r.session.id === selectedId);
        if (row !== undefined && this.collapsedGroups.has(row.state.kind)) {
          const next = new Set(this.collapsedGroups);
          next.delete(row.state.kind);
          this.collapsedGroups = next;
          if (machineId !== undefined) writeCollapsedGroups(machineId, next);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Board derivation
  // -------------------------------------------------------------------------

  private buildLocationMap(): Map<string, InboxLocation> {
    const map = new Map<string, InboxLocation>();
    for (const project of this.projects) {
      const workspaces = this.workspacesByProjectId[project.id] ?? [];
      for (const ws of workspaces) {
        map.set(ws.path, {
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          workspaceLabel: ws.label,
          isMain: ws.isMain,
        });
      }
    }
    return map;
  }

  private deriveBoard(): SessionBoard<SessionInfo> | undefined {
    const gs = this.globalSessions;
    if (gs === undefined || gs.sessions.length === 0) return undefined;

    const locationMap = this.buildLocationMap();

    return deriveSessionBoard<SessionInfo>({
      sessions: gs.sessions,
      statuses: gs.statuses,
      activities: this.sessionActivities,
      unreadSessionIds: this.unreadSessionIds,
      unreadCompletedAt: this.unreadCompletedAt,
      locationOf: (session) => {
        const loc = locationMap.get(session.cwd);
        return loc ?? {
          projectId: session.cwd,
          projectName: "Unknown workspace",
          projectPath: session.cwd,
          workspaceLabel: session.cwd,
          isMain: false,
        };
      },
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  override render() {
    const gs = this.globalSessions;

    // Loading state.
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

    const board = this.deriveBoard();

    // Empty machine (no sessions at all).
    if (board === undefined) {
      return html`
        <div class="board-header">
          ${this.renderHeader()}
        </div>
        <div class="board-state" data-state="empty">
          <p>No sessions yet.</p>
          ${this.onNewSession !== undefined ? html`
            <button data-action="new-session" @click=${() => { this.onNewSession?.(); }}>
              Start a session
            </button>
          ` : nothing}
        </div>
      `;
    }

    // All-clear: every non-archived row is zero and there are archived sessions.
    const attentionTotal = attentionCount(board);
    const openCount = board.counts.open;
    const workingCount = board.counts.working;
    const nonArchivedTotal = attentionTotal + openCount + workingCount;

    if (nonArchivedTotal === 0 && board.counts.archived > 0) {
      return html`
        <div class="board-header">
          ${this.renderHeader(board)}
        </div>
        ${gs.status === "stale" ? html`<div class="stale-notice" data-state="stale" role="status">Reconnecting…</div>` : nothing}
        <div class="board-state" data-state="all-clear">
          <p>All clear — nothing waiting for you.</p>
        </div>
        ${this.renderBoardScroll(board)}
      `;
    }

    return html`
      <div class="board-header">
        ${this.renderHeader(board)}
      </div>
      ${gs.status === "stale" ? html`<div class="stale-notice" data-state="stale" role="status">Reconnecting…</div>` : nothing}
      ${this.renderBoardScroll(board)}
    `;
  }

  private renderHeader(board?: SessionBoard<SessionInfo>): TemplateResult {
    const attention = board !== undefined ? attentionCount(board) : 0;
    const summaryText = attention > 0
      ? html`<strong>${attention}</strong> waiting`
      : board !== undefined && board.counts.working > 0
        ? html`nothing waiting`
        : html``;

    return html`
      <div class="board-title-row">
        <h2 class="board-title">Inbox</h2>
        <span class="board-summary" id="board-summary">${summaryText}</span>
      </div>
      <div class="board-controls">
        <div class="segmented" role="group" aria-label="Group by">
          <button
            data-group-by="state"
            aria-pressed=${String(this.groupBy === "state")}
            @click=${() => { this.setGroupBy("state"); }}
          >State</button>
          <button
            data-group-by="project"
            aria-pressed=${String(this.groupBy === "project")}
            @click=${() => { this.setGroupBy("project"); }}
          >Project</button>
        </div>
        <button
          class="new-session-btn"
          data-action="new-session"
          title="Start a new session"
          aria-label="Start a new session"
          @click=${() => { this.onNewSession?.(); }}
        >+</button>
      </div>
    `;
  }

  private renderBoardScroll(board: SessionBoard<SessionInfo>): TemplateResult {
    const locationMap = this.buildLocationMap();

    const stateGroups: readonly SessionBoardGroup<SessionInfo>[] = board.groups;
    const projectGroups: readonly { kind: string; label: string; tone: string; rows: readonly SessionBoardRow<SessionInfo>[] }[] =
      groupSessionsByProject(board, { includeArchived: true }).groups;
    const groups: readonly InboxGroup[] = this.groupBy === "project" ? projectGroups : stateGroups;

    const visibleGroups = groups.filter((g) => g.rows.length > 0);

    return html`
      <div class="board-scroll" role="listbox" aria-label="Sessions">
        ${visibleGroups.map((group) => this.renderGroup(group, locationMap))}
      </div>
    `;
  }

  private renderGroup(group: InboxGroup, locationMap: Map<string, InboxLocation>): TemplateResult {
    const kind = group.kind;
    const collapsed = this.collapsedGroups.has(kind);
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
          ${collapsed ? nothing : group.rows.map((row) => this.renderRow(row, locationMap))}
        </div>
      </section>
    `;
  }

  private renderRow(
    row: SessionBoardRow<SessionInfo>,
    locationMap: Map<string, InboxLocation>,
  ): TemplateResult {
    const session = row.session;
    const kind: BoardGroupKind = row.state.kind;
    const isSelected = session.id === this.selectedSession?.id;
    const location = locationMap.get(session.cwd);
    // An uncached workspace is still resolvable on demand. Only disable the
    // row after navigation has exhausted every project and confirmed removal.
    const isDeleted = this.unavailableCwds.has(session.cwd);
    const now = Date.now();

    // State detail label.
    let detail: string | undefined;
    if (row.state.kind === "blocked") detail = row.state.question;
    else if (row.state.kind === "errored") detail = row.state.detail;
    else if (row.state.kind === "working") detail = row.state.detail;

    const handleRowClick = () => {
      if (isDeleted) return;
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
      <div
        class="row"
        role="option"
        tabindex=${isDeleted ? "-1" : "0"}
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
              : html`<span class="chip" data-location-chip>${session.cwd}</span>`}
          ${detail !== undefined ? html`<span class="row-detail">${detail}</span>` : nothing}
        </div>
        <div class="row-aside">
          <span class="row-time">${relativeTime(session.modified, now)}</span>
          <div class="row-actions">
            ${kind === "archived"
              ? html`<button class="row-action" data-action="restore" title="Restore" aria-label="Restore session" @click=${handleRestore}>↩</button>`
              : html`<button class="row-action" data-action="archive" title="Archive" aria-label="Archive session" @click=${handleArchive}>✓</button>`}
          </div>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

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
    }

    /* ---- header ---- */

    .board-header {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid var(--pi-border);
      background: var(--pi-surface, #101527);
    }

    .board-title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .board-title {
      margin: 0;
      font-size: clamp(1rem, 0.98rem + 0.12cqi, 1.0625rem);
      font-weight: 650;
      color: var(--pi-text-bright, #fff);
    }

    .board-summary {
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-muted, #aaa4bd);
    }

    .board-summary strong {
      color: var(--pi-purple, #b7a2ff);
      font-weight: 600;
    }

    .board-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .segmented {
      display: inline-flex;
      padding: 2px;
      gap: 2px;
      background: var(--pi-bg, #070912);
      border: 1px solid var(--pi-border, #26304f);
      border-radius: 999px;
    }

    .segmented button {
      padding: 4px 10px;
      font: inherit;
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      color: var(--pi-muted, #aaa4bd);
      background: none;
      border: none;
      border-radius: 999px;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }

    .segmented button[aria-pressed="true"] {
      background: var(--pi-selection-bg, #1d2547);
      color: var(--pi-text-bright, #fff);
    }

    .new-session-btn {
      box-sizing: border-box;
      display: inline-grid;
      place-items: center;
      min-width: 30px;
      height: 30px;
      padding: 0 9px;
      font: inherit;
      color: var(--pi-text);
      background: var(--pi-surface, #101527);
      border: 1px solid var(--pi-border, #26304f);
      border-radius: 8px;
      cursor: pointer;
      margin-left: auto;
    }

    .new-session-btn:hover {
      background: var(--pi-surface-hover, #151b31);
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
      padding: 8px 16px;
      font: inherit;
      color: var(--pi-text-bright, #fff);
      background: var(--pi-accent, #7c3cff);
      border: 1px solid var(--pi-accent-border, #5a47b0);
      border-radius: 8px;
      cursor: pointer;
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

    /* Tone variables for each group kind. */
    --tone-blocked: var(--pi-warning, #ffb000);
    --tone-errored: var(--pi-danger, #ff4f7b);
    --tone-working: var(--pi-success, #00f0d8);
    --tone-unread: var(--pi-purple, #b7a2ff);
    --tone-open: var(--pi-dim, #817a99);
    --tone-archived: var(--pi-dim, #817a99);

    /* ---- rows ---- */

    .row {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: start;
      gap: 3px 10px;
      width: 100%;
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--pi-border-muted, #1b2340);
      cursor: pointer;
      transition: background 120ms ease;
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

    .row-aside {
      grid-column: 3;
      grid-row: 1 / span 2;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
    }

    .row-time {
      font-size: clamp(0.8125rem, 0.8rem + 0.1cqi, 0.875rem);
      font-variant-numeric: tabular-nums;
      color: var(--pi-dim, #817a99);
    }

    .row-actions {
      display: flex;
      gap: 3px;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .row:hover .row-actions,
    .row:focus-within .row-actions,
    .row[aria-selected="true"] .row-actions { opacity: 1; }

    /* Touch: actions always visible (no hover). */
    @media (hover: none) {
      .row-actions { opacity: 1; }
    }

    /* ≥44px touch target as required by plan. */
    .row-action {
      display: grid;
      place-items: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0;
      font: inherit;
      font-size: clamp(0.9375rem, 0.92rem + 0.1cqi, 1rem);
      line-height: 1;
      color: var(--pi-dim, #817a99);
      background: none;
      border: 1px solid var(--pi-border-muted, #1b2340);
      border-radius: 6px;
      cursor: pointer;
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
  `;
}
