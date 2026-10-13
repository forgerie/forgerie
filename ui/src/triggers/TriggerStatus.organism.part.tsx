import { TriggerStatus } from "./TriggerStatus";
import { audit, digest, docs, nightly, notes } from "./fixtures/triggers";
import { clock } from "./fixtures/scenario";

export const name = "Trigger status";
export const note = "When the trigger runs next, or would if resumed; how its last run went; who made it";
export const composition = { default: [{ part: "src/ui/ReadoutLine.molecule.part.tsx", state: "default" }] };

const none = () => undefined;
export default function Active() { return <TriggerStatus trigger={nightly} clock={clock} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function Paused() { return <TriggerStatus trigger={docs} clock={clock} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function ByAgent() { return <TriggerStatus trigger={audit} clock={clock} starting={false} creatorName="Lockfile review" onPause={none} onResume={none} onOpenSession={none} />; }
export function Starting() { return <TriggerStatus trigger={digest} clock={clock} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function NoRuns() { return <TriggerStatus trigger={notes} clock={clock} starting onPause={none} onResume={none} onOpenSession={none} />; }
