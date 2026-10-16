import { z } from "zod";
import type { ManagedProcessesSnapshot, ManagedProcessWriteResult } from "@shared/apiTypes";
import { loadProcessLines, type Request } from "./processApi";

const snapshotSchema = z.object({ available: z.boolean(), writeSupported: z.boolean(), processes: z.array(z.object({
  id: z.string(), name: z.string(), pid: z.number(), command: z.string(), cwd: z.string(), startTime: z.number(), endTime: z.number().nullable(),
  status: z.enum(["running", "terminating", "terminate_timeout", "exited", "killed"]), exitCode: z.number().nullable(), success: z.boolean().nullable(),
  endReason: z.enum(["exit", "signal", "spawn_error", "missing_pid", "kill_timeout", "lost"]).nullable(),
  signal: z.object({ name: z.string(), number: z.number().nullable(), description: z.string() }).nullable(), errorMessage: z.string().nullable(),
  supervision: z.enum(["systemd", "attached"]).optional(), notice: z.string().optional(),
})) }) satisfies z.ZodType<ManagedProcessesSnapshot>;
const actionSchema = z.object({ ok: z.boolean(), reason: z.string().optional(), bytesWritten: z.number().int().nonnegative().optional() });
export type ProcessesView = { kind: "loading" } | { kind: "failed"; error: string } | { kind: "ready"; snapshot: ManagedProcessesSnapshot };
/** `output` is the selected process's log as one text; `stderr` holds the indexes of its lines that came from stderr. */
export interface ProcessesState { view: ProcessesView; selected?: string; output?: string; stderr?: readonly number[]; error?: string; readError?: string; pending?: boolean }

/** One browser projection, refreshed on join and process events. No launch records enter this store. */
export function createProcessesStore(request: Request, ref: () => { id: string; cwd: string } | undefined) {
  let state: ProcessesState = { view: { kind: "loading" } };
  const listeners = new Set<() => void>();
  let disposed = false;
  let reading = false;
  let again = false;
  let selectionVersion = 0;
  const update = (next: ProcessesState) => { if (!disposed) { state = next; for (const listener of listeners) listener(); } };
  const path = (id: string) => `/api/sessions/${encodeURIComponent(id)}/processes`;
  async function refresh() {
    if (reading) { again = true; return; }
    const session = ref(); if (!session || disposed) return;
    reading = true;
    try {
      const response = await request(`${path(session.id)}?${new URLSearchParams({ cwd: session.cwd })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = snapshotSchema.parse(await response.json());
      const selected = snapshot.processes.some(item => item.id === state.selected) ? state.selected : undefined;
      update({ ...state, view: { kind: "ready", snapshot }, readError: undefined, selected, ...(selected === undefined ? { output: undefined, stderr: undefined } : {}) });
      const version = selectionVersion;
      if (selected !== undefined) {
        const lines = await loadProcessLines(request, session, selected, 200);
        if (version === selectionVersion) update({ ...state, output: lines.map((line) => line.text).join("\n"),
          stderr: lines.flatMap((line, index) => line.type === "stderr" ? [index] : []) });
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
    refresh: () => { void refresh(); },
    select: (id: string | undefined) => { selectionVersion++; update({ ...state, selected: id, output: undefined, stderr: undefined, error: undefined }); void refresh(); },
    stop: (id: string) => { void action(id, "kill").catch(() => undefined); },
    write: (id: string, input: string, end?: boolean) => action(id, "write", input, end),
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
