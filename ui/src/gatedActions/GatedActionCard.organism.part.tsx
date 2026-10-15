import { useEffect, useState } from "react";
import { GatedActionCard } from "./GatedActionCard";
import { PinnedDock } from "../ui/PinnedDock";
import type { GatedAction, GatedChoice, GatedActionEntry } from "./gatedActionsModel";
import {
  PUSH, PUSH_ENTRY, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, PUSH_UNKNOWN, REPLY, REPLY_ENTRY, RESET, RESET_ENTRY,
  RISK_CHECK, RISK_DANGER, RISK_LOW,
} from "./fixtures/gatedActions";

export const name = "Gated action card";
export const note = "A call Forgerie holds until you approve it: the exact command, its category and who asked, with Refuse and Approve and run; it closes to one line once decided";

/** Real handlers on local state: Approve starts the run, Refuse closes the card; a refusal from the server stays on the card. */
function Deciding({ entry, record, refusal }: { entry: GatedActionEntry; record: GatedAction; refusal?: string }) {
  const [current, setCurrent] = useState(record);
  const [problem, setProblem] = useState<string>();
  const decide = (choice: GatedChoice) => {
    if (refusal !== undefined) { setProblem(refusal); return; }
    setCurrent({ ...current, state: { kind: choice === "approve" ? "approved" : "refused" } });
  };
  return <GatedActionCard entry={entry} record={current} read problem={problem}
    onApprove={() => decide("approve")} onRefuse={() => decide("refuse")} />;
}

export default function Waiting() { return <Deciding entry={PUSH_ENTRY} record={PUSH} />; }
export function LongCommand() { return <Deciding entry={RESET_ENTRY} record={RESET} />; }
export function MessageInYourName() { return <Deciding entry={REPLY_ENTRY} record={REPLY} />; }
export function Approving() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH} read deciding="approve" onApprove={() => {}} onRefuse={() => {}} />; }
export function ChoiceFailed() {
  return <GatedActionCard entry={PUSH_ENTRY} record={PUSH} read problem="The server did not answer in time. Nothing ran, and the action still waits."
    onApprove={() => {}} onRefuse={() => {}} />;
}
/** Approve here fails as the server would, and the reason stays on the open card. */
export function ChoiceRefusedByServer() {
  return <Deciding entry={PUSH_ENTRY} record={PUSH} refusal="This action is not waiting." />;
}
export function Running() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH_RUNNING} read onApprove={() => {}} onRefuse={() => {}} />; }
export function Ran() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH_RAN} read onApprove={() => {}} onRefuse={() => {}} />; }
export function Failed() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH_FAILED} read onApprove={() => {}} onRefuse={() => {}} />; }
export function OutcomeUnknown() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH_UNKNOWN} read onApprove={() => {}} onRefuse={() => {}} />; }
export function Refused() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH_REFUSED} read onApprove={() => {}} onRefuse={() => {}} />; }
export function ReadOnly() { return <GatedActionCard entry={PUSH_ENTRY} record={PUSH} read />; }
export function Gone() { return <GatedActionCard entry={PUSH_ENTRY} read onApprove={() => {}} onRefuse={() => {}} />; }
/** As the session pins it above the composer. In a short container the choices sit beside the title. */
export function Pinned() {
  return <PinnedDock label="1 waiting for you"><Deciding entry={PUSH_ENTRY} record={PUSH} /></PinnedDock>;
}
/** A long command pinned: in a short container the choices still show first. */
export function PinnedLongCommand() {
  return <PinnedDock label="1 waiting for you"><Deciding entry={RESET_ENTRY} record={RESET} /></PinnedDock>;
}
/** A risk opinion of low: muted and neutral, never a clearance. */
export function RiskLow() { return <Deciding entry={PUSH_ENTRY} record={{ ...PUSH, riskLabel: RISK_LOW }} />; }
/** A risk opinion that draws the eye, with the signal that was raised. */
export function RiskCheck() { return <Deciding entry={REPLY_ENTRY} record={{ ...REPLY, riskLabel: RISK_CHECK }} />; }
/** A risk opinion that warns, with every raised signal named. */
export function RiskDanger() { return <Deciding entry={RESET_ENTRY} record={{ ...RESET, riskLabel: RISK_DANGER }} />; }
/** The opinion arrives a moment after the card, as it does from the gateway: it fades in above the choices, which keep their place. */
export function RiskArrives() {
  const [record, setRecord] = useState(RESET);
  useEffect(() => { const timer = setTimeout(() => setRecord((current) => ({ ...current, riskLabel: RISK_DANGER })), 1500); return () => clearTimeout(timer); }, []);
  return <GatedActionCard entry={RESET_ENTRY} record={record} read
    onApprove={() => setRecord({ ...record, state: { kind: "approved" } })} onRefuse={() => setRecord({ ...record, state: { kind: "refused" } })} />;
}
/** Pinned in a short container: the opinion follows the choices, so its arrival never moves them. */
export function PinnedRiskDanger() {
  return <PinnedDock label="1 waiting for you"><Deciding entry={RESET_ENTRY} record={{ ...RESET, riskLabel: RISK_DANGER }} /></PinnedDock>;
}
/** Decided: the opinion stays with the record of what happened. */
export function RefusedWithRisk() {
  return <GatedActionCard entry={PUSH_ENTRY} record={{ ...PUSH_REFUSED, riskLabel: RISK_CHECK }} read onApprove={() => {}} onRefuse={() => {}} />;
}
