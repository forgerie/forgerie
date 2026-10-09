import { useState } from "react";
import { TitleField } from "./TitleField";

export const name = "Title field";
export const note = "A document title, typed in place";

export default function Named() {
  const [value, setValue] = useState("Garden plans");
  return <TitleField label="List name" placeholder="Name the list" value={value} onChange={setValue} hint="Choose the folders this list shows." />;
}
export function Empty() {
  const [value, setValue] = useState("");
  return <TitleField label="List name" placeholder="Name the list" value={value} onChange={setValue} hint="Choose the folders this list shows." />;
}
