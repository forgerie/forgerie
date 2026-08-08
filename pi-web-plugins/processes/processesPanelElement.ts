import type { WorkspacePanelContext } from "forgerie/plugin-api";
import type {
  ManagedProcessInfo,
  ManagedProcessLogLine,
  ManagedProcessesBrowserEvent,
  ManagedProcessesRuntime,
  ManagedProcessesSnapshot,
  UnstableWorkspacePanelContext,
} from "forgerie/plugin-api/unstable";

export const processesPanelTagName = "pi-web-processes-panel";
const LOG_TAIL_LINES = 200;
const MAX_LOG_LINES = 1_000;
const MAX_LOG_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

type ContextWithProcesses = WorkspacePanelContext & UnstableWorkspacePanelContext;
type PanelState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; snapshot: ManagedProcessesSnapshot };

interface ProcessUiState {
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  logs: ManagedProcessLogLine[];
  droppedLines: number;
  stdin: string;
}

export function defineProcessesPanelElement(): void {
  if (!customElements.get(processesPanelTagName)) customElements.define(processesPanelTagName, PiWebProcessesPanel);
}

export function processesPanelBadge(context: WorkspacePanelContext): string | number | undefined {
  const runtime = managedProcessesRuntime(context);
  if (runtime?.selectedSession === undefined) return "!";
  const snapshot = runtime.currentSnapshot();
  if (snapshot?.available === false) return "!";
  const running = snapshot?.processes.filter((process) => process.status === "running" || process.status === "terminating").length ?? 0;
  return running > 0 ? running : undefined;
}

class PiWebProcessesPanel extends HTMLElement {
  private contextValue: ContextWithProcesses | undefined;
  private state: PanelState = { kind: "loading" };
  private readonly root = this.attachShadow({ mode: "open" });
  private readonly processUi = new Map<string, ProcessUiState>();
  private unsubscribe: (() => void) | undefined;
  private contextKey: string | undefined;
  private loadGeneration = 0;
  private status: { kind: "info" | "success" | "error"; message: string } | undefined;

  set context(value: WorkspacePanelContext | undefined) {
    const next = value !== undefined && isContextWithProcesses(value) ? value : undefined;
    const nextKey = runtimeKey(next?.piWebUnstable?.managedProcesses);
    this.contextValue = next;
    if (nextKey === this.contextKey) return;
    this.contextKey = nextKey;
    this.processUi.clear();
    this.state = { kind: "loading" };
    this.status = undefined;
    if (this.isConnected) void this.loadSnapshot();
  }

  connectedCallback(): void {
    this.render();
    void this.loadSnapshot();
  }

  disconnectedCallback(): void {
    this.loadGeneration += 1;
    this.stopSubscription();
  }

  private stopSubscription(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async loadSnapshot(): Promise<void> {
    const runtime = this.contextValue?.piWebUnstable?.managedProcesses;
    const key = runtimeKey(runtime);
    const generation = ++this.loadGeneration;
    this.stopSubscription();
    if (runtime?.selectedSession === undefined) {
      this.state = { kind: "unavailable", message: runtime === undefined ? "Managed processes are not available in this environment." : "Select a session to inspect its processes." };
      this.render();
      return;
    }

    const queued: ManagedProcessesBrowserEvent[] = [];
    let loading = true;
    this.state = { kind: "loading" };
    this.render();
    const unsubscribe = runtime.subscribe((event) => {
      if (generation !== this.loadGeneration) return;
      if (loading) queued.push(event);
      else this.handleEvent(event);
    });
    this.unsubscribe = unsubscribe;

    try {
      const snapshot = await runtime.snapshot();
      if (generation !== this.loadGeneration || key !== this.contextKey) {
        unsubscribe();
        return;
      }
      loading = false;
      this.state = snapshot.available
        ? { kind: "ready", snapshot }
        : { kind: "unavailable", message: "The selected session does not provide managed processes." };
      for (const event of queued) this.handleEvent(event, false);
      this.render();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      loading = false;
      this.state = { kind: "unavailable", message: errorMessage(error) };
      this.render();
    }
  }

  private handleEvent(event: ManagedProcessesBrowserEvent, render = true): void {
    if (event.type === "processes.refresh") {
      void this.loadSnapshot();
      return;
    }
    if (event.type === "processes.update") {
      this.state = event.snapshot.available
        ? { kind: "ready", snapshot: event.snapshot }
        : { kind: "unavailable", message: "The selected session does not provide managed processes." };
      if (render) this.render();
      return;
    }
    if (this.state.kind !== "ready") return;
    const ui = this.processUi.get(event.id);
    if (ui?.expanded !== true) return;
    ui.logs = boundLogs([...ui.logs, ...event.lines]);
    ui.droppedLines += event.droppedLines;
    if (render && !(this.root.activeElement instanceof HTMLInputElement)) this.render();
  }

  private render(): void {
    this.root.innerHTML = `${styles()}
      <section class="toolbar">
        <div><strong>Processes</strong>${this.renderSessionLabel()}</div>
        <button class="secondary" data-refresh ${this.state.kind === "loading" ? "disabled" : ""}>Refresh</button>
      </section>
      ${this.renderStatus()}
      <section class="viewer">${this.renderState()}</section>`;

    this.root.querySelector<HTMLButtonElement>("[data-refresh]")?.addEventListener("click", () => { void this.loadSnapshot(); });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-toggle]")) {
      button.addEventListener("click", () => { void this.toggle(button.dataset["toggle"]); });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-stop]")) {
      button.addEventListener("click", () => { void this.stop(button.dataset["stop"]); });
    }
    for (const form of this.root.querySelectorAll<HTMLFormElement>("[data-stdin-form]")) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.write(form.dataset["stdinForm"]);
      });
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>("[data-stdin]")) {
      input.addEventListener("input", () => { this.ui(input.dataset["stdin"] ?? "").stdin = input.value; });
    }
  }

  private renderSessionLabel(): string {
    const session = this.contextValue?.piWebUnstable?.managedProcesses?.selectedSession;
    return session === undefined ? "" : `<span class="session-label" title="${escapeAttr(session.cwd)}">${escapeHtml(session.id.slice(0, 8))}</span>`;
  }

  private renderStatus(): string {
    return this.status === undefined ? "" : `<div class="notice ${this.status.kind}" role="status">${escapeHtml(this.status.message)}</div>`;
  }

  private renderState(): string {
    if (this.state.kind === "loading") return `<p class="muted">Loading processes…</p>`;
    if (this.state.kind === "unavailable") return `<div class="empty-state"><strong>Processes unavailable</strong><p>${escapeHtml(this.state.message)}</p></div>`;
    if (this.state.snapshot.processes.length === 0) return `<div class="empty-state"><strong>No managed processes</strong><p>Background commands started through pi-processes will appear here.</p></div>`;
    const sorted = [...this.state.snapshot.processes].sort(compareProcesses);
    return `<div class="processes">${sorted.map((process) => this.renderProcess(process, this.state.kind === "ready" && this.state.snapshot.writeSupported)).join("")}</div>`;
  }

  private renderProcess(process: ManagedProcessInfo, writeSupported: boolean): string {
    const ui = this.ui(process.id);
    const active = process.status === "running" || process.status === "terminating";
    const detail = process.errorMessage ?? (process.exitCode === null ? undefined : `Exit ${String(process.exitCode)}`);
    return `<article class="process-card">
      <header>
        <button class="disclosure secondary" data-toggle="${escapeAttr(process.id)}" aria-expanded="${String(ui.expanded)}" aria-label="${ui.expanded ? "Collapse" : "Expand"} ${escapeAttr(process.name)}">${ui.expanded ? "▾" : "▸"}</button>
        <div class="identity"><strong>${escapeHtml(process.name || process.command)}</strong><code>${escapeHtml(process.command)}</code></div>
        <span class="status ${statusClass(process.status)}">${escapeHtml(process.status.replaceAll("_", " "))}</span>
        ${process.status === "running" ? `<button class="danger" data-stop="${escapeAttr(process.id)}">Stop</button>` : ""}
      </header>
      <div class="meta"><span>PID ${String(process.pid)}</span><span>${escapeHtml(formatDuration((process.endTime ?? Date.now()) - process.startTime))}</span><span title="${escapeAttr(process.cwd)}">${escapeHtml(process.cwd)}</span>${detail === undefined ? "" : `<span>${escapeHtml(detail)}</span>`}</div>
      ${ui.expanded ? this.renderDetails(process, ui, active && writeSupported) : ""}
    </article>`;
  }

  private renderDetails(process: ManagedProcessInfo, ui: ProcessUiState, canWrite: boolean): string {
    const logs = ui.loading
      ? `<p class="muted">Loading output…</p>`
      : ui.logs.length === 0
        ? `<p class="muted">No output yet.</p>`
        : `<pre class="logs" aria-label="Output for ${escapeAttr(process.name)}">${ui.logs.map((line) => `<span class="${line.type}">${escapeHtml(line.text)}</span>`).join("")}</pre>`;
    const dropped = ui.droppedLines > 0 ? `<p class="dropped">${String(ui.droppedLines)} earlier output ${ui.droppedLines === 1 ? "update was" : "updates were"} omitted.</p>` : "";
    const stdin = canWrite ? `<form class="stdin" data-stdin-form="${escapeAttr(process.id)}"><label><span>Standard input</span><input data-stdin="${escapeAttr(process.id)}" value="${escapeAttr(ui.stdin)}" autocomplete="off" /></label><button type="submit" ${ui.stdin.trim() === "" ? "disabled" : ""}>Send</button></form>` : "";
    return `<section class="details">${dropped}${logs}${stdin}</section>`;
  }

  private ui(processId: string): ProcessUiState {
    let state = this.processUi.get(processId);
    if (state === undefined) {
      state = { expanded: false, loaded: false, loading: false, logs: [], droppedLines: 0, stdin: "" };
      this.processUi.set(processId, state);
    }
    return state;
  }

  private async toggle(processId: string | undefined): Promise<void> {
    if (processId === undefined) return;
    const ui = this.ui(processId);
    ui.expanded = !ui.expanded;
    this.render();
    if (!ui.expanded || ui.loaded || ui.loading) return;
    ui.loading = true;
    this.render();
    const runtime = this.contextValue?.piWebUnstable?.managedProcesses;
    if (runtime === undefined) return;
    try {
      const result = await runtime.output(processId, LOG_TAIL_LINES);
      if (!result.ok) throw new Error(processFailure(result.reason));
      ui.logs = boundLogs(result.lines);
      ui.loaded = true;
    } catch (error) {
      this.status = { kind: "error", message: errorMessage(error) };
    } finally {
      ui.loading = false;
      this.render();
    }
  }

  private async stop(processId: string | undefined): Promise<void> {
    if (processId === undefined) return;
    const process = this.state.kind === "ready" ? this.state.snapshot.processes.find((candidate) => candidate.id === processId) : undefined;
    const processName = process !== undefined && process.name !== "" ? ` “${process.name}”` : "";
    if (!window.confirm(`Stop managed process${processName}?\n\n${process?.command ?? processId}`)) return;
    const runtime = this.contextValue?.piWebUnstable?.managedProcesses;
    if (runtime === undefined) return;
    try {
      const result = await runtime.kill(processId);
      const current = this.state.kind === "ready" ? this.state.snapshot.processes.find((candidate) => candidate.id === processId) : undefined;
      const alreadyStopped = process !== undefined && (current === undefined || current.status === "exited" || current.status === "killed");
      this.status = result.ok
        ? { kind: "success", message: "Stop requested." }
        : alreadyStopped
          ? { kind: "success", message: "Process stopped." }
          : { kind: "error", message: processFailure(result.reason) };
      if (result.ok && this.state.kind === "ready") this.state = { kind: "ready", snapshot: { ...this.state.snapshot, processes: this.state.snapshot.processes.map((candidate) => candidate.id === result.process.id ? result.process : candidate) } };
      this.render();
    } catch (error) {
      this.status = { kind: "error", message: errorMessage(error) };
      this.render();
    }
  }

  private async write(processId: string | undefined): Promise<void> {
    if (processId === undefined) return;
    const ui = this.ui(processId);
    if (ui.stdin.trim() === "") return;
    const runtime = this.contextValue?.piWebUnstable?.managedProcesses;
    if (runtime === undefined) return;
    try {
      const result = await runtime.write(processId, `${ui.stdin}\n`);
      this.status = result.ok ? { kind: "success", message: "Input sent." } : { kind: "error", message: processFailure(result.reason) };
      if (result.ok) ui.stdin = "";
      this.render();
    } catch (error) {
      this.status = { kind: "error", message: errorMessage(error) };
      this.render();
    }
  }
}

function isContextWithProcesses(context: WorkspacePanelContext): context is ContextWithProcesses {
  return "piWebUnstable" in context;
}

function managedProcessesRuntime(context: WorkspacePanelContext): ManagedProcessesRuntime | undefined {
  return isContextWithProcesses(context) ? context.piWebUnstable?.managedProcesses : undefined;
}

function runtimeKey(runtime: ManagedProcessesRuntime | undefined): string | undefined {
  const session = runtime?.selectedSession;
  return session === undefined ? undefined : `${session.machineId}:${session.id}:${session.cwd}`;
}

function compareProcesses(left: ManagedProcessInfo, right: ManagedProcessInfo): number {
  const leftRank = left.status === "running" ? 0 : left.status === "terminating" ? 1 : 2;
  const rightRank = right.status === "running" ? 0 : right.status === "terminating" ? 1 : 2;
  return leftRank - rightRank || right.startTime - left.startTime || left.name.localeCompare(right.name);
}

function boundLogs(lines: ManagedProcessLogLine[]): ManagedProcessLogLine[] {
  const bounded: ManagedProcessLogLine[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0 && bounded.length < MAX_LOG_LINES; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const size = textEncoder.encode(line.text).byteLength;
    if (bounded.length > 0 && bytes + size > MAX_LOG_BYTES) break;
    bounded.push(line);
    bytes += size;
  }
  return bounded.reverse();
}

function statusClass(status: ManagedProcessInfo["status"]): string {
  if (status === "running") return "running";
  if (status === "exited") return "completed";
  return status === "terminating" ? "terminating" : "failed";
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

function processFailure(reason: string): string {
  return `Process operation failed: ${reason.replaceAll("_", " ")}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function styles(): string {
  return `<style>
    :host { display: contents; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-bottom:1px solid var(--pi-border-muted); }
    .toolbar > div { display:flex; align-items:baseline; gap:8px; min-width:0; }
    .session-label,.muted { color:var(--pi-muted); }
    .session-label { font:11px ui-monospace,SFMono-Regular,Menlo,monospace; }
    .viewer { box-sizing:border-box; min-height:0; overflow:auto; padding:12px; }
    .processes { display:grid; gap:10px; }
    .process-card { border:1px solid var(--pi-border); border-radius:10px; background:var(--pi-surface); padding:10px; }
    header { display:flex; flex-wrap:wrap; align-items:start; gap:8px; }
    .identity { display:grid; flex:1 1 220px; min-width:0; gap:4px; }
    code,.logs { font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    code { overflow:hidden; color:var(--pi-text-secondary); text-overflow:ellipsis; white-space:nowrap; }
    .status { border-radius:999px; padding:3px 7px; font-size:11px; text-transform:capitalize; }
    .status.running { color:var(--pi-success); background:var(--pi-success-surface); }
    .status.terminating { color:var(--pi-warning); background:var(--pi-warning-surface); }
    .status.failed { color:var(--pi-danger); background:var(--pi-bg-overlay-soft); }
    .status.completed { color:var(--pi-muted); background:var(--pi-bg); }
    .meta { display:flex; flex-wrap:wrap; gap:5px 12px; margin:8px 0 0 34px; color:var(--pi-muted); font-size:12px; }
    .meta span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .details { display:grid; gap:8px; margin:10px 0 0 34px; }
    .logs { box-sizing:border-box; max-height:320px; margin:0; overflow:auto; border:1px solid var(--pi-border-muted); border-radius:7px; background:var(--pi-bg); padding:9px; white-space:pre-wrap; overflow-wrap:anywhere; }
    .logs span { display:inline; }.logs .stderr { color:var(--pi-danger); }
    .dropped { margin:0; color:var(--pi-warning); font-size:12px; }
    .stdin { display:flex; flex-wrap:wrap; align-items:end; gap:8px; }.stdin label { display:grid; flex:1 1 260px; gap:4px; color:var(--pi-muted); font-size:12px; }
    input { min-width:0; border:1px solid var(--pi-border); border-radius:7px; background:var(--pi-bg); color:var(--pi-text); padding:7px 8px; font:inherit; }
    button { border:1px solid var(--pi-accent-border); border-radius:7px; background:var(--pi-accent); color:var(--pi-bg); cursor:pointer; padding:6px 10px; font:inherit; }
    button.secondary { border-color:var(--pi-border); background:var(--pi-surface); color:var(--pi-text); }
    button.danger { border-color:var(--pi-danger); background:transparent; color:var(--pi-danger); }
    button.disclosure { padding:3px 7px; } button:disabled { cursor:default; opacity:.55; }
    .notice,.empty-state { margin:12px 12px 0; border:1px solid var(--pi-border); border-radius:8px; padding:10px; }
    .notice.success { border-color:var(--pi-success-border); color:var(--pi-success); }.notice.error { border-color:var(--pi-danger); color:var(--pi-danger); }
    .empty-state { margin:0; border-style:dashed; color:var(--pi-muted); }.empty-state p { margin:5px 0 0; }
  </style>`;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
