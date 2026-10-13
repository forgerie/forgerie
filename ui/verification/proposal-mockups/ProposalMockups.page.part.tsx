import { workflowProposalSchema, type WorkflowStage } from "../../src/workflows/workflowsModel";
import { withModel, withWorkers } from "./routeEdits";
import { CHANGES_NOTE, FLAKY_HUNT, fromRecord, type MockProposal } from "./planDocument";
import { PlanPage, ProposalSheet } from "./ProposalSheet";
import { SETTINGS_LIVE, SETTINGS_STOP, type LiveRun } from "./liveRun";
import { RunSheet } from "./RunSheet";

export const name = "Workflow proposal mockup";
export const note = "Mockup only: the proposal sheet with the plan as a document, a rail for the route and inputs, and every state of the shipped sheet";

/**
 * Real proposals copied from local sessions into local/ (ignored by Git), by file name. Absent on other machines.
 * `unzen-nzbfast-switch` is a stored proposal as its agent wrote it; `.rewritten` is the same plan rewritten
 * under prototypes/workflow-proposal-document/proposal-guidance.md.
 */
const local: Record<string, MockProposal> = Object.fromEntries(Object.entries(import.meta.glob<{ default: unknown }>("./local/*.json", { eager: true }))
  .flatMap(([path, module]) => {
    const parsed = workflowProposalSchema.pick({ name: true, summary: true, text: true, definition: true, inputs: true }).safeParse(module.default);
    return parsed.success ? [[path.replace(/^.*\//u, "").replace(/\.json$/u, ""), fromRecord(parsed.data)]] : [];
  }));
const ORIGINAL = "unzen-nzbfast-switch";
const REWRITTEN = "unzen-nzbfast-switch.rewritten";
const missing = <p style={{ padding: 24 }}>Copy a proposal record into ui/verification/proposal-mockups/local/ to see it here.</p>;
const real = (key: string, show: (proposal: MockProposal) => React.ReactNode) => { const proposal = local[key]; return proposal === undefined ? missing : show(proposal); };

/** The reader's route edits, as a function of the agent's route. */
const setModel = (stage: string, worker: string, model: string) => (stages: readonly WorkflowStage[]) => stages.map((s) => s.id !== stage ? s
  : withWorkers(s, (s.workers ?? []).map((w) => w.name === worker ? withModel(w, model) : w)));
const RESHAPED = (stages: readonly WorkflowStage[]): WorkflowStage[] => {
  const modelled = setModel("port", "api", "anthropic/claude-opus-4-5:high")(stages);
  const withScout = modelled.map((s) => s.id === "shape" ? withWorkers(s, [{ name: "scout", agent: "scout", model: "anthropic/claude-haiku-4-5" }]) : s);
  const at = withScout.findIndex((s) => s.id === "review") + 1;
  return [...withScout.slice(0, at), { id: "docs", name: "Docs", does: "This chat updates the settings docs to match the store." }, ...withScout.slice(at)];
};

export default function Review() { return <ProposalSheet />; }
export function RealOriginal() { return real(ORIGINAL, (p) => <ProposalSheet proposal={p} />); }
export function RealRewritten() { return real(REWRITTEN, (p) => <ProposalSheet proposal={p} />); }
export function RealOriginalAtTrial() { return real(ORIGINAL, (p) => <ProposalSheet proposal={p} at="trial" />); }
export function RealRewrittenAtTrial() { return real(REWRITTEN, (p) => <ProposalSheet proposal={p} at="trial" />); }
export function RealPlanOriginal() { return real(ORIGINAL, (p) => <PlanPage proposal={p} />); }
export function RealPlanRewritten() { return real(REWRITTEN, (p) => <PlanPage proposal={p} />); }
export function ModelChanged() { return <ProposalSheet route={setModel("port", "api", "anthropic/claude-opus-4-5:high")} />; }
export function RouteEditing() { return <ProposalSheet route={RESHAPED} editing />; }
export function RouteChanged() { return <ProposalSheet route={RESHAPED} />; }
export function RouteChangedAtShape() { return <ProposalSheet route={RESHAPED} at="shape" />; }
export function UpdateThePlan() { return <ProposalSheet route={RESHAPED} changing />; }
export function RealRewrittenEdited() { return real(REWRITTEN, (p) => <ProposalSheet proposal={p} editing
  route={(stages) => setModel("build", "build", "anthropic/claude-opus-4-5:high")(stages).map((s) => s.id === "recon"
    ? withWorkers(s, (s.workers ?? []).filter((w) => w.name !== "upstream-scout")) : s)} />); }
export function AtAStage() { return <ProposalSheet at="port" />; }
export function EditedInputs() { return <ProposalSheet edits={{ base: "next", rounds: "3" }} />; }
export function InputsOpen() { return <ProposalSheet inputsOpen edits={{ rounds: "3" }} />; }
export function Reading() { return <ProposalSheet read="reading" />; }
export function ReadFailed() { return <ProposalSheet read="failed" />; }
export function AnotherRunActive() { return <ProposalSheet blocked="Another workflow is running in this chat. Start this one when it ends." />; }
export function Starting() { return <ProposalSheet starting />; }
export function StartFailed() { return <ProposalSheet error="Another workflow run is active in this session." />; }
export function AskForChanges() { return <ProposalSheet changing />; }
export function ChangesSent() { return <ProposalSheet outcome={{ kind: "changes", note: CHANGES_NOTE }} />; }
export function Started() { return <ProposalSheet outcome={{ kind: "started" }} />; }
export function Dismissed() { return <ProposalSheet outcome={{ kind: "dismissed" }} />; }
export function Replaced() { return <ProposalSheet outcome={{ kind: "replaced" }} />; }
export function ProseOnly() { return <ProposalSheet proposal={FLAKY_HUNT} />; }

/** Run mode. The NZBFAST run is local only; the settings-store-port runs are fixtures. */
const nzbfast = Object.values(import.meta.glob<{ default: LiveRun }>("./local/*.run.ts", { eager: true }))[0]?.default;
const live = (show: (run: LiveRun) => React.ReactNode) => nzbfast === undefined ? missing : show(nzbfast);
export function RunStart() { return live((run) => <RunSheet run={run} />); }
export function RunPlan() { return live((run) => <RunSheet run={run} at="review" />); }
export function RunWorker() { return live((run) => <RunSheet run={run} select="review/build" />); }
export function RunWorkerModelChanged() { return live((run) => <RunSheet run={run} select="review/build" models={{ build: "anthropic/claude-opus-4-5:high" }} />); }
export function RunReviewer() { return live((run) => <RunSheet run={run} select="review/review" />); }
export function RunRetried() { return live((run) => <RunSheet run={run} select="recon/host-scout" />); }
export function RunSettingsWorking() { return <RunSheet run={SETTINGS_LIVE} select="port/api" />; }
export function RunSettingsStop() { return <RunSheet run={SETTINGS_STOP} />; }
