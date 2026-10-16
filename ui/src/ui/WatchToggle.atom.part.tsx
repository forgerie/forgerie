import { useState } from "react";
import { WatchToggle } from "./WatchToggle";

export const name = "Watch toggle";
export const note = "Whether something is watched: a pressed eye chip with a count while on";

function Toggle({ initial, count, disabled }: { initial: boolean; count?: number; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  return <WatchToggle on={on} text={on ? "Watching" : "Watch"} what={`run ${"#"}4812`}
    count={count} countText="wakes" disabled={disabled} onPress={() => setOn(!on)} />;
}
export default function Off() { return <Toggle initial={false} />; }
export function On() { return <Toggle initial count={0} />; }
export function OnWithWakes() { return <Toggle initial count={12} />; }
export function Disabled() { return <Toggle initial={false} disabled />; }
