import { useState } from "react";
import { ActionCard } from "./ActionCard";
export const name = "Action card";
export default function Ready() { const [status, setStatus] = useState("Ready"); return <ActionCard title="Related item" detail="/a/long/path/to/a/related/item" actions={[{ label: "Inspect", onPress: () => setStatus("Inspected") }, { label: "Finish", onPress: () => setStatus("Finished") }]}><p>{status}</p></ActionCard>; }
export function Unavailable() { return <ActionCard title="Unavailable item" detail="The original location is no longer reachable." actions={[{ label: "Inspect", disabled: true, onPress: () => undefined }]} />; }
