import { workflowProposalSchema } from "../workflowsModel";
import { CHANGES_NOTE, FLAKY_HUNT, fromRecord, type MockProposal } from "./planDocument";
import { PlanPage, ProposalSheet } from "./ProposalSheet";

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
const missing = <p style={{ padding: 24 }}>Copy a proposal record into proposalMockups/local/ to see it here.</p>;
const real = (key: string, show: (proposal: MockProposal) => React.ReactNode) => { const proposal = local[key]; return proposal === undefined ? missing : show(proposal); };

export default function Review() { return <ProposalSheet />; }
export function RealOriginal() { return real(ORIGINAL, (p) => <ProposalSheet proposal={p} />); }
export function RealRewritten() { return real(REWRITTEN, (p) => <ProposalSheet proposal={p} />); }
export function RealOriginalAtTrial() { return real(ORIGINAL, (p) => <ProposalSheet proposal={p} at="trial" />); }
export function RealRewrittenAtTrial() { return real(REWRITTEN, (p) => <ProposalSheet proposal={p} at="trial" />); }
export function RealPlanOriginal() { return real(ORIGINAL, (p) => <PlanPage proposal={p} />); }
export function RealPlanRewritten() { return real(REWRITTEN, (p) => <PlanPage proposal={p} />); }
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
