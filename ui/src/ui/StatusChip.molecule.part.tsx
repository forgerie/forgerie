import { useState } from "react";
import { AlertCard } from "./AlertCard";
import { StatusChip } from "./StatusChip";

export const name = "Status chip";
export const note = "A header's status word; with more to say it opens a panel";

export default function Live() {
  return <StatusChip label="Running" tone="live" />;
}
export function Quiet() {
  return <StatusChip label="Connected" tone="quiet" />;
}
export function Neutral() {
  return <StatusChip label="Connecting" tone="neutral" />;
}
export function Waiting() {
  return <StatusChip label="Waiting for you" tone="attention" />;
}
export function WithDetail() {
  return <StatusChip label="Reconnecting" tone="warn" panel={{ title: "Reconnecting", children:
    <AlertCard label="Connection lost" tone="warn" title="The live connection dropped" actions={[{ label: "Try now", onPress: () => undefined }]}>
      Live connection timed out. Try <strong>4</strong> starts in 3 s.
    </AlertCard> }} />;
}
export function Counted() {
  const [count, setCount] = useState(2);
  return <StatusChip label="Running" tone="live" count={count} countLabel={`${String(count)} problems`} ring={count}
    panel={count === 0 ? undefined : { title: `${String(count)} problems`, actions: [{ label: "Dismiss all", onPress: () => setCount(0) }], children:
      <AlertCard label="Problem" title="Pi reported an error" time="14:06" actions={[{ label: "Dismiss", onPress: () => setCount(count - 1) }]}>
        529 overloaded_error: Overloaded
      </AlertCard> }} />;
}
export function Bad() {
  return <StatusChip label="Problem" tone="bad" ring={1} panel={{ title: "1 problem", children:
    <AlertCard label="Problem" title="Command failed" time="14:05">Unknown command: /bad</AlertCard> }} />;
}
