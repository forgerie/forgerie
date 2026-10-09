import { useState } from "react";
import { PaperclipIcon, PlusIcon } from "lucide-react";
import { SplitButton } from "./SplitButton";

export const name = "Split button";
export const note = "An action and the one setting that changes what it does, in one chip";

type Mode = "inline" | "folder";
const options = [
  { value: "inline", label: "Inline", details: ["The model sees the image"] },
  { value: "folder", label: "As files", details: ["Saved in the workspace"] },
] as const;

export default function WithSetting() {
  const [mode, setMode] = useState<Mode>("inline");
  const [count, setCount] = useState(0);
  return <SplitButton icon={<PaperclipIcon aria-hidden size={14} />} label={count ? `Attach (${count})` : "Attach"} onPress={() => setCount(count + 1)}
    setting={{ label: "Send images", value: mode, options, onChange: setMode }} />;
}
export function ActionAlone() {
  return <SplitButton icon={<PaperclipIcon aria-hidden size={14} />} label="Attach" onPress={() => undefined} />;
}
export function Compact() {
  const [mode, setMode] = useState<Mode>("folder");
  return <SplitButton compact icon={<PlusIcon aria-hidden size={16} />} label="Add attachment" onPress={() => undefined}
    setting={{ label: "Send images", value: mode, options, onChange: setMode }} />;
}
export function SettingLocked() {
  return <SplitButton icon={<PaperclipIcon aria-hidden size={14} />} label="Attach" onPress={() => undefined}
    setting={{ label: "Send images", value: "inline" as Mode, options, onChange: () => undefined, disabled: true }} />;
}
