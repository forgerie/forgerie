import { useState } from "react";
import { FormLock } from "./FormLock";
import { ToggleGroup } from "./ToggleGroup";

export const name = "Form lock";
export const note = "Controls that lock together while a save is in flight";

export default function Open() {
  const [value, setValue] = useState<"day" | "days">("day");
  return <FormLock locked={false}>
    <ToggleGroup label="Repeat" value={value} onChange={setValue} options={[{ value: "day", label: "Every day" }, { value: "days", label: "Some days" }]} />
  </FormLock>;
}
export function Locked() {
  return <FormLock locked>
    <ToggleGroup label="Repeat" value="day" onChange={() => undefined} options={[{ value: "day", label: "Every day" }, { value: "days", label: "Some days" }]} />
  </FormLock>;
}
