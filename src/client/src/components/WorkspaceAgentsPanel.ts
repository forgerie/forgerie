import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { deriveDelegatedRuns, type DelegatedAgent, type DelegatedRun } from "../delegatedAgents";
import type { WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles } from "./shared";

const STATE_GLYPH: Record<DelegatedAgent["state"], string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
  detached: "◇",
};

interface RunsCache {
  readonly sessionId: string | undefined;
  readonly messages: unknown;
  readonly runs: readonly DelegatedRun[];
}

/**
 * The delegated agents a session owns.
 *
 * Everything here is derived from the session's own transcript, so the panel
 * observes rather than subscribes: `state.messages` is already kept current by
 * the session socket, and a `tool.update` lands on the same `ToolExecutionPart`
 * the completed run will later occupy.
 */
@customElement("workspace-agents-panel")
export class WorkspaceAgentsPanel extends LitElement {
  static override styles = [
    workspacePanelStyles,
    css`
      :host { flex: 1 1 auto; }

      /*
       * The list frame owns the container, not the host: an element cannot
       * query a container it establishes, and rows must respond to the pane
       * they sit in rather than to the viewport.
       */
      .runs { container-type: inline-size; min-height: 0; overflow: auto; }

      .summary { padding: 8px 12px; border-bottom: 1px solid var(--pi-border-muted, var(--pi-border)); color: var(--pi-muted); font-size: 12px; }
      .notice { padding: 8px 12px; border-bottom: 1px solid var(--pi-border-muted, var(--pi-border)); color: var(--pi-muted); font-size: 12px; }

      .run {
        display: flex; align-items: center; gap: 8px;
        width: 100%; min-height: 44px;
        padding: 6px 12px; border: 0; border-bottom: 1px solid var(--pi-border-muted, var(--pi-border));
        background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
      }
      .run:hover { background: var(--pi-surface-hover, transparent); }
      .run .twisty { color: var(--pi-dim, var(--pi-muted)); width: 10px; }
      /* min-width:0 lets the id shrink instead of pushing the state off a 499px screen. */
      .run .run-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .run .run-label { color: var(--pi-muted); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .run .run-state { margin-left: auto; color: var(--pi-muted); font-size: 12px; white-space: nowrap; flex: none; }

      .agent {
        display: flex; align-items: center; gap: 8px;
        min-height: 44px;
        padding: 4px 12px 4px 26px;
        border-bottom: 1px solid var(--pi-border-muted, var(--pi-border));
        border-left: 2px solid var(--pi-border);
        margin-left: 12px;
        font-size: 12px; white-space: nowrap;
      }
      .agent .glyph { flex: 0 0 auto; width: 12px; text-align: center; }
      /*
       * The menu button keeps the row to one line: it holds its place at the
       * end and never wraps, and it is absent while an agent still works.
       */
      .agent-menu-button {
        flex: 0 0 auto;
        margin-left: auto;
        min-width: 28px; min-height: 28px;
        padding: 0 6px;
        background: none; border: none;
        color: var(--pi-dim); font-size: 13px; line-height: 1;
        cursor: pointer;
      }
      .agent-menu-button:hover { color: var(--pi-fg); }

      .agent-menu {
        display: flex; flex-direction: column;
        margin-left: 24px;
        border-left: 2px solid var(--pi-border);
        background: var(--pi-surface);
      }
      .agent-menu button {
        min-height: 44px;
        padding: 0 12px 0 26px;
        background: none; border: none;
        border-bottom: 1px solid var(--pi-border-muted, var(--pi-border));
        color: var(--pi-fg);
        font-size: 12px; text-align: left; white-space: nowrap;
        cursor: pointer;
      }
      .agent-menu button:hover { background: var(--pi-selection-bg); }
      .agent .name { flex: 0 0 auto; }
      /* Detail yields first when width is scarce; identity and action never do. */
      .agent .detail {
        flex: 1 1 auto; min-width: 0;
        overflow: hidden; text-overflow: ellipsis;
        color: var(--pi-muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .agent .agent-state { flex: 0 0 auto; color: var(--pi-muted); }
      .agent .elapsed { flex: 0 0 auto; color: var(--pi-muted); font-variant-numeric: tabular-nums; }

      .agent[data-state="failed"] .glyph { color: var(--pi-danger); }
      .agent[data-state="running"] .glyph { color: var(--pi-success); }

      /* Elapsed and the state word drop before the row can wrap. */
      @container (max-width: 380px) {
        .agent .elapsed { display: none; }
      }
      @container (max-width: 320px) {
        .agent .agent-state { display: none; }
      }
    `,
  ];

  @property({ attribute: false }) context: WorkspacePanelContext | undefined;

  /** Manual expand/collapse, layered over the defaults. Cleared per session. */
  @state() private expansionOverrides: ReadonlyMap<string, boolean> = new Map();

  /** The agent whose menu is open, as run id and index. One at a time. */
  @state() private openMenuKey: string | undefined;

  private runsCache: RunsCache | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("context")) return;
    const sessionId = this.context?.state.selectedSession?.id;
    if (this.runsCache !== undefined && this.runsCache.sessionId !== sessionId) {
      this.expansionOverrides = new Map();
    }
  }

  override render(): TemplateResult {
    const context = this.context;
    if (context === undefined) return html`<p class="muted">Delegated agents are unavailable.</p>`;
    if (context.state.selectedSession === undefined) {
      return html`<p class="muted">Select a session to see the agents it delegated.</p>`;
    }

    const runs = this.runs(context);
    const windowIsPartial = context.state.messagePageStart > 0;
    if (runs.length === 0) {
      return windowIsPartial
        ? html`<p class="muted">No delegated runs in the loaded transcript. Older messages are not loaded.</p>`
        : html`<p class="muted">This session has not delegated any agents.</p>`;
    }

    return html`
      <div class="summary">${summaryText(runs)}</div>
      ${windowIsPartial ? html`<div class="notice">Older messages are not loaded, so earlier runs may be missing.</div>` : null}
      <div class="runs">${runs.map((run) => this.renderRun(run))}</div>
    `;
  }

  private renderRun(run: DelegatedRun): TemplateResult {
    const expanded = this.isExpanded(run);
    return html`
      <button
        class="run"
        type="button"
        data-run=${run.id}
        aria-expanded=${String(expanded)}
        @click=${() => { this.toggleRun(run.id, expanded); }}
      >
        <span class="twisty" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
        <span class="run-id">${run.id}</span>
        <span class="run-label">${run.label}</span>
        <span class="run-state">${runStateText(run)}</span>
      </button>
      ${expanded ? run.agents.map((agent) => this.renderAgent(run, agent)) : null}
    `;
  }

  /**
   * One line per agent, with its commands behind a menu.
   *
   * Both commands need the session the agent wrote, and only a finished run
   * reports one, so the menu button is absent while an agent still works.
   * There is nothing to open or promote until then.
   */
  private renderAgent(run: DelegatedRun, agent: DelegatedAgent): TemplateResult {
    const sessionFile = agent.sessionFile;
    const key = `${run.id}:${String(agent.index)}`;
    const open = this.openMenuKey === key;

    return html`
      <div class="agent" data-agent=${agent.name} data-state=${agent.state}>
        <span class="glyph" aria-hidden="true">${STATE_GLYPH[agent.state]}</span>
        <span class="name">${agent.name}</span>
        <span class="detail">${agent.detail ?? ""}</span>
        <span class="agent-state">${agent.state}</span>
        <span class="elapsed">${formatElapsed(agent.elapsedMs)}</span>
        ${sessionFile === undefined
          ? null
          : html`<button
              class="agent-menu-button"
              type="button"
              data-action="agent-menu"
              aria-haspopup="menu"
              aria-expanded=${String(open)}
              aria-label=${`Commands for ${agent.name}`}
              title="Commands"
              @click=${() => { this.toggleMenu(key); }}
            >···</button>`}
      </div>
      ${open && sessionFile !== undefined ? this.renderAgentMenu(sessionFile) : null}
    `;
  }

  private renderAgentMenu(sessionFile: string): TemplateResult {
    return html`
      <div class="agent-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          data-action="open-transcript"
          @click=${() => { this.runCommand(() => { this.context?.onOpenSessionFile?.(sessionFile); }); }}
        >Open transcript</button>
        <button
          type="button"
          role="menuitem"
          data-action="promote"
          @click=${() => { this.runCommand(() => { this.context?.onPromoteSpawnedSession?.(sessionFile); }); }}
        >Promote to its own session</button>
      </div>
    `;
  }

  private toggleMenu(key: string): void {
    this.openMenuKey = this.openMenuKey === key ? undefined : key;
  }

  private runCommand(command: () => void): void {
    this.openMenuKey = undefined;
    command();
  }

  /**
   * A run opens by default when it is the newest or has work in flight, so the
   * panel never opens on a list that hides running agents.
   */
  private isExpanded(run: DelegatedRun): boolean {
    const override = this.expansionOverrides.get(run.id);
    if (override !== undefined) return override;
    const runs = this.context === undefined ? [] : this.runs(this.context);
    return runs[0]?.id === run.id || run.counts.running > 0;
  }

  private toggleRun(runId: string, expanded: boolean): void {
    const next = new Map(this.expansionOverrides);
    next.set(runId, !expanded);
    this.expansionOverrides = next;
  }

  /**
   * Keyed on the `messages` array identity, never its length: `tool.update`
   * replaces a part in place, so a length key would freeze every agent row at
   * the first state it was observed in.
   */
  private runs(context: WorkspacePanelContext): readonly DelegatedRun[] {
    const sessionId = context.state.selectedSession?.id;
    const messages = context.state.messages;
    const cache = this.runsCache;
    if (cache !== undefined && cache.sessionId === sessionId && cache.messages === messages) {
      return cache.runs;
    }
    const runs = deriveDelegatedRuns(messages);
    this.runsCache = { sessionId, messages, runs };
    return runs;
  }
}


function summaryText(runs: readonly DelegatedRun[]): string {
  let total = 0;
  let running = 0;
  let done = 0;
  let failed = 0;
  for (const run of runs) {
    total += run.counts.total;
    running += run.counts.running;
    done += run.counts.done;
    failed += run.counts.failed;
  }
  const parts = [`${String(total)} ${total === 1 ? "agent" : "agents"}`];
  if (running > 0) parts.push(`${String(running)} working`);
  if (done > 0) parts.push(`${String(done)} done`);
  if (failed > 0) parts.push(`${String(failed)} failed`);
  // Without this the counts silently fail to add up: a run observed only
  // through `tool.start` is all-pending, so every agent would be unaccounted.
  const pending = total - running - done - failed;
  if (pending > 0) parts.push(`${String(pending)} pending`);
  return parts.join(" · ");
}

function runStateText(run: DelegatedRun): string {
  switch (run.state) {
    // A run can be live with nothing started yet; "0 working" reads as a stall.
    case "running": return run.counts.running === 0 ? "pending" : `${String(run.counts.running)} working`;
    case "done": return "done";
    case "failed": return "failed";
    case "partial": return `${String(run.counts.done)}/${String(run.counts.total)} done`;
  }
}

function formatElapsed(elapsedMs: number | undefined): string {
  if (elapsedMs === undefined || elapsedMs <= 0) return "";
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${String(minutes)}m` : `${String(Math.round(minutes / 60))}h`;
}
