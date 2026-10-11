import { useState } from "react";
import { TextAreaField } from "./TextAreaField";

export const name = "Text area field";
export const note = "A labelled box for a few lines of prose, with a hint under it";

export default function Filled() {
  const [value, setValue] = useState("Export run history as CSV: one endpoint and an Export button with empty and error states.");
  return <TextAreaField label="Task" value={value} onChange={setValue} hint="The agent reads this as the workflow's task." />;
}
export function Empty() {
  const [value, setValue] = useState("");
  return <TextAreaField label="Task" value={value} onChange={setValue} placeholder="What should the workflow do?" />;
}
