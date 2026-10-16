import { useState } from "react";
import { OptionList, type OptionGroup } from "../ui/OptionList";
import { SheetDialog } from "../ui/SheetDialog";
import { StageMarks } from "../ui/StageMarks";
import type { SavedWorkflow } from "./workflowsModel";
import { matchesWorkflow, routeOf, routeSummary, workflowSource } from "./workflowPickerModel";

/** Under this many saved workflows the list fits a glance, and a filter field would only take room. */
const FILTER_FROM = 5;

/**
 * Shape: the saved workflows this session can start, grouped by where the file lives. Each row names the workflow,
 * says what it does, sums its route in words, and draws it in tally marks: an outlined mark per agent a stage will
 * start, and a ringed mark where the reader decides. Choosing one opens its plan. With many saved, a field
 * filters by name, description, or stage. A file that cannot be read is listed with the reason, not hidden.
 */
export function WorkflowPicker({ saved, broken = [], loading, error, onChoose, onClose }: {
  saved: readonly SavedWorkflow[];
  broken?: readonly { name: string; error: string }[];
  loading: boolean;
  error?: string | undefined;
  onChoose: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = saved.filter((workflow) => matchesWorkflow(workflow, query));
  const option = (workflow: SavedWorkflow) => {
    const route = routeOf(workflow);
    return { id: workflow.name, name: workflow.name, details: [...(workflow.description === undefined ? [] : [workflow.description]), routeSummary(route)],
      ...(route.length > 0 ? { below: <StageMarks stages={route.map((stage) => ({ name: stage.name, marks: stage.agents, stop: stage.stop }))} /> } : {}) };
  };
  const group = (key: "project" | "profile", label: string): OptionGroup[] => {
    const options = shown.filter((workflow) => workflowSource(workflow.path) === key).map(option);
    return options.length === 0 ? [] : [{ key, label: `${label} (${String(options.length)})`, options }];
  };
  const unreadable = query.trim() === "" ? broken.map((file) => ({ id: `broken:${file.name}`, name: file.name, details: [file.error], blocked: true, tone: "faint" as const })) : [];
  const groups = [...group("project", "This project"), ...group("profile", "Your profile"),
    ...(unreadable.length === 0 ? [] : [{ key: "broken", label: `Cannot be read (${String(unreadable.length)})`, options: unreadable }])];
  const count = saved.length === 0 ? undefined : `${String(saved.length)} saved`;
  return <SheetDialog title="Workflows" subtitle={count ?? "Saved in this project and your profile"} closeLabel="Close workflows" onClose={onClose}>
    <OptionList label="Saved workflows" input={{ type: "focus", onChoose: (id) => { if (!id.startsWith("broken:")) onChoose(id); } }}
        groups={groups} alert={error}
        search={saved.length >= FILTER_FROM ? { value: query, onChange: setQuery, label: "Filter workflows", placeholder: "Filter by name or stage" } : undefined}
        status={loading ? { tone: "status", text: "Reading saved workflows…" }
          : saved.length === 0 && broken.length === 0 ? { tone: "status", text: "No saved workflows. A prompt file with workflow frontmatter appears here." }
          : shown.length === 0 && query.trim() !== "" ? { tone: "status", text: `No saved workflow matches \u201c${query.trim()}\u201d.` } : undefined} />
  </SheetDialog>;
}
