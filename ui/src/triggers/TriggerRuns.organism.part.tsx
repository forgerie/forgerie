import type { StateChecks } from "@simonwjackson/caliper/checks";
import { TriggerRuns } from "./TriggerRuns";
import { docs, everywhere, nightly, notes, spreadNotes, triage } from "./fixtures/triggers";
import { clock, projectLabel } from "./fixtures/scenario";

export const name = "Trigger runs";
export const note = "One row per run, newest first, with the session it opened";
export const composition = {
  default: [{ part: "src/ui/ActionRow.molecule.part.tsx", state: "default" }, { part: "src/ui/MarkStrip.atom.part.tsx", state: "default" }],
  AllProjects: [{ part: "src/triggers/FireProjects.organism.part.tsx", state: "default" }],
};

export const checks = {
  AllProjects: {
    "Projects opens each project's outcome under its run": async ({ canvas, input, expect }) => {
      await input.click(canvas.getAllByRole("button", { name: "Projects" })[0]!);
      expect(canvas.getByRole("list", { name: "Outcome in each project" })).toBeVisible();
      expect(canvas.getByText("Unavailable")).toBeVisible();
    },
  },
  AllProjectsNarrow: {
    "Projects opens each project's outcome under its run, stacked": async ({ canvas, input, expect }) => {
      await input.click(canvas.getAllByRole("button", { name: "Projects" })[0]!);
      expect(canvas.getByRole("list", { name: "Outcome in each project" })).toBeVisible();
    },
  },
} satisfies StateChecks;

/** Fourteen runs: the first ten show, the rest behind Show all. */
const LONG = { ...triage, history: [...triage.history, ...nightly.history] };
export default function Mixed() { return <TriggerRuns trigger={nightly} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function Long() { return <TriggerRuns trigger={LONG} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function NoRunsActive() { return <TriggerRuns trigger={notes} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function Paused() { return <TriggerRuns trigger={docs} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function SeveralProjects() { return <TriggerRuns trigger={spreadNotes} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function AllProjects() { return <TriggerRuns trigger={everywhere} clock={clock} starting={false} projectName={projectLabel} onOpenSession={() => undefined} />; }
export function AllProjectsNarrow() { return <TriggerRuns trigger={everywhere} clock={clock} starting={false} narrow projectName={projectLabel} onOpenSession={() => undefined} />; }
