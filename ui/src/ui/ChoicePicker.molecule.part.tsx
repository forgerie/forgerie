import { useState } from "react";
import { FolderIcon } from "lucide-react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ChoicePicker } from "./ChoicePicker";

export const name = "Choice picker";
export const note = "Any number of choices as one chip that opens a checklist at window level, with an every row on top";
export const checks = {
  default: {
    "the panel stays open while rows are checked, and Done closes it": async ({ canvas, within, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /Folders/ }));
      await input.click(within(document.body).getByRole("checkbox", { name: /notes/ }));
      expect(within(document.body).getByRole("dialog", { name: "Folders" })).toBeVisible();
      await input.click(within(document.body).getByRole("button", { name: "Done" }));
      expect(canvas.getByRole("button", { name: "Folders: Backs up 2 folders" })).toBeVisible();
    },
  },
  Several: {
    "the every row sits above the rows it chooses": async ({ canvas, within, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /Folders/ }));
      expect(within(document.body).getByRole("checkbox", { name: /Every folder/ })).not.toBeChecked();
      expect(within(document.body).getByRole("checkbox", { name: /recipes/ })).toBeChecked();
    },
  },
} satisfies StateChecks;

const FOLDERS = [
  { id: "/home/reader/photos", label: "photos", detail: "/home/reader/photos" },
  { id: "/home/reader/notes", label: "notes", detail: "/home/reader/notes" },
  { id: "/home/reader/recipes", label: "recipes", detail: "/home/reader/recipes" },
];

function Picker({ start, every: startEvery = false, disabled = false }: { start: string[]; every?: boolean; disabled?: boolean }) {
  const [chosen, setChosen] = useState(start);
  const [every, setEvery] = useState(startEvery);
  const value = every ? "every folder" : chosen.length === 0 ? undefined : chosen.length === 1 ? FOLDERS.find((item) => item.id === chosen[0])?.label : `${String(chosen.length)} folders`;
  return <ChoicePicker label="Folders" lead="Backs up" icon={<FolderIcon aria-hidden size={14} />} value={value} placeholder="Choose folders" disabled={disabled}
    list={{ legend: "Folders", choices: FOLDERS, chosen, missing: "Missing folder", search: "Find a folder", onChange: setChosen,
      every: { label: "Every folder", detail: "Includes folders added later.", on: every, onChange: setEvery } }} />;
}
export default function One() { return <Picker start={["/home/reader/photos"]} />; }
export function Several() { return <Picker start={["/home/reader/photos", "/home/reader/recipes"]} />; }
export function Every() { return <Picker start={[]} every />; }
export function Nothing() { return <Picker start={[]} />; }
export function Disabled() { return <Picker start={["/home/reader/photos"]} disabled />; }
