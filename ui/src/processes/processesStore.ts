import { z } from "zod";
import type { ManagedProcessLogLine, ManagedProcessesSnapshot, ManagedProcessWriteResult } from "@shared/apiTypes";
import { loadProcessLines, type Request } from "./processApi";
import { snapshotSchema } from "./processSchemas";

const actionSchema = z.object({ ok: z.boolean(), reason: z.string().optional(), bytesWritten: z.number().int().nonnegative().optional() });
export type ProcessesView = { kind: "loading" } | { kind: "failed"; error: string } | { kind: "ready"; snapshot: ManagedProcessesSnapshot };
/** `output` is the selected process's log as one text; `stderr` holds the indexes of its lines that came from stderr. */
export interface ProcessesState { view: ProcessesView; selected?: string; output?: string; stderr?: readonly number[]; error?: string; readError?: string; pending?: boolean }

const OUTPUT_TAIL_LINES = 200;

/** One browser projection, read on join and kept current by process events. No launch records enter this store. */
export function createProcessesStore(request: Request, ref: () => { id: string; cwd: string } | undefined) {
  let state: ProcessesState = { view: { kind: "loading" } };
  const listeners = new Set<() => void>();
  let disposed = false;
  let reading = false;
  let again = false;
  let selectionVersion = 0;
  // Keep typed lines as the output source; text and stderr indexes are its public projection.
  let outputLines: readonly ManagedProcessLogLine[] = [];
  function setOutput(lines?: readonly ManagedProcessLogLine[]) {
    outputLines = lines?.slice(-OUTPUT_TAIL_LINES) ?? [];
    return { output: lines === undefined ? undefined : outputLines.map(line => line.text).join("\n"),
      stderr: lines === undefined ? undefined : outputLines.flatMap((line, index) => line.type === "stderr" ? [index] : []) };
  }
  const update = (next: ProcessesState) => { if (!disposed) { state = next; for (const listener of listeners) listener(); } };
  const path = (id: string) => `/api/sessions/${encodeURIComponent(id)}/processes`;
  function applySnapshot(snapshot: ManagedProcessesSnapshot) {
    if (disposed) return;
    const selected = snapshot.processes.some(item => item.id === state.selected) ? state.selected : undefined;
    if (selected !== state.selected) selectionVersion++;
    update({ ...state, view: { kind: "ready", snapshot }, readError: undefined, selected,
      ...(selected === undefined ? setOutput() : {}) });
  }
  function applyOutput(id: string, lines: readonly ManagedProcessLogLine[]) {
    if (disposed || id !== state.selected || lines.length === 0) return;
    update({ ...state, ...setOutput([...outputLines, ...lines]) });
  }
  async function refresh() {
    if (reading) { again = true; return; }
    const session = ref(); if (!session || disposed) return;
    reading = true;
    try {
      const response = await request(`${path(session.id)}?${new URLSearchParams({ cwd: session.cwd })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = snapshotSchema.parse(await response.json());
      applySnapshot(snapshot);
      const selected = state.selected;
      const version = selectionVersion;
      if (selected !== undefined) {
        const lines = await loadProcessLines(request, session, selected, OUTPUT_TAIL_LINES);
        if (!disposed && version === selectionVersion) update({ ...state, ...setOutput(lines) });
      }
    } catch (error) {
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
    refresh: () => { void refresh(); },
    select: (id: string | undefined) => { selectionVersion++; update({ ...state, selected: id, ...setOutput(), error: undefined }); void refresh(); },
    stop: (id: string) => { void action(id, "kill").catch(() => undefined); },
    write: (id: string, input: string, end?: boolean) => action(id, "write", input, end),
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
