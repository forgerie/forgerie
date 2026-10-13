import { useState } from "react";
import { TimeField } from "./TimeField";

export const name = "Time field";
export const note = "A time of day, typed or picked, in the reader's locale";

export default function Night() {
  const [value, setValue] = useState("03:00");
  return <label>Run at <TimeField label="Time" value={value} onChange={setValue} /></label>;
}
