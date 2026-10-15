import { TriggerStatus } from "./TriggerStatus";
import { audit, digest, docs, everywhere, nightly, notes, spreadNotes } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";

export const name = "Trigger status";
export const note = "When the trigger runs next, or would if resumed; how its last run went; who made it";
export const composition = {
  default: [{ part: "src/ui/ReadoutLine.molecule.part.tsx", state: "default" }],
  AllProjectsPartlyFailed: [{ part: "src/triggers/FireProjects.organism.part.tsx", state: "default" }],
};

const none = () => undefined;
export default function Active() { return <TriggerStatus trigger={nightly} clock={clock} projectName={projectLabel} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function Paused() { return <TriggerStatus trigger={docs} clock={clock} projectName={projectLabel} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function ByAgent() { return <TriggerStatus trigger={audit} clock={clock} projectName={projectLabel} starting={false} creatorName="Lockfile review" onPause={none} onResume={none} onOpenSession={none} />; }
export function Starting() { return <TriggerStatus trigger={digest} clock={clock} projectName={projectLabel} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function NoRuns() { return <TriggerStatus trigger={notes} clock={clock} projectName={projectLabel} starting onPause={none} onResume={none} onOpenSession={none} />; }
export function SeveralProjects() { return <TriggerStatus trigger={spreadNotes} clock={clock} projectName={projectLabel} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function AllProjectsPartlyFailed() { return <TriggerStatus trigger={everywhere} clock={clock} projectName={projectLabel} starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
export function AllProjectsNarrow() { return <TriggerStatus trigger={everywhere} clock={clock} projectName={projectLabel} narrow starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
/** As a workflow file's head: the strip leads the last run, the projects stay in Runs, and no pause on the line. */
export function AsHead() { return <TriggerStatus trigger={everywhere} clock={clock} projectName={projectLabel} variant="head" starting={false} onPause={none} onResume={none} onOpenSession={none} />; }
