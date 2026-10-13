import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { OptionPicker } from "./OptionPicker";

export const name = "Option picker";
export const note = "One choice as a chip that opens searchable options at window level; a blocked option says why";
export const checks = {
  default: {
    "a press opens the options and a choice closes them": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /Workflow/ }));
      await input.click(canvas.getByRole("button", { name: /triage-issues/ }));
      expect(canvas.getByRole("button", { name: "Workflow: triage-issues" })).toBeVisible();
    },
  },
} satisfies StateChecks;

const WORKFLOWS = [
  { id: "refine-backlog", name: "refine-backlog", details: ["Refine the oldest ready backlog items"] },
  { id: "triage-issues", name: "triage-issues", details: ["Sort new issues into the backlog"] },
  { id: "nightly-report", name: "nightly-report", details: ["Scripts cannot run on a schedule"], blocked: true },
];

export default function Chosen() {
  const [value, setValue] = useState("refine-backlog");
  return <OptionPicker label="Workflow" value={value} placeholder="Choose a workflow" search="Find a workflow"
    options={WORKFLOWS.map((option) => ({ ...option, current: option.id === value }))} onChoose={setValue} />;
}
export function Empty() {
  return <OptionPicker label="Workflow" placeholder="Choose a workflow" options={[]}
    status={{ tone: "status", text: "This project has no saved workflows." }} onChoose={() => undefined} />;
}
