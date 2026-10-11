import { OptionList } from "../ui/OptionList";
import { SheetDialog } from "../ui/SheetDialog";
import type { SavedWorkflow } from "./workflowsModel";

/**
 * Shape: the saved workflows this session can start. Choosing one opens its
 * plan. A file that cannot be read is listed with the reason, not hidden.
 */
export function WorkflowPicker({ saved, broken = [], loading, error, onChoose, onClose }: {
  saved: readonly SavedWorkflow[];
  broken?: readonly { name: string; error: string }[];
  loading: boolean;
  error?: string | undefined;
  onChoose: (name: string) => void;
  onClose: () => void;
}) {
  const options = saved.map((workflow) => {
    const stops = (workflow.definition.stages ?? []).filter((stage) => stage.stop !== undefined).map((stage) => stage.name);
    const stages = workflow.definition.stages?.length ?? 0;
    return { id: workflow.name, name: workflow.name, details: [
      ...(workflow.description === undefined ? [] : [workflow.description]),
      stages === 0 ? "Prose only, no stages" : `${String(stages)} stages${stops.length === 0 ? "" : `; you decide at ${stops.join(" and ")}`}`,
    ] };
  });
  const unreadable = broken.map((file) => ({ id: `broken:${file.name}`, name: file.name, details: [file.error], blocked: true, tone: "faint" as const }));
  return <SheetDialog title="Workflows" subtitle="Saved in this project and your profile" closeLabel="Close workflows" onClose={onClose}>
    <OptionList label="Saved workflows" input={{ type: "focus", onChoose: (id) => { if (!id.startsWith("broken:")) onChoose(id); } }}
      groups={[{ key: "saved", options }, ...(unreadable.length === 0 ? [] : [{ key: "broken", label: "Cannot be read", options: unreadable }])]}
      alert={error}
      status={loading ? { tone: "status", text: "Reading saved workflows…" }
        : options.length === 0 && unreadable.length === 0 ? { tone: "status", text: "No saved workflows. A prompt file with workflow frontmatter appears here." } : undefined} />
  </SheetDialog>;
}
