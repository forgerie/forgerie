import { TriggerRuns } from "./TriggerRuns";
import { docs, nightly, notes, triage } from "./fixtures/triggers";
import { clock } from "./fixtures/scenario";

export const name = "Trigger runs";
export const note = "One row per run, newest first, with the session it opened";
export const composition = { default: [{ part: "src/ui/ActionRow.molecule.part.tsx", state: "default" }, { part: "src/ui/MarkStrip.atom.part.tsx", state: "default" }] };

/** Fourteen runs: the first ten show, the rest behind Show all. */
const LONG = { ...triage, history: [...triage.history, ...nightly.history] };
export default function Mixed() { return <TriggerRuns trigger={nightly} clock={clock} starting={false} onOpenSession={() => undefined} />; }
export function Long() { return <TriggerRuns trigger={LONG} clock={clock} starting={false} onOpenSession={() => undefined} />; }
export function NoRunsActive() { return <TriggerRuns trigger={notes} clock={clock} starting={false} onOpenSession={() => undefined} />; }
export function Paused() { return <TriggerRuns trigger={docs} clock={clock} starting={false} onOpenSession={() => undefined} />; }
