import { useState } from "react";
import { TextSubmit } from "./TextSubmit";
export const name = "Text submit";
export default function Ready() { const [label, setLabel] = useState("Existing directory"); return <TextSubmit label={label} action="Add" placeholder="/path/to/directory" pending={false} onSubmit={async (value) => setLabel(`Added ${value}`)} />; }
export function Pending() { return <TextSubmit label="Existing directory" action="Adding…" placeholder="/path/to/directory" pending onSubmit={async () => undefined} />; }
