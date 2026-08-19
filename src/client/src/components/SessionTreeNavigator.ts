import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionTreeForkResult, SessionTreeNavigateResult, SessionTreeNodeKind, SessionTreeSnapshot, SessionTreeSummaryChoice } from "../api";
import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH } from "../../../shared/apiTypes";
import { buildSessionTreeModel, initialSessionTreeSelection, nearestVisibleSessionTreeId, SESSION_TREE_DEFAULT_FILTER, SESSION_TREE_FILTER_OPTIONS, sessionTreeView, toggleSessionTreeFold, transitionSessionTreeKey, validateSessionTreeSummaryChoice, type SessionTreeFilterMode, type SessionTreeModel, type SessionTreeRow } from "../sessionTreeModel";
import { relativeTime } from "../sessionBoard";
// Side-effect import: registers <modal-surface> (a value import would be dropped
// by esbuild under vitest because nothing from the module is referenced).
import "./ModalSurface";

const EMPTY_TREE: SessionTreeSnapshot = { nodes: [], activeLeafId: null, activePathIds: [] };
const MAX_SESSION_TREE_VISUAL_DEPTH = 8;
type NavigatorOperation = "continue" | "fork";
type PendingFocus = "tree" | "custom";

export type SessionTreeKindTone = "user" | "assistant" | "tool" | "shell" | "context" | "metadata";

export interface SessionTreeKindPresentation {
  readonly label: string;
  readonly tone: SessionTreeKindTone;
  readonly bookkeeping: boolean;
}

const SESSION_TREE_KIND_PRESENTATION = {
  user: { label: "User", tone: "user", bookkeeping: false },
  assistant: { label: "Assistant", tone: "assistant", bookkeeping: false },
  "tool-result": { label: "Tool result", tone: "tool", bookkeeping: false },
  bash: { label: "Shell", tone: "shell", bookkeeping: false },
  "custom-message": { label: "Custom message", tone: "context", bookkeeping: false },
  compaction: { label: "Compaction", tone: "context", bookkeeping: false },
  "branch-summary": { label: "Branch summary", tone: "context", bookkeeping: false },
  "model-change": { label: "Model", tone: "metadata", bookkeeping: true },
  "thinking-level-change": { label: "Thinking", tone: "metadata", bookkeeping: true },
  "session-info": { label: "Session info", tone: "metadata", bookkeeping: true },
  label: { label: "Label", tone: "metadata", bookkeeping: true },
  custom: { label: "Custom", tone: "metadata", bookkeeping: true },
  other: { label: "Other", tone: "metadata", bookkeeping: true },
} as const satisfies Record<SessionTreeNodeKind, SessionTreeKindPresentation>;

@customElement("session-tree-navigator")
export class SessionTreeNavigator extends LitElement {
  @property({ attribute: false }) tree: SessionTreeSnapshot = EMPTY_TREE;
  @property({ attribute: false }) onNavigate?: (targetId: string, summaryChoice: SessionTreeSummaryChoice) => Promise<SessionTreeNavigateResult>;
  @property({ attribute: false }) onFork?: (entryId: string) => Promise<SessionTreeForkResult>;
  @property({ attribute: false }) onAbort?: () => Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private selectedId: string | undefined;
  @state() private foldedIds: ReadonlySet<string> = new Set();
  @state() private filter: SessionTreeFilterMode = SESSION_TREE_DEFAULT_FILTER;
  @state() private search = "";
  @state() private copyNotice = "";
  @state() private summarize = false;
  @state() private customInstructions = "";
  @state() private inFlightOperation: NavigatorOperation | undefined;
  @state() private summarizingInFlight = false;
  @state() private busy = false;
  @state() private aborting = false;
  @state() private error = "";
  @state() private statusMessage = "";

  private model: SessionTreeModel = buildSessionTreeModel(EMPTY_TREE);
  /**
   * The entry the reader actually means, which can be hidden by the current
   * lens. Selection is a repair of this anchor, so widening the lens returns to
   * the intended entry instead of stranding the cursor on its ancestor.
   */
  private selectionAnchorId: string | undefined;
  private pendingFocus: PendingFocus | undefined;
  private operationGeneration = 0;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("tree")) this.resetTree();
  }

  protected override updated(): void {
    const pendingFocus = this.pendingFocus;
    if (pendingFocus === undefined) return;
    this.pendingFocus = undefined;
    if (pendingFocus === "tree") this.focusSelectedTreeItem();
    else this.renderRoot.querySelector<HTMLInputElement>("#session-tree-custom-focus")?.focus();
  }

  override render(): TemplateResult {
    return html`
      <modal-surface
        .label=${"Navigate session tree"}
        .initialFocus=${this.selectedId === undefined ? ".close-button" : "[data-tree-node-id][tabindex='0']"}
        ?busy=${this.busy}
        .onClose=${() => { this.requestDismissal(); }}
        .onBusyEscape=${() => { this.requestBusyEscape(); }}
      >
        <header>
          <div>
            <span class="eyebrow">Conversation history</span>
            <h1>Navigate session tree</h1>
          </div>
          <button class="close-button" ?disabled=${this.busy} title="Close session tree" aria-label="Close session tree" @click=${() => { this.onCancel?.(); }}>×</button>
        </header>
        ${this.renderTreeStep()}
        ${this.renderFooter()}
      </modal-surface>
    `;
  }

  private renderTreeStep(): TemplateResult {
    const rows = sessionTreeView(this.model, { foldedIds: this.foldedIds, filter: this.filter, search: this.search }).rows;
    // Carets mark true branch points only: a linear history is a single-child
    // chain, and a caret on every chain link is pure chrome. Keyboard folding
    // of chain nodes still works; the column returns when a real fork exists.
    const branching = rows.some((row) => row.childIds.length > 1);
    const now = Date.now();
    const position = this.selectedId === undefined ? -1 : rows.findIndex((row) => row.node.id === this.selectedId);
    // The tree is the preview: rows that would leave the active path grey out
    // as the selection moves, so the consequence is drawn before it is chosen.
    const abandonedIds = sessionTreeAbandonedPreviewIds(this.tree, this.selectedId);
    return html`
      <div class="body tree-step">
        <div class="tree-intro">
          <p>Select the history entry where you would like to continue.</p>
          <div class="legend" aria-label="Session tree markers">
            <span><span class="marker path" aria-hidden="true"></span>Active path</span>
            <span><span class="marker leaf" aria-hidden="true"></span>Active leaf</span>
          </div>
        </div>
        <div class="tree-controls">
          <input
            class="search"
            type="search"
            placeholder="Search history…"
            aria-label="Search history entries"
            .value=${this.search}
            @input=${(event: InputEvent) => { this.handleSearchInput(event); }}
          >
          <div class="filters" role="group" aria-label="Filter history entries">
            ${SESSION_TREE_FILTER_OPTIONS.map((option) => html`
              <button
                class=${this.filter === option.mode ? "selected" : ""}
                aria-pressed=${this.filter === option.mode ? "true" : "false"}
                title=${option.description}
                @click=${() => { this.selectFilter(option.mode); }}
              >${option.label}</button>
            `)}
          </div>
          <button
            class="copy"
            ?disabled=${this.selectedId === undefined}
            title="Copy the selected entry's text"
            @click=${() => { void this.copySelectedEntry(); }}
          >Copy</button>
          ${rows.length === 0 ? null : html`
            <span class="count" title="Selected entry position in this filter">${position < 0 ? "—" : position + 1} / ${rows.length}</span>
          `}
        </div>
        ${this.copyNotice === "" ? null : html`<div class="copy-notice" role="status">${this.copyNotice}</div>`}
        ${this.statusMessage === "" ? null : html`<div class="dialog-status" role="status">${this.statusMessage}</div>`}
        ${this.error === "" ? null : html`<div class="dialog-error" role="alert">${this.error}</div>`}
        ${rows.length === 0 ? html`
          <div class="empty" role="status">${this.model.orderedIds.length === 0
            ? "This session does not contain any selectable history entries."
            : this.search.trim() === ""
              ? "No history entries match this filter."
              : "No history entries match this search."}</div>
        ` : html`
          <div class=${`tree${branching ? "" : " no-branches"}`} role="tree" aria-label="Complete session history">
            ${rows.map((row) => this.renderTreeRow(row, now, abandonedIds))}
          </div>
        `}
        ${this.summarize ? html`
          <label class="summary-focus">
            <span class="glyph" aria-hidden="true">&#8803;</span>
            <input
              id="session-tree-custom-focus"
              type="text"
              placeholder="Summary focus (optional)"
              aria-label="Summary focus (optional)"
              maxlength=${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)}
              .value=${this.customInstructions}
              ?disabled=${this.busy}
              @input=${(event: InputEvent) => { this.handleCustomInstructionsInput(event); }}
            >
          </label>
        ` : null}
      </div>
    `;
  }

  private renderTreeRow(row: SessionTreeRow, now: number, abandonedIds: ReadonlySet<string>): TemplateResult {
    const selected = row.node.id === this.selectedId;
    const folded = this.foldedIds.has(row.node.id);
    const expanded = row.childIds.length > 0 && !folded;
    // A caret marks a real branch point. A folded chain node also earns one:
    // without it the hidden rows below have no visible cause.
    const foldable = row.childIds.length > 1 || (folded && row.childIds.length > 0);
    const kindPresentation = sessionTreeKindPresentation(row.node.kind);
    const classes = [
      "tree-row",
      selected ? "selected" : "",
      row.activePath ? "active-path" : "",
      row.activeLeaf ? "active-leaf" : "",
      kindPresentation.bookkeeping ? "bookkeeping" : "",
      abandonedIds.has(row.node.id) ? "leaving" : "",
    ].filter((value) => value !== "").join(" ");
    const visualDepth = sessionTreeVisualDepth(row.branchDepth);
    return html`
      <div
        class=${classes}
        role="treeitem"
        aria-level=${String(row.depth + 1)}
        aria-selected=${selected ? "true" : "false"}
        aria-expanded=${row.childIds.length === 0 ? nothing : expanded ? "true" : "false"}
        aria-current=${row.activeLeaf ? "true" : nothing}
        tabindex=${selected ? "0" : "-1"}
        data-tree-node-id=${row.node.id}
        @click=${() => { this.selectNode(row.node.id); }}
        @keydown=${(event: KeyboardEvent) => { this.handleTreeKeyDown(event); }}
      >
        <!-- Always emitted, even with no lanes: the row grid places by source
             order, so a missing rail track would shift every later column. -->
        <span class="rails" aria-hidden="true">${this.renderRails(row, visualDepth)}</span>
        <span class=${`path-marker${row.activeLeaf ? " leaf" : row.activePath ? " path" : ""}`} aria-hidden="true"></span>
        <span
          class="disclosure"
          title=${foldable ? (expanded ? "Collapse branch" : "Expand branch") : nothing}
          aria-hidden="true"
          @click=${(event: MouseEvent) => { this.toggleNode(row.node.id, event); }}
        >${foldable ? (expanded ? "▾" : "▸") : ""}</span>
        ${this.renderKindBadge(kindPresentation)}
        <span class="entry">
          <span class="summary" dir="auto">${row.node.summary}</span>
          ${row.node.label === undefined ? null : html`<span class="label" title=${row.node.label}>${row.node.label}</span>`}
          ${row.activePath && !row.activeLeaf ? html`<span class="sr-only">Active path</span>` : null}
          ${selected && abandonedIds.size > 0 ? html`<span class="leaf-hint" aria-hidden="true">&#8629;</span><span class="sr-only">Becomes the active leaf</span>` : null}
        </span>
        ${row.node.timestamp === undefined ? html`<span class="time-spacer"></span>` : html`<time datetime=${row.node.timestamp} title=${row.node.timestamp}>${relativeTime(row.node.timestamp, now)}</time>`}
      </div>
    `;
  }

  /**
   * One lane per fork the row sits under. Ancestor lanes draw a hairline only
   * while that fork still has rows below; the row's own lane draws the elbow.
   */
  private renderRails(row: SessionTreeRow, visualDepth: number): TemplateResult[] {
    const lanes: TemplateResult[] = [];
    for (let lane = 0; lane < visualDepth; lane += 1) {
      const own = lane === visualDepth - 1 && row.connector !== "none";
      const classes = own
        ? `lane elbow${row.connector === "branch" ? " through" : ""}`
        : `lane${row.rails[lane] === true ? " line" : ""}`;
      lanes.push(html`<span class=${classes}></span>`);
    }
    return lanes;
  }

  private renderKindBadge(presentation: SessionTreeKindPresentation): TemplateResult {
    return html`<span class=${`kind kind-tone-${presentation.tone}`}>${presentation.label}</span>`;
  }

  private selectedEntryDescription(kind: SessionTreeNodeKind): string {
    return sessionTreeEntryReturnsToEditor(kind)
      ? "This message’s text will return to the prompt editor for optional editing and resubmission in this session."
      : "The prompt editor will be empty after continuing from this entry in this session.";
  }

  private forkDescription(kind: SessionTreeNodeKind): string {
    return kind === "user"
      ? "Starts a separate session file that branches before this message and returns its text as the draft for the new session. This session stays unchanged."
      : "Starts a separate session file with this entry and all history leading to it. This session stays unchanged.";
  }

  // One footer, no steps: the buttons are the decision, and their glyphs are
  // one-line pictures of the resulting topology in the tree's own rail
  // vocabulary. Enter in the tree presses the primary button.
  private renderFooter(): TemplateResult {
    const selectedNode = this.selectedId === undefined ? undefined : this.model.nodesById.get(this.selectedId);
    const actionsDisabled = this.busy || selectedNode === undefined;
    return html`
      <footer>
        <button class="cancel-action" ?disabled=${this.busy} @click=${() => { this.onCancel?.(); }}>Cancel</button>
        <span class="footer-spacer"></span>
        ${this.busy && this.summarizingInFlight ? html`
          <button class="danger" ?disabled=${this.aborting} @click=${() => { void this.abortNavigation(); }}>${this.aborting ? "Cancelling…" : "Cancel summarization"}</button>
        ` : null}
        <button
          class=${`summarize-toggle${this.summarize ? " on" : ""}`}
          ?disabled=${actionsDisabled}
          aria-pressed=${this.summarize ? "true" : "false"}
          title="Write a summary entry on the branch being left behind (when continuing here)"
          @click=${() => { this.toggleSummarize(); }}
        ><span class="glyph" aria-hidden="true">&#9482;&#8803;</span>Summarize</button>
        <button
          class="fork-action"
          ?disabled=${actionsDisabled}
          title=${selectedNode === undefined ? nothing : this.forkDescription(selectedNode.kind)}
          @click=${() => { void this.submitFork(); }}
        ><span class="glyph" aria-hidden="true">&#9634;&#8594;&#9679;</span>${this.forkActionLabel()}</button>
        <button
          class="primary continue-action"
          ?disabled=${actionsDisabled}
          title=${selectedNode === undefined ? nothing : this.selectedEntryDescription(selectedNode.kind)}
          @click=${() => { void this.submitNavigation(); }}
        ><span class="glyph" aria-hidden="true">&#9500;&#9472;&#9679;</span>${this.primaryActionLabel()}</button>
      </footer>
    `;
  }

  private resetTree(): void {
    this.operationGeneration += 1;
    this.model = buildSessionTreeModel(this.tree);
    this.filter = SESSION_TREE_DEFAULT_FILTER;
    this.search = "";
    this.copyNotice = "";
    this.selectionAnchorId = initialSessionTreeSelection(this.model);
    this.selectedId = this.visibleSelection(SESSION_TREE_DEFAULT_FILTER, this.selectionAnchorId);
    this.foldedIds = new Set();
    this.summarize = false;
    this.customInstructions = "";
    this.inFlightOperation = undefined;
    this.summarizingInFlight = false;
    this.busy = false;
    this.aborting = false;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private selectNode(id: string): void {
    if (!this.model.nodesById.has(id)) return;
    this.selectionAnchorId = id;
    this.selectedId = id;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  // Narrowing the lens must not lose the reader's place: the cursor climbs to
  // the retained entry that still contains the old selection.
  private selectFilter(filter: SessionTreeFilterMode): void {
    if (this.busy || this.filter === filter) return;
    this.filter = filter;
    this.foldedIds = new Set();
    this.selectedId = this.visibleSelection(filter, this.selectionAnchorId);
    this.error = "";
    this.statusMessage = "";
    this.copyNotice = "";
    this.pendingFocus = "tree";
  }

  private visibleSelection(filter: SessionTreeFilterMode, selectedId: string | undefined, search = this.search): string | undefined {
    const visibleIds = sessionTreeView(this.model, { foldedIds: new Set(), filter, search }).rows.map((row) => row.node.id);
    return nearestVisibleSessionTreeId(this.model, visibleIds, selectedId);
  }

  private handleSearchInput(event: InputEvent): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.search = event.currentTarget.value;
    this.foldedIds = new Set();
    this.selectedId = this.visibleSelection(this.filter, this.selectionAnchorId, this.search);
    this.error = "";
    this.statusMessage = "";
    this.copyNotice = "";
  }

  // Copy acts on the selection from the control row, like the TUI's keybinding.
  // A button per row would put back the repeated chrome the rows just shed.
  private async copySelectedEntry(): Promise<void> {
    const node = this.selectedId === undefined ? undefined : this.model.nodesById.get(this.selectedId);
    if (node === undefined) return;
    const text = node.label === undefined ? node.summary : `[${node.label}] ${node.summary}`;
    try {
      await navigator.clipboard.writeText(text);
      this.copyNotice = "Entry text copied.";
    } catch {
      this.copyNotice = "Could not copy: this browser blocked clipboard access.";
    }
  }

  private toggleNode(id: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const next = toggleSessionTreeFold(this.model, { selectedId: this.selectedId, foldedIds: this.foldedIds, filter: this.filter, search: this.search }, id);
    this.selectionAnchorId = next.selectedId;
    this.selectedId = next.selectedId;
    this.foldedIds = next.foldedIds;
    this.error = "";
    this.statusMessage = "";
    this.pendingFocus = "tree";
  }

  private handleTreeKeyDown(event: KeyboardEvent): void {
    // The modal surface owns Escape everywhere; the pure model still maps it for
    // consumers that drive a tree without the surface.
    if (event.key === "Escape") return;
    const next = transitionSessionTreeKey(this.model, { selectedId: this.selectedId, foldedIds: this.foldedIds, filter: this.filter, search: this.search }, event.key);
    if (!next.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (next.action === "confirm") {
      void this.submitNavigation();
      return;
    }
    this.selectionAnchorId = next.selectedId;
    this.selectedId = next.selectedId;
    this.foldedIds = next.foldedIds;
    this.pendingFocus = "tree";
  }

  private toggleSummarize(): void {
    if (this.busy) return;
    this.summarize = !this.summarize;
    this.error = "";
    this.statusMessage = "";
    // Turning the chip on reveals the optional focus field; put the caret there
    // so the opt-in and its refinement are one motion.
    if (this.summarize) this.pendingFocus = "custom";
  }

  // The summary mode is derived, never asked: the toggle opts in, and focus
  // text upgrades the default summary to a custom one.
  private effectiveSummaryMode(): SessionTreeSummaryChoice["mode"] {
    if (!this.summarize) return "none";
    return this.customInstructions.trim() === "" ? "default" : "custom";
  }

  private handleCustomInstructionsInput(event: InputEvent): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.customInstructions = event.currentTarget.value;
    this.error = "";
    this.statusMessage = "";
  }

  private primaryActionLabel(): string {
    if (!this.busy || this.inFlightOperation !== "continue") return "Continue from here";
    return this.summarizingInFlight ? "Summarizing…" : "Continuing…";
  }

  private forkActionLabel(): string {
    return this.busy && this.inFlightOperation === "fork" ? "Forking…" : "Fork";
  }

  private async submitNavigation(): Promise<void> {
    if (this.busy || this.selectedId === undefined) return;
    const validation = validateSessionTreeSummaryChoice(this.effectiveSummaryMode(), this.customInstructions);
    // The derived mode is never custom-with-empty-focus, so this only trips on
    // focus text past the model's length cap (the input maxlength already
    // blocks typing there).
    if (!validation.ok) {
      this.error = validation.error;
      this.statusMessage = "";
      this.pendingFocus = "custom";
      return;
    }
    const navigate = this.onNavigate;
    if (navigate === undefined) {
      this.error = "Session tree navigation is unavailable. Close and reopen /tree, then try again.";
      return;
    }

    const targetId = this.selectedId;
    const generation = ++this.operationGeneration;
    this.inFlightOperation = "continue";
    this.summarizingInFlight = validation.choice.mode !== "none";
    this.busy = true;
    this.aborting = false;
    this.error = "";
    this.statusMessage = "";
    try {
      const result = await navigate(targetId, validation.choice);
      if (generation !== this.operationGeneration) return;
      this.busy = false;
      this.aborting = false;
      if (!result.cancelled) return;
      this.statusMessage = result.aborted === true
        ? "Summarization cancelled. Your selected history entry is unchanged."
        : "Navigation cancelled. Your selected history entry is unchanged.";
      this.pendingFocus = "tree";
    } catch (error: unknown) {
      if (generation !== this.operationGeneration) return;
      this.busy = false;
      this.aborting = false;
      this.statusMessage = "";
      this.error = `Could not navigate session history: ${errorMessage(error)}`;
    }
  }

  private async submitFork(): Promise<void> {
    if (this.busy || this.selectedId === undefined) return;
    const fork = this.onFork;
    if (fork === undefined) {
      this.error = "Fork from the session tree is unavailable. Close and reopen /tree, then try again.";
      return;
    }

    const entryId = this.selectedId;
    const generation = ++this.operationGeneration;
    this.inFlightOperation = "fork";
    this.summarizingInFlight = false;
    this.busy = true;
    this.error = "";
    this.statusMessage = "";
    try {
      const result = await fork(entryId);
      if (generation !== this.operationGeneration) return;
      // On success the app closes this dialog; clear busy in case it lingers.
      this.busy = false;
      if (result.cancelled) {
        this.statusMessage = "Fork cancelled. No new session was created; your selected history entry is unchanged.";
      }
    } catch (error: unknown) {
      if (generation !== this.operationGeneration) return;
      this.busy = false;
      this.statusMessage = "";
      this.error = errorMessage(error);
    }
  }

  private async abortNavigation(): Promise<void> {
    if (!this.busy || !this.summarizingInFlight || this.aborting) return;
    const abort = this.onAbort;
    if (abort === undefined) {
      this.error = "Summarization cannot be cancelled from this client.";
      return;
    }
    const generation = this.operationGeneration;
    this.aborting = true;
    this.error = "";
    this.statusMessage = "Cancelling summarization…";
    try {
      await abort();
    } catch (error: unknown) {
      if (generation !== this.operationGeneration) return;
      this.aborting = false;
      this.statusMessage = "";
      this.error = `Could not cancel summarization: ${errorMessage(error)}`;
    }
  }

  // Escape and backdrop presses share one dismissal route through the surface:
  // with a single step, both simply cancel.
  private requestDismissal(): void {
    this.onCancel?.();
  }

  // Busy Escape contract: only an in-flight summarization can be aborted; a
  // plain navigation or fork in flight swallows Escape (pre-surface routing kept).
  private requestBusyEscape(): void {
    if (this.summarizingInFlight) void this.abortNavigation();
  }

  private focusSelectedTreeItem(): void {
    const selectedId = this.selectedId;
    if (selectedId === undefined) {
      this.renderRoot.querySelector<HTMLElement>(".close-button")?.focus();
      return;
    }
    const rows = this.renderRoot.querySelectorAll<HTMLElement>("[data-tree-node-id]");
    for (const row of rows) {
      if (row.dataset["treeNodeId"] !== selectedId) continue;
      row.focus();
      row.scrollIntoView({ block: "nearest" });
      return;
    }
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 40; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; container-type: inline-size; }
    * { box-sizing: border-box; }
    /* Centered card on the transcript's reading column: the composer's measure
       plus its gutters, so the dialog reads as part of the column instead of
       taking over a desktop viewport. The fixed height keeps the card steady
       while search and filters change the row count. Below the 760px container
       query -- the same seam where the rows stack -- it goes full-bleed. */
    modal-surface { --modal-surface-backdrop-padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); --modal-surface-width: min(calc(var(--calm-measure) + 2 * var(--calm-gutter)), 100%); --modal-surface-height: min(46rem, 100%); }
    header, footer { display: flex; align-items: center; gap: 12px; padding: max(14px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 14px max(18px, env(safe-area-inset-left)); border-bottom: 1px solid var(--pi-border-muted); }
    footer { min-height: 64px; justify-content: end; padding: 12px max(18px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border-top: 1px solid var(--pi-border-muted); border-bottom: 0; }
    header > div { min-width: 0; }
    h1, h2, p { margin: 0; }
    h1 { font-size: var(--pi-text-lg); line-height: 1.25; }
    h2 { margin-top: 2px; font-size: var(--pi-text-lg); }
    .eyebrow { display: block; color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .close-button { width: 36px; height: 36px; margin-inline-start: auto; display: grid; place-items: center; border: 0; background: transparent; color: var(--pi-muted); padding: 0; font-size: 25px; }
    .close-button:not(:disabled):hover, .close-button:not(:disabled):focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .tree-step { display: flex; flex-direction: column; gap: var(--pi-space-md); padding: 14px max(18px, env(safe-area-inset-right)) 16px max(18px, env(safe-area-inset-left)); overflow: hidden; }
    .tree-intro { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 20px; color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: var(--pi-text-sm); }
    .tree-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-sm); }
    .search { flex: 1 1 11rem; min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-bg); color: var(--pi-text); padding: 6px 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    .search::placeholder { color: var(--pi-dim, var(--pi-muted)); }
    .search:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 1px; }
    .copy { flex: none; border-color: transparent; background: transparent; color: var(--pi-muted); padding: 4px 9px; font-size: var(--pi-text-xs); font-weight: 600; }
    .copy:not(:disabled):hover { background: var(--pi-surface); color: var(--pi-text); }
    .copy-notice { color: var(--pi-muted); font-size: var(--pi-text-sm); }
    /* Lens chips are wayfinding, so they stay ghost; selection is the one fill.
       They scroll rather than wrap: a second chip row would cost more height
       than the tree can spare in a folded posture. */
    .filters { flex: 1 1 auto; display: flex; align-items: center; gap: var(--pi-space-xs); min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .filters::-webkit-scrollbar { display: none; }
    .filters button { flex: none; border-color: transparent; background: transparent; color: var(--pi-muted); padding: 4px 9px; font-size: var(--pi-text-xs); font-weight: 600; }
    .filters button:not(:disabled):hover { background: var(--pi-surface); color: var(--pi-text); }
    .filters button.selected { background: var(--pi-selection-bg); color: var(--pi-text); }
    .count { margin-inline-start: auto; color: var(--pi-dim, var(--pi-muted)); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .legend > span { display: inline-flex; align-items: center; gap: 6px; }
    .marker { width: 8px; height: 8px; border-radius: var(--pi-radius-pill); }
    .marker.path { background: var(--pi-accent); }
    .marker.leaf { border: 2px solid var(--pi-accent); background: transparent; }
    /* The tree is the one scroller: the intro and legend stay put, and rows
       clip inside the framed surface instead of sliding under the toolbar. */
    .tree { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-surface); background: var(--pi-surface); overscroll-behavior: contain; }
    .tree-row { --tree-lane: 15px; min-height: 48px; display: grid; grid-template-columns: auto 14px 18px minmax(82px, auto) minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--pi-border-muted); cursor: pointer; outline: none; content-visibility: auto; contain-intrinsic-block-size: 48px; }
    .no-branches .tree-row { grid-template-columns: auto 14px minmax(82px, auto) minmax(0, 1fr) auto; }
    /* Branch rails: hairlines, not ASCII art. An ancestor lane is drawn only
       while its fork still has rows below, so closed branches leave no trail. */
    /* Negative block margins pull the lanes across the row's own padding, so a
       rail reads as one line down the branch instead of dashes per row. */
    .rails { align-self: stretch; display: flex; margin-block: -7px; margin-inline-end: -4px; }
    .lane { position: relative; flex: none; width: var(--tree-lane); }
    .lane.line::before, .lane.elbow::before { content: ""; position: absolute; left: 50%; border-left: 1px solid var(--pi-border); }
    .lane.line::before { inset-block: 0; }
    .lane.elbow::before { top: 0; bottom: 50%; }
    .lane.elbow.through::before { bottom: 0; }
    .lane.elbow::after { content: ""; position: absolute; top: 50%; left: 50%; width: 50%; border-top: 1px solid var(--pi-border); }
    .no-branches .disclosure { display: none; }
    .tree-row:last-child { border-bottom: 0; }
    .tree-row:hover { background: var(--pi-surface-hover); }
    .tree-row.selected { background: var(--pi-selection-bg); box-shadow: inset 3px 0 var(--pi-accent); }
    .tree-row:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: -2px; }
    .tree-row.bookkeeping { min-height: 36px; contain-intrinsic-block-size: 36px; }
    .path-marker { width: 8px; height: 8px; justify-self: center; border-radius: var(--pi-radius-pill); }
    .path-marker.path { background: var(--pi-accent); }
    .path-marker.leaf { border: 2px solid var(--pi-accent); background: transparent; }
    .disclosure { width: 18px; height: 28px; display: grid; place-items: center; border-radius: var(--pi-radius-inline); color: var(--pi-muted); font-size: var(--pi-text-sm); user-select: none; }
    .disclosure:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
    /* Kind is taxonomy, not status: a quiet label, never a colored chip. The
       kind-tone-* classes stay as semantic hooks only. */
    .kind { color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: 600; white-space: nowrap; }
    .entry { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
    .summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text); }
    .bookkeeping .summary { color: var(--pi-muted); font-size: var(--pi-text-sm); }
    .label { max-width: 180px; overflow: hidden; text-overflow: ellipsis; border-radius: var(--pi-radius-inline); padding: 1px 5px; background: var(--pi-bg-overlay); color: var(--pi-muted); font-size: var(--pi-text-xs); white-space: nowrap; }
    time { color: var(--pi-dim, var(--pi-muted)); font-size: var(--pi-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: end; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    /* The consequence is drawn, not described: rows that would leave the active
       path fade while they keep their geometry, so the shape of the abandoned
       branch stays readable under the fade. */
    .tree-row.leaving { opacity: .55; }
    .tree-row.leaving:hover { opacity: .8; }
    .leaf-hint { flex: none; color: var(--pi-accent); font-weight: 700; }
    /* Topology glyphs: one-line pictures of the outcome in the tree's own rail
       vocabulary. Mono metrics keep the rails aligned across buttons. */
    .glyph { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--pi-text-xs); letter-spacing: .08em; margin-inline-end: 7px; }
    .summarize-toggle.on { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .summary-focus { flex: none; display: flex; align-items: center; gap: 8px; }
    .summary-focus .glyph { margin-inline-end: 0; color: var(--pi-muted); }
    .summary-focus input { flex: 1; min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-bg); color: var(--pi-text); padding: 6px 9px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    .summary-focus input::placeholder { color: var(--pi-dim, var(--pi-muted)); }
    .summary-focus input:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 1px; }
    .dialog-error, .dialog-status, .empty { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-surface); padding: 12px 14px; }
    .dialog-error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); }
    .dialog-status { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
    .empty { color: var(--pi-muted); background: var(--pi-surface); }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control); background: var(--pi-surface); color: var(--pi-text); padding: 8px 11px; font: inherit; cursor: pointer; }
    button:not(:disabled):hover { background: var(--pi-surface-hover); }
    button:focus-visible { outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 1px; }
    button:disabled { opacity: .52; cursor: not-allowed; }
    button.primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-bg); font-weight: 700; }
    button.primary:not(:disabled):hover { filter: brightness(1.08); }
    button.danger { color: var(--pi-danger); }
    .footer-spacer { flex: 1; }

    @container (max-width: 760px) {
      modal-surface { --modal-surface-backdrop-padding: 0; --modal-surface-width: 100%; --modal-surface-height: 100dvh; --modal-surface-max-height: 100dvh; --modal-surface-border: 0; --modal-surface-radius: 0; --modal-surface-shadow: none; }
      header { padding-top: max(12px, env(safe-area-inset-top)); }
      .tree-step { padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right)); }
      .tree-intro, .tree-controls { padding-inline: 4px; }
      /* The instruction is first-run guidance; the title and footer already say
         what this dialog does. Height goes to the tree instead. */
      .tree-intro p { display: none; }
      .tree-row { --tree-lane: 11px; grid-template-columns: auto 14px 18px minmax(0, 1fr) auto; row-gap: 2px; padding-inline: 7px; }
      .tree-row > .rails { grid-column: 1; grid-row: 1 / -1; }
      .tree-row > .kind { grid-column: 4; grid-row: 1; }
      .tree-row > time, .tree-row > .time-spacer { grid-column: 5; grid-row: 1; }
      .tree-row > .entry { grid-column: 4 / -1; grid-row: 2; display: grid; gap: 3px; }
      .no-branches .tree-row { grid-template-columns: auto 14px minmax(0, 1fr) auto; }
      .no-branches .tree-row > .kind { grid-column: 3; }
      .no-branches .tree-row > time, .no-branches .tree-row > .time-spacer { grid-column: 4; }
      .no-branches .tree-row > .entry { grid-column: 3 / -1; }
      .tree-row .summary { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      footer { flex-wrap: wrap; }
    }
  `;
}

export function sessionTreeVisualDepth(depth: number): number {
  return Math.min(Math.max(0, depth), MAX_SESSION_TREE_VISUAL_DEPTH);
}

export function sessionTreeEntryReturnsToEditor(kind: SessionTreeNodeKind): boolean {
  return kind === "user" || kind === "custom-message";
}

export function sessionTreeKindPresentation(kind: SessionTreeNodeKind): SessionTreeKindPresentation {
  return SESSION_TREE_KIND_PRESENTATION[kind];
}

/**
 * The rows that would leave the active path if the selection became the active
 * leaf: everything on today's active path that is not an ancestor of (or) the
 * selection. Pure, so the live preview is directly testable.
 */
export function sessionTreeAbandonedPreviewIds(tree: SessionTreeSnapshot, selectedId: string | undefined): ReadonlySet<string> {
  if (selectedId === undefined) return new Set();
  const parentById = new Map<string, string | null>();
  for (const node of tree.nodes) parentById.set(node.id, node.parentId);
  if (!parentById.has(selectedId)) return new Set();
  const kept = new Set<string>();
  let cursor: string | null = selectedId;
  while (cursor !== null && !kept.has(cursor)) {
    kept.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  const abandoned = new Set<string>();
  for (const id of tree.activePathIds) {
    if (!kept.has(id)) abandoned.add(id);
  }
  return abandoned;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
