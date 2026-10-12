import { TextAreaField } from "../ui/TextAreaField";
import { ToggleGroup } from "../ui/ToggleGroup";
import type { WorkflowInput } from "./workflowsModel";

/**
 * Shape: a workflow's inputs as fields, in the order given. A yes-or-no input
 * or one with choices is a toggle group; any other is a text box, four lines
 * for the task and one for the rest. Values are text until the launch reads them.
 */
export function WorkflowInputFields({ inputs, values, onChange }: {
  inputs: readonly (readonly [string, WorkflowInput])[];
  values: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
}) {
  return <>{inputs.map(([name, input]) => input.type === "boolean" || input.choices !== undefined
    ? <ToggleGroup key={name} field label={input.description ?? name} value={values[name] ?? ""} onChange={(value) => onChange(name, value)}
      options={(input.choices ?? [true, false]).map((choice) => ({ value: String(choice), label: input.type === "boolean" ? (choice === true ? "Yes" : "No") : String(choice) }))} />
    : <TextAreaField key={name} label={name === "task" ? "Task" : name} value={values[name] ?? ""} onChange={(value) => onChange(name, value)}
      rows={name === "task" ? 4 : 1} hint={input.description} />)}</>;
}
