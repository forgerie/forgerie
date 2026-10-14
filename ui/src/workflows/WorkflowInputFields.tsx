import { FieldEdit } from "../ui/FieldEdit";
import { NumberField } from "../ui/NumberField";
import { TextAreaField } from "../ui/TextAreaField";
import { ToggleGroup } from "../ui/ToggleGroup";
import { workflowInputLabel } from "./workflowInputLabel";
import type { WorkflowInput } from "./workflowsModel";

/** Shape: typed workflow inputs, with readable labels and a way to undo each changed value. */
export function WorkflowInputFields({ inputs, values, onChange, reset }: {
  inputs: readonly (readonly [string, WorkflowInput])[];
  values: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
  reset?: { values: Readonly<Record<string, string>>; label: string; onReset: (name: string) => void } | undefined;
}) {
  return <>{inputs.map(([name, input]) => {
    const label = workflowInputLabel(name, input.description);
    const value = values[name] ?? "";
    const onEdit = (next: string) => onChange(name, next);
    const changed = reset !== undefined && value !== (reset.values[name] ?? "");
    return <FieldEdit key={name} reset={changed ? { label: reset.label, title: `Reset ${label}`, onPress: () => reset.onReset(name) } : undefined}>
      {input.type === "boolean" || input.choices !== undefined
        ? <ToggleGroup field label={label} value={value} onChange={onEdit}
          options={(input.choices ?? [true, false]).map((choice) => ({ value: String(choice), label: input.type === "boolean" ? (choice === true ? "Yes" : "No") : String(choice) }))} />
        : input.type === "number" ? <NumberField label={label} value={value} onChange={onEdit} />
          : <TextAreaField label={label} value={value} onChange={onEdit} rows={name === "task" ? 4 : 1} />}
    </FieldEdit>;
  })}</>;
}
