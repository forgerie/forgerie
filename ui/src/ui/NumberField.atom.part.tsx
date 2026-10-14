import { useState } from "react";
import { NumberField } from "./NumberField";

export const name = "Number field";
export const note = "An editable number with touch-sized decrease and increase buttons; no assumed minimum";
export default function Editable() {
  const [value, setValue] = useState("2");
  return <NumberField label="Review rounds" value={value} onChange={setValue} />;
}
export function Empty() {
  const [value, setValue] = useState("");
  return <NumberField label="Trial port" value={value} onChange={setValue} />;
}
