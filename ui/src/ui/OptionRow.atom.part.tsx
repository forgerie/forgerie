import { useState } from "react";
import { FileTextIcon, GitBranchPlusIcon } from "lucide-react";
import { OptionRow } from "./OptionRow";

export const name = "Option row";
export const note = "One choice: a name, short details, and a check on the choice in effect";

export default function Choices() {
  const [chosen, setChosen] = useState("opus");
  return <div>
    <OptionRow name="Claude Opus 5.5" details={[{ text: "default", strong: true }, "Proxy", "1m context"]}
      current={chosen === "opus"} onClick={() => setChosen("opus")} />
    <OptionRow name="Claude Haiku 4.5" variant="2025-10-01" details={["200k context"]}
      current={chosen === "haiku"} onClick={() => setChosen("haiku")} />
    <OptionRow name="GPT-5.6 Sol" tone="quiet" details={["272k context", "no thinking"]}
      current={chosen === "sol"} onClick={() => setChosen("sol")} />
  </div>;
}
export function WithIconAndPath() {
  return <div>
    <OptionRow name="New worktree" variant="from main" icon={<GitBranchPlusIcon size={16} />}
      details={["Its own branch and folder. Land or discard it when the work is done."]} current />
    <OptionRow name="feat/very-long-branch-name-for-the-option-row" icon={<FileTextIcon size={16} />}
      details={[{ text: "/home/someone/code/sandbox/forgerie/.worktree/very-long-branch-name-for-the-option-row", truncate: "start" }]} />
  </div>;
}
export function HiddenAndBusy() {
  return <div>
    <OptionRow name="Llama 3 8B" tone="faint" details={["Local", "hidden"]} />
    <OptionRow name="Gemini 3.8 Flash" busy details={["Switching…"]} />
    <OptionRow name="Claude Opus 5.5" blocked details={["Proxy"]} />
  </div>;
}
/** Details on the name's line: one row height whatever the text, for a palette. */
export function TrailingDetails() {
  return <div>
    <OptionRow name="/compact" detailsPlacement="trailing" details={["Manually compact session context"]} />
    <OptionRow name="/goal" detailsPlacement="trailing" details={["Run a goal to completion: /goal [--tokens 100k] <goal_to_complete>"]} />
    <OptionRow name="/new" detailsPlacement="trailing" details={["Start a new session"]} />
    <OptionRow name="/skill:atomic-decomp" detailsPlacement="trailing" />
    <OptionRow name="/skill:frontend-design" detailsPlacement="trailing" />
  </div>;
}
