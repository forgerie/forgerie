import type { TriggerFire } from "@shared/triggers";
import { FireProjects } from "./FireProjects";
import { everywhere, FORGERIE, NO_FOLDER, spreadNotes } from "./fixtures/triggers";
import { projectLabel } from "./fixtures/scenario";

export const name = "Fire projects";
export const note = "One fire's outcome in each project, failures first and unavailable projects quiet, each session one press away";
export const composition = { default: [{ part: "src/ui/NestedRows.molecule.part.tsx", state: "default" }, { part: "src/ui/ActionRow.molecule.part.tsx", state: "QuietAndBelow" }] };

const latest = (fire: TriggerFire | undefined): TriggerFire => fire ?? { occurrence: 0, requestId: "none", cause: "schedule", recordedAt: 0, skippedBefore: 0, outcome: { kind: "missed" }, projects: [] };
/** Eleven projects, so the list stops at six and offers the rest. */
const MANY: TriggerFire = { ...latest(everywhere.history[0]), projects: [
  ...latest(everywhere.history[0]).projects,
  ...["notes-site", "photos", "recipes", "garden", "letters", "maps", "dotfiles"].map((name, index) => index === 3
    ? { cwd: `/home/simonwjackson/code/${name}`, outcome: { kind: "unavailable" as const, reason: NO_FOLDER } }
    : { cwd: `/home/simonwjackson/code/${name}`, outcome: { kind: "started" as const, sessionId: `01a29${String(index)}00-0000-7000-8000-000000000000`, runId: `run-9${String(index)}` } }),
] };
const STARTING: TriggerFire = { ...latest(spreadNotes.history[0]), outcome: { kind: "running", startedAt: 0 },
  projects: latest(spreadNotes.history[0]).projects.map((item) => item.cwd === FORGERIE ? item : { cwd: item.cwd, outcome: { kind: "running", startedAt: 0 } }) };

export default function PartlyFailed() { return <FireProjects fire={latest(everywhere.history[0])} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function AllStarted() { return <FireProjects fire={latest(spreadNotes.history[0])} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function Starting() { return <FireProjects fire={STARTING} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function Narrow() { return <FireProjects fire={latest(everywhere.history[0])} projectName={projectLabel} narrow onOpenSession={() => undefined} />; }
export function Many() { return <FireProjects fire={MANY} projectName={projectLabel} onOpenSession={() => undefined} />; }
