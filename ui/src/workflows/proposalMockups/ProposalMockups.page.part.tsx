import { workflowProposalSchema } from "../workflowsModel";
import { CHANGES_NOTE, FLAKY_HUNT, fromRecord } from "./planDocument";
import { ProposalSheet } from "./ProposalSheet";

export const name = "Workflow proposal mockup";
export const note = "Mockup only: the proposal sheet with the plan as a document, a rail for the route and inputs, and every state of the shipped sheet";

/** Real proposals copied from local sessions into local/ (ignored by Git). Absent on other machines. */
const local = Object.values(import.meta.glob<{ default: unknown }>("./local/*.json", { eager: true }))
  .map((module) => workflowProposalSchema.pick({ name: true, summary: true, text: true, definition: true, inputs: true }).safeParse(module.default))
  .flatMap((parsed) => parsed.success ? [fromRecord(parsed.data)] : []);

export default function Review() { return <ProposalSheet />; }
export function RealProposal() { return local[0] === undefined ? <p style={{ padding: 24 }}>Copy a proposal record into proposalMockups/local/ to see it here.</p>
  : <ProposalSheet proposal={local[0]} />; }
export function RealProposalAtTrial() { return local[0] === undefined ? null : <ProposalSheet proposal={local[0]} at="trial" />; }
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
