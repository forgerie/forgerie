import { z } from "zod";
import type { ManagedProcessLogLine, ManagedProcessOutputCursor, ManagedProcessesSnapshot, ManagedProcessWriteResult } from "@shared/apiTypes";
import { loadProcessTail, type Request } from "./processApi";
import { snapshotSchema } from "./processSchemas";
import { OUTPUT_TAIL_LINES, reconcileProcessOutput, type ProcessOutput } from "./processOutput";

const actionSchema = z.object({ ok: z.boolean(), reason: z.string().optional(), bytesWritten: z.number().int().nonnegative().optional() });
export type ProcessesView = { kind: "loading" } | { kind: "failed"; error: string } | { kind: "ready"; snapshot: ManagedProcessesSnapshot };
/** `output` is the selected process's log as one text; `stderr` holds the indexes of its lines that came from stderr. */
export interface ProcessesState { view: ProcessesView; selected?: string; output?: string; stderr?: readonly number[]; error?: string; readError?: string; pending?: boolean }

/** One browser projection, read on join and kept current by process events. No launch records enter this store. */
export function createProcessesStore(request: Request, ref: () => { id: string; cwd: string } | undefined) {
  let state: ProcessesState = { view: { kind: "loading" } };
  const listeners = new Set<() => void>();
  let disposed = false;
  let reading = false;
  let again = false;
  let selectionVersion = 0;
  let snapshotGeneration = 0;
  let outputGeneration = 0;
  const keyOf = (session: ReturnType<typeof ref>) => session === undefined ? undefined : JSON.stringify([session.id, session.cwd]);
  let sessionKey: string | undefined;
  let sessionBound = false;
  // Typed lines and their cursor are the source; text and stderr indexes are its public projection.
  let output: ProcessOutput | undefined;
  function setOutput(next?: ProcessOutput) {
    output = next;
    outputGeneration++;
    return { output: next?.lines.map(line => line.text).join("\n"),
      stderr: next?.lines.flatMap((line, index) => line.type === "stderr" ? [index] : []) };
  }
  const update = (next: ProcessesState) => { if (!disposed) { state = next; for (const listener of listeners) listener(); } };
  const path = (id: string) => `/api/sessions/${encodeURIComponent(id)}/processes`;
  function synchronizeSession() {
    const session = ref();
    const key = keyOf(session);
    if (!sessionBound) { sessionKey = key; sessionBound = true; }
    else if (!disposed && key !== sessionKey) {
      sessionKey = key; snapshotGeneration++; selectionVersion++;
      update({ view: { kind: "loading" }, ...setOutput() });
    }
    return session;
  }
  function setSnapshot(snapshot: ManagedProcessesSnapshot) {
    const selected = snapshot.processes.some(item => item.id === state.selected) ? state.selected : undefined;
    if (selected !== state.selected) selectionVersion++;
    update({ ...state, view: { kind: "ready", snapshot }, readError: undefined, selected,
      ...(selected === undefined ? setOutput() : {}) });
  }
  function applySnapshot(snapshot: ManagedProcessesSnapshot) {
    if (disposed) return;
    synchronizeSession(); snapshotGeneration++;
    setSnapshot(snapshot);
  }
  function applyOutput(id: string, lines: ManagedProcessLogLine[], cursor?: ManagedProcessOutputCursor, droppedLines = 0) {
    if (disposed) return;
    synchronizeSession();
    if (id !== state.selected || (lines.length === 0 && cursor === undefined && droppedLines === 0)) return;
    const next = reconcileProcessOutput(output, { lines, cursor, droppedLines }, "push");
    if (next === undefined) {
      // Missing identities or a gap require the full log, never text-based deduplication.
      outputGeneration++; void refresh(); return;
    }
    if (next !== output) update({ ...state, ...setOutput(next) });
  }
  async function refresh() {
    if (disposed) return;
    const session = synchronizeSession();
    if (reading) { again = true; return; }
    if (!session) return;
    const key = keyOf(session);
    const generation = snapshotGeneration;
    let errorSnapshotGeneration = generation;
    let errorSelectionVersion = selectionVersion;
    let errorOutputGeneration = outputGeneration;
    const currentSession = () => !disposed && keyOf(ref()) === key;
    reading = true;
    try {
      const response = await request(`${path(session.id)}?${new URLSearchParams({ cwd: session.cwd })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = snapshotSchema.parse(await response.json());
      // A push owns a newer snapshot, including when this read fails or finishes decoding later.
      if (!currentSession()) return;
      if (generation === snapshotGeneration) setSnapshot(snapshot);
      const selected = state.selected;
      const version = selectionVersion;
      errorSnapshotGeneration = snapshotGeneration;
      errorSelectionVersion = version; errorOutputGeneration = outputGeneration;
      if (selected !== undefined) {
        const batch = await loadProcessTail(request, session, selected, OUTPUT_TAIL_LINES);
        if (!currentSession() || version !== selectionVersion) return;
        const next = reconcileProcessOutput(output, batch, "tail");
        if (next === undefined || (next.cursor === undefined && errorOutputGeneration !== outputGeneration)) {
          again = true; return;
        }
        update({ ...state, ...setOutput(next) });
      }
    } catch (error) {
      if (!currentSession() || errorSnapshotGeneration !== snapshotGeneration || errorSelectionVersion !== selectionVersion || errorOutputGeneration !== outputGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      update(state.view.kind === "ready" ? { ...state, readError: message } : { ...state, view: { kind: "failed", error: message } });
    } finally { reading = false; if (again && !disposed) { again = false; void refresh(); } }
  }
  async function action(id: string, command: "kill" | "write", input = "", end = false): Promise<ManagedProcessWriteResult> {
    const session = ref(); if (!session) throw new Error("Session is not connected");
    update({ ...state, pending: true, error: undefined });
    try {
      const response = await request(`${path(session.id)}/${encodeURIComponent(id)}/${command}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, ...(command === "write" ? { input, end } : {}) }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = actionSchema.parse(await response.json());
      if (!result.ok) {
        update({ ...state, error: `${result.reason ?? "Process operation failed"}${result.bytesWritten === undefined ? "" : ` (${result.bytesWritten} bytes written). Do not resend those bytes.`}` });
        return { ok: false, reason: "write_error", ...(result.bytesWritten === undefined ? {} : { bytesWritten: result.bytesWritten }) };
      }
      return { ok: true, ...(result.bytesWritten === undefined ? {} : { bytesWritten: result.bytesWritten }) };
    } catch (error) {
      update({ ...state, error: `${error instanceof Error ? error.message : String(error)}. The command may have reached the process; check its output before retrying.` });
      throw error;
    } finally { update({ ...state, pending: false }); void refresh(); }
  }
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    applySnapshot,
    applyOutput,
    refresh,
    select: (id: string | undefined) => { if (disposed) return; synchronizeSession(); selectionVersion++; update({ ...state, selected: id, ...setOutput(), error: undefined }); return refresh(); },
    stop: (id: string) => { void action(id, "kill").catch(() => undefined); },
    write: (id: string, input: string, end?: boolean) => action(id, "write", input, end),
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
