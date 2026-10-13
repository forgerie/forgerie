import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { BacklogSourceSettings, NO_DESTINATION, type SourceDraft, type SourceProblems } from "./BacklogSourceSettings";
import { missingDestinationSource, overlapMessage, projects, routedSource } from "./fixtures/backlogSources";

export const name = "BacklogSourceSettings";
export const note = "One Azure DevOps board as a backlog source: its board and the project its sessions start in";
export const checks = {
  default: {
    "Add source waits for an organization and an Azure project": async ({ canvas, input, expect }) => {
      expect(canvas.getByRole("button", { name: "Add source" })).toBeDisabled();
      await input.type(canvas.getByRole("textbox", { name: "Organization" }), "contoso");
      await input.type(canvas.getByRole("textbox", { name: "Azure project" }), "Fabrikam Web");
      expect(canvas.getByRole("button", { name: "Add source" })).toBeEnabled();
    },
  },
} satisfies StateChecks;

const draftOf = (source: typeof routedSource): SourceDraft => ({ organization: source.organization, project: source.project, areaPath: source.areaPath ?? "",
  destination: source.destinationProjectId ?? NO_DESTINATION });
function Stateful({ start, fresh, error, problems = {} }: { start: SourceDraft; fresh: boolean; error?: string; problems?: SourceProblems }) {
  const [draft, setDraft] = useState(start);
  const [deleted, setDeleted] = useState(false);
  const missing = !projects.some((project) => project.id === draft.destination) && draft.destination !== NO_DESTINATION;
  const shown: SourceProblems = { ...problems, ...(missing ? { destination: "This project is no longer registered. Choose another project, or None." } : {}) };
  return <BacklogSourceSettings fresh={fresh} title={fresh ? "New Azure DevOps source" : start.project} back={null} close={null} busy={false}
    error={deleted ? "Deleted. The list no longer shows this source." : error} recovery={error ? <button type="button">Reload</button> : undefined}
    draft={draft} problems={shown} projects={projects} valid={Boolean(draft.organization && draft.project) && !missing && !error}
    onDraft={setDraft} onSave={() => undefined} onDelete={() => setDeleted(true)} />;
}
export default function New() { return <Stateful fresh start={{ organization: "", project: "", areaPath: "", destination: NO_DESTINATION }} />; }
export function Edit() { return <Stateful fresh={false} start={draftOf(routedSource)} />; }
export function OverlapError() {
  return <Stateful fresh start={{ organization: "contoso", project: "Fabrikam Web", areaPath: "Fabrikam Web\\Checkout", destination: NO_DESTINATION }} error={overlapMessage} />;
}
export function MissingDestinationProject() { return <Stateful fresh={false} start={draftOf(missingDestinationSource)} />; }
