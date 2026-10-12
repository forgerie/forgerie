// The browser's view of one session's workflows: the saved ones it can start, the ones the agent proposed, and its runs.
// Routes: src/server/sessions/workflowRoutes.ts.
import { z } from "zod";
import {
  workflowInventorySchema, workflowProposalSchema, workflowProposalsSchema, workflowRunSchema, workflowRunsSchema,
  type ProposalAction, type SavedWorkflow, type StopDecision, type WorkflowInputs, type WorkflowProposal, type WorkflowRun,
} from "./workflowsModel";

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
  /** The agent's proposals, newest first. Undefined until the first read answers. */
  proposals?: readonly WorkflowProposal[];
  /** Why the last read of the proposals failed. Cleared by the next read that answers. */
  proposalsError?: string;
  /** The proposal with a decision on its way, and which one. */
  proposing?: { id: string; action: ProposalAction };
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

  // Reads can answer out of order. Each read takes the next number, and only the newest read's answer counts.
  // A decision the server accepted retires every read that started before it, since those reads predate it.
  const generation = { runs: 0, proposals: 0 };
  const retireReads = (records: { runs: boolean; proposals: boolean }) => {
    if (records.runs) generation.runs += 1;
    if (records.proposals) generation.proposals += 1;
  };

  async function readRuns() {
    const session = ref();
    if (!session) return;
    const mine = ++generation.runs;
    // Await before spreading: the runs and the proposals are read side by side, and each must keep the other's answer.
    try { const runs = await call(url(session, "workflow-runs", true), workflowRunsSchema); if (mine === generation.runs) update({ ...state, runs }); }
    // A session without Durable children has no workflow records; it shows no strip.
    catch { if (mine === generation.runs) update({ ...state, runs: [] }); }
  }

  async function readProposals() {
    const session = ref();
    if (!session) return;
    const mine = ++generation.proposals;
    try {
      const proposals = await call(url(session, "workflow-proposals", true), workflowProposalsSchema);
      if (mine === generation.proposals) update({ ...state, proposals, proposalsError: undefined });
    }
    // Keep what was read before: a card that was open stays open while the read is retried.
    catch (error) { if (mine === generation.proposals) update({ ...state, proposalsError: message(error) }); }
  }

  /** Sends one decision on a proposal. Any failure is the reader's to see; the records are read again, since another tab may have decided. */
  async function decideProposal<T>(id: string, action: ProposalAction, body: Record<string, unknown>, schema: z.ZodType<T>, apply: (answer: T) => Partial<WorkflowsState>): Promise<boolean> {
    const session = ref();
    if (!session || state.proposing !== undefined) return false;
    update({ ...state, proposing: { id, action }, error: undefined });
    try {
      const answer = await call(url(session, `workflow-proposals/${encodeURIComponent(id)}/${action}`), schema, { cwd: session.cwd, ...body });
      retireReads({ runs: action === "start", proposals: true });
      update({ ...state, proposing: undefined, ...apply(answer) });
      void readProposals();
      return true;
    } catch (error) {
      update({ ...state, proposing: undefined, error: message(error) });
      void readProposals();
      void readRuns();
      return false;
    }
  }
  const withProposal = (proposal: WorkflowProposal): Partial<WorkflowsState> =>
    ({ proposals: (state.proposals ?? []).some((candidate) => candidate.id === proposal.id)
      ? state.proposals?.map((candidate) => candidate.id === proposal.id ? proposal : candidate) : [proposal, ...state.proposals ?? []] });

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void readRuns(); void readProposals(); }, refreshDelayMs);
    },
    /** Reads the proposals again at once, such as after a failed read. */
    retryProposals: () => readProposals(),
    /** Starts a proposal with the reader's inputs. Resolves true once the server accepted it; the run strip follows the runs. */
    startProposal: (id: string, inputs: WorkflowInputs) => decideProposal(id, "start", { inputs, requestId: newRequestId() }, workflowRunSchema, (run) => ({
      runs: [run, ...state.runs.filter((candidate) => candidate.id !== run.id)],
      proposals: state.proposals?.map((proposal) => proposal.id === id ? { ...proposal, state: { kind: "started", runId: run.id, decidedAt: run.startedAt } } : proposal),
    })),
    /** Closes a proposal with what the reader wants changed; the agent proposes again. */
    askProposalChanges: (id: string, note: string) => decideProposal(id, "changes", { note }, workflowProposalSchema, withProposal),
    dismissProposal: (id: string) => decideProposal(id, "dismiss", {}, workflowProposalSchema, withProposal),
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
        retireReads({ runs: true, proposals: false });
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
        retireReads({ runs: true, proposals: false });
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
