// The browser's view of one session's workflows: the saved ones it can start, and its runs.
// Routes: src/server/sessions/workflowRoutes.ts.
import { z } from "zod";
import { workflowInventorySchema, workflowRunSchema, workflowRunsSchema, type SavedWorkflow, type StopDecision, type WorkflowInputs, type WorkflowRun } from "./workflowsModel";

export type Request = (path: string, init: RequestInit) => Promise<Response>;
export interface SessionRef { id: string; cwd: string }

export interface WorkflowsState {
  runs: readonly WorkflowRun[];
  /** Undefined until the picker first reads the library. */
  saved?: readonly SavedWorkflow[];
  /** Saved files that could not be read, with the reason. */
  broken?: readonly { name: string; error: string }[];
  /** The stop with a decision on its way, as runId/stage. */
  deciding?: string;
  launching?: boolean;
  /** The last action that failed, in words for the reader. */
  error?: string;
}

const errorSchema = z.object({ error: z.string() });

/** Reads and actions on a session's workflows. Refresh is debounced, so a burst of change events costs one read. */
export function createWorkflowsStore(request: Request, ref: () => SessionRef | undefined, newRequestId: () => string, refreshDelayMs = 150) {
  let state: WorkflowsState = { runs: [] };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const update = (next: WorkflowsState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const url = (session: SessionRef, rest: string, query = false) =>
    `/api/sessions/${encodeURIComponent(session.id)}/${rest}${query ? `?${new URLSearchParams({ cwd: session.cwd })}` : ""}`;
  // Landing several branches can take a while; everything else answers quickly.
  async function call<T>(path: string, schema: z.ZodType<T>, body?: Record<string, unknown>): Promise<T> {
    const response = await request(path, { cache: "no-store", signal: AbortSignal.timeout(body?.["decision"] === "land" ? 120_000 : 15_000),
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(parsed.success ? parsed.data.error : `HTTP ${String(response.status)}`);
    }
    return schema.parse(await response.json());
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  async function readRuns() {
    const session = ref();
    if (!session) return;
    try { update({ ...state, runs: await call(url(session, "workflow-runs", true), workflowRunsSchema) }); }
    // A session without Durable children has no workflow records; it shows no strip.
    catch { update({ ...state, runs: [] }); }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void readRuns(); }, refreshDelayMs);
    },
    async readSaved() {
      const session = ref();
      if (!session) return;
      try {
        const inventory = await call(url(session, "workflows", true), workflowInventorySchema);
        update({ ...state, saved: inventory.workflows, broken: inventory.diagnostics.map(({ name, error }) => ({ name, error })) });
      } catch (error) { update({ ...state, saved: [], error: message(error) }); }
    },
    /** Starts a saved workflow. Resolves true once the server accepted the launch. */
    async launch(name: string, inputs: WorkflowInputs): Promise<boolean> {
      const session = ref();
      if (!session || state.launching === true) return false;
      update({ ...state, launching: true, error: undefined });
      try {
        const run = await call(url(session, "workflow-runs"), workflowRunSchema, { cwd: session.cwd, name, inputs, requestId: newRequestId() });
        update({ ...state, launching: false, runs: [run, ...state.runs.filter((candidate) => candidate.id !== run.id)] });
        return true;
      } catch (error) { update({ ...state, launching: false, error: message(error) }); return false; }
    },
    async decide(runId: string, stage: string, decision: StopDecision, note?: string): Promise<boolean> {
      const session = ref();
      if (!session || state.deciding !== undefined) return false;
      update({ ...state, deciding: `${runId}/${stage}`, error: undefined });
      try {
        const run = await call(url(session, `workflow-runs/${encodeURIComponent(runId)}/stops/${encodeURIComponent(stage)}`), workflowRunSchema,
          { cwd: session.cwd, decision, ...(note === undefined || note.trim() === "" ? {} : { note }) });
        update({ ...state, deciding: undefined, runs: state.runs.map((candidate) => candidate.id === run.id ? run : candidate) });
        return true;
      } catch (error) {
        update({ ...state, deciding: undefined, error: message(error) });
        void readRuns();
        return false;
      }
    },
    dismissError() { update({ ...state, error: undefined }); },
    dispose() { disposed = true; if (timer !== undefined) clearTimeout(timer); listeners.clear(); },
  };
}
