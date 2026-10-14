import { useState } from "react";
import { FieldEdit } from "./FieldEdit";
import { NumberField } from "./NumberField";

export const name = "Field edit";
export const note = "A changed field says Edited and offers a reset, without a pill or box";
export const composition = { default: [{ part: "src/ui/NumberField.atom.part.tsx", state: "default" }] };
export default function Edited() {
  const [value, setValue] = useState("3");
  return <FieldEdit reset={value === "2" ? undefined : { label: "Use the agent's", title: "Reset Review rounds", onPress: () => setValue("2") }}>
    <NumberField label="Review rounds" value={value} onChange={setValue} />
  </FieldEdit>;
}
