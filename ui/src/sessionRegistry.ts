import { createSessionStore, type SessionTransport } from "./sessionStore";
import type { Session } from "./contracts";
import { createReadTracker } from "./readReceipt";
import { afterTranscriptPaint } from "./readPaint";
import { createChildAgentsStore } from "./childAgents/childAgentsStore";
import { CHILDREN_CHANGED_EVENT } from "./childAgents/childAgentsModel";
import { createProcessesStore } from "./processes/processesStore";
import { createWorkflowsStore } from "./workflows/workflowsStore";
import { WORKFLOW_RUNS_CHANGED_EVENT } from "./workflows/workflowsModel";
import { createDecisionsStore } from "./decisions/decisionsStore";
import { createGatedActionsStore } from "./gatedActions/gatedActionsStore";
import { createTaskActivityStore } from "./session/taskActivityStore";

export interface RegistryReceipt { catalogId: string; throughCompletionOrder: number }
export function createSessionEntry(session: Session, transport: SessionTransport, options: {
  isVisible?: () => boolean;
  onUnread?: (listener: (id: string, receipt?: RegistryReceipt) => void) => () => void;
  afterPaint?: (signal: AbortSignal) => Promise<void>;
} = {}) {
  let visible = false;
  const lifetime = new AbortController();
  const cleanups = new Set<() => void>();
  const ref = () => store.getSnapshot().session ?? session;
  const childAgents = createChildAgentsStore(transport.request, ref);
  const processes = createProcessesStore(transport.request, ref);
  const workflows = createWorkflowsStore(transport.request, ref, () => crypto.randomUUID());
  const decisions = createDecisionsStore(transport.request, ref);
  const gated = createGatedActionsStore(transport.request, ref);
  // Live Durable tasks for the status panel: read again on the same change event as the children, on reconnect, and on panel open.
  const taskActivity = createTaskActivityStore(transport.request, ref);
  const reads = createReadTracker(transport, { isVisible: () => visible && !store.getSnapshot().transcript.isRunning && (options.isVisible?.() ?? document.visibilityState === "visible"),
    subscribe: options.onUnread, afterRender: options.afterPaint ?? afterTranscriptPaint });
  const store = createSessionStore(session.id, transport, {}, session.cwd ? session : undefined, reads, event => {
    if (event === CHILDREN_CHANGED_EVENT) { childAgents.refresh(); workflows.refresh(); taskActivity.refresh(); }
    if (event === WORKFLOW_RUNS_CHANGED_EVENT) { workflows.refresh(); decisions.refresh(); gated.refresh(); }
  }, event => {
    if (event.type === "processes.update") processes.applySnapshot(event.snapshot);
    else processes.applyOutput(event.id, event.lines, event.cursor, event.droppedLines);
  });
  let readyAt: number | undefined;
  cleanups.add(store.subscribe(() => {
    const state = store.getSnapshot();
    // While the connection is down, the task list may miss changes: keep it, marked stale, until a read after the reconnect.
    taskActivity.setConnected(state.connection.type === "ready");
    if (state.connection.type !== "ready" || state.lastReadyAt === readyAt) return;
    readyAt = state.lastReadyAt;
    childAgents.refresh(); workflows.refresh(); decisions.refresh(); gated.refresh(); void processes.refresh(); taskActivity.refresh();
  }));
  let disposed = false;
  return {
    session, store, childAgents, processes, workflows, decisions, gated, taskActivity, signal: lifetime.signal,
    setVisible: (next: boolean) => { visible = next; store.setVisible(next); },
    onDispose: (cleanup: () => void) => { cleanups.add(cleanup); return () => { cleanups.delete(cleanup); }; },
    dispose: () => {
      if (disposed) return;
      disposed = true; visible = false; lifetime.abort();
      store.dispose(); childAgents.dispose(); processes.dispose(); workflows.dispose(); decisions.dispose(); gated.dispose(); taskActivity.dispose();
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    },
  };
}
export type SessionEntry = ReturnType<typeof createSessionEntry>;
interface KeptEntry { key: string; entry: SessionEntry; selectedAt: number; selections: number; visited: boolean; state: "queued" | "opening" | "seeded" }

/** App lifetime owns the six live stores; Activity owns only their retained visual state. */
export function createSessionRegistry(transport: SessionTransport, options: Parameters<typeof createSessionEntry>[2] & {
  machine?: string; capacity?: number; createEntry?: (session: Session) => SessionEntry;
} = {}) {
  const capacity = options.capacity ?? 6;
  let entries: KeptEntry[] = [];
  let selected: string | undefined;
  let visible = true;
  let clock = 0;
  let disposed = false;
  let snapshot: readonly KeptEntry[] = entries;
  const listeners = new Set<() => void>();
  const keyOf = (session: Session) => JSON.stringify([options.machine ?? "local", session.cwd.replace(/\/$/u, "") || "/", session.id]);
  const publish = () => { snapshot = [...entries]; for (const listener of listeners) listener(); };
  const evict = (record: KeptEntry) => { entries = entries.filter(item => item !== record); record.entry.dispose(); };
  const hiddenDeep = (record: KeptEntry) => record.entry.store.retainedEarlierMessages() > 200;
  const pump = () => {
    if (disposed) return;
    while (entries.filter(item => item.state === "opening").length < 2) {
      const candidate = entries.find(item => item.key === selected && item.state === "queued") ?? entries.find(item => item.state === "queued");
      if (!candidate) break;
      candidate.state = "opening";
      void candidate.entry.store.start().finally(() => {
        if (!entries.includes(candidate)) return;
        candidate.state = "seeded"; publish(); pump();
      });
    }
  };
  function acquire(session: Session, visit: boolean): KeptEntry | undefined {
    if (disposed) return undefined;
    const key = keyOf(session);
    let record = entries.find(item => item.key === key);
    if (!record) {
      if (entries.length >= capacity) {
        if (!visit) return undefined; // Speculation must not displace a retained screen under pressure.
        const victim = entries.filter(item => item.key !== selected).sort((a, b) => a.selectedAt - b.selectedAt)[0];
        if (!victim) return undefined;
        evict(victim);
      }
      record = { key, entry: options.createEntry?.(session) ?? createSessionEntry(session, transport, options), selectedAt: -Infinity, selections: 0, visited: false, state: "queued" };
      entries.push(record);
    }
    if (visit) {
      selected = key;
      record.selectedAt = ++clock; record.selections++; record.visited = true;
      for (const item of [...entries]) {
        item.entry.setVisible(item === record && visible);
        if (item !== record && hiddenDeep(item)) evict(item);
      }
      if (record.state === "queued" && entries.filter(item => item.state === "opening").length === 2) {
        const speculative = entries.find(item => item.state === "opening" && !item.visited);
        if (speculative) evict(speculative);
      }
    }
    publish(); pump();
    return record;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select: (session: Session) => acquire(session, true)?.entry,
    prefetch: (session: Session) => acquire(session, false)?.entry,
    cancelPrefetch: (session: Session) => {
      const record = entries.find(item => item.key === keyOf(session));
      if (record && !record.visited) { evict(record); publish(); pump(); }
    },
    setVisible: (next: boolean) => { visible = next; for (const record of entries) record.entry.setVisible(next && record.key === selected); },
    forget: (id: string) => { for (const record of [...entries]) if (record.entry.session.id === id) evict(record); publish(); },
    dispose: () => { if (disposed) return; disposed = true; for (const record of [...entries]) evict(record); publish(); listeners.clear(); },
  };
}
export type SessionRegistry = ReturnType<typeof createSessionRegistry>;
