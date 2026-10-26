import { useState } from "react";
import { TextField } from "./TextField";
export const name = "Text field";
export default function Ready() { const [value, setValue] = useState("/home/reader/code"); return <TextField aria-label="Path" value={value} onChange={(event) => setValue(event.target.value)} />; }
export function Empty() { return <TextField aria-label="Path" placeholder="/path/to/repository" />; }
export function Disabled() { return <TextField aria-label="Path" value="/home/reader/code" disabled />; }
