import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { HeaderButton } from "./HeaderButton";

export const name = "Header button";
export const note = "A page header's one main action";

export default function Ready() {
  const [count, setCount] = useState(0);
  return <HeaderButton label={count ? `Pressed ${String(count)}` : "New item"} icon={<PlusIcon aria-hidden />} onPress={() => setCount(count + 1)} />;
}
export function Disabled() { return <HeaderButton label="Save" disabled />; }
export function Plain() { return <HeaderButton label="Run now…" tone="plain" />; }
