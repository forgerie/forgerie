import { useState } from "react";
import { ActionButton } from "./ActionButton";
export const name = "Action button";
export default function Ready() { const [pressed, setPressed] = useState(false); return <ActionButton label={pressed ? "Opened" : "Open related items"} onPress={() => setPressed(true)} />; }
export function Disabled() { return <ActionButton label="Preparing…" disabled onPress={() => undefined} />; }
