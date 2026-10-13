import { useState } from "react";
import { ToggleGroup } from "./ToggleGroup";

export const name = "Toggle group";
export const note = "A few choices of one setting, one pressed at a time, or any number pressed";

export default function Lists() {
  const [value, setValue] = useState<"changes" | "files">("changes");
  return <ToggleGroup label="Files to list" value={value} onChange={setValue}
    options={[{ value: "changes", label: "Changes", count: 4 }, { value: "files", label: "All files" }]} />;
}
export function ManyChoices() {
  const [value, setValue] = useState("all");
  return <ToggleGroup label="Show entries" value={value} onChange={setValue}
    options={[{ value: "default", label: "Default" }, { value: "no-tools", label: "No tools" }, { value: "user-only", label: "User only" },
      { value: "labeled", label: "Labeled only" }, { value: "all", label: "All" }]} />;
}
export function FormField() {
  const [value, setValue] = useState("main");
  return <ToggleGroup field label="Branch to land on" value={value} onChange={setValue}
    options={[{ value: "main", label: "main" }, { value: "next", label: "next" }]} />;
}
export function OneUnavailable() {
  const [value, setValue] = useState<"rich" | "source">("source");
  return <ToggleGroup label="View" value={value} onChange={setValue}
    options={[{ value: "rich", label: "Rich", disabled: true, title: "Too large for the rich view." }, { value: "source", label: "Source" }]} />;
}
/** Any number pressed, such as the days a schedule runs on; the buttons wrap when the row is narrow. */
export function SeveralPressed() {
  const [value, setValue] = useState<string[]>(["mon", "wed", "fri"]);
  return <ToggleGroup multiple label="Days" value={value} onChange={setValue}
    options={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({ value: day.toLowerCase(), label: day }))} />;
}
