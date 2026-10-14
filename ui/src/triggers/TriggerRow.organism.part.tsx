import { useState } from "react";
import type { Trigger } from "@shared/triggers";
import { TriggerRow } from "./TriggerRow";
import { triggersPlan } from "./triggersModel";
import { audit, digest, docs, everywhere, nightly, notes, spreadNotes, triage } from "./fixtures/triggers";
import { clock, projectLabel, rowActions } from "./fixtures/scenario";

export const name = "Trigger row";
export const note = "One trigger in the list: its marks, its last outcome, and its state action inline when wide";
export const composition = { default: [
  { part: "src/ui/RecordRow.molecule.part.tsx", state: "default" },
  { part: "src/ui/MarkStrip.atom.part.tsx", state: "default" },
] };

const WIDE = triggersPlan(672, 800, 800).row;
const NARROW = triggersPlan(320, 352, 735).row;

/** Mark as seen is a real handler: the mark and the inline action go once it is pressed. */
function Row({ trigger, plan = WIDE, starting = false }: { trigger: Trigger; plan?: typeof WIDE; starting?: boolean }) {
  const [shown, setShown] = useState(trigger);
  return <ul><TriggerRow trigger={shown} clock={clock} projectName={projectLabel} plan={plan} starting={starting}
    actions={{ ...rowActions, onAcknowledge: () => setShown({ ...shown, attention: null }), onResume: () => setShown({ ...shown, state: { kind: "active", nextFireAt: clock.now + 9 * 3_600_000 } }) }} /></ul>;
}

export default function Failed() { return <Row trigger={nightly} />; }
export function MissedByAgent() { return <Row trigger={audit} />; }
export function Active() { return <Row trigger={triage} />; }
export function NoRuns() { return <Row trigger={notes} />; }
export function Paused() { return <Row trigger={docs} />; }
export function Starting() { return <Row trigger={digest} />; }
export function StartingLocally() { return <Row trigger={notes} starting />; }
export function NarrowFailed() { return <Row trigger={nightly} plan={NARROW} />; }
export function SeveralProjects() { return <Row trigger={spreadNotes} />; }
export function AllProjectsPartlyFailed() { return <Row trigger={everywhere} />; }
export function NarrowAllProjects() { return <Row trigger={everywhere} plan={NARROW} />; }
