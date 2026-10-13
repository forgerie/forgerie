import { CHANGES_NOTE, FLAKY_HUNT } from "./planDocument";
import { ProposalSheet } from "./ProposalSheet";

export const name = "Workflow proposal mockup";
export const note = "Mockup only: the proposal sheet with the plan as a document, a rail for the route and inputs, and every state of the shipped sheet";

export default function Review() { return <ProposalSheet />; }
export function AtAStage() { return <ProposalSheet at="port" />; }
export function EditedInputs() { return <ProposalSheet edits={{ base: "next", rounds: 3 }} />; }
export function InputsOpen() { return <ProposalSheet inputsOpen edits={{ rounds: 3 }} />; }
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
