import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { PathField, type PathSuggest } from "./PathField";
import { suggestFolders, pendingFolders, unavailableFolders } from "./fixtures/paths";

export const name = "Path field";
export const note = "Path completion without a mention marker; folder selection continues browsing, and Enter accepts the chosen folder";
export const composition = { default: [
  { part: "src/ui/TextField.atom.part.tsx", state: "default" },
  { part: "src/ui/SuggestionHeader.molecule.part.tsx", state: "default" },
  { part: "src/ui/FloatingPanel.atom.part.tsx", state: "default" },
  { part: "src/ui/OptionList.molecule.part.tsx", state: "default" },
] };
export const checks = {
  default: {
    "completes the path without registering a project": async ({ canvas, within, input, expect }) => {
      await input.click(within(document.body).getByRole("option", { name: "/code/forgerie/" }));
      expect(canvas.getByRole("combobox", { name: "Folder" })).toHaveValue("/code/forgerie/");
    },
  },
} satisfies StateChecks;

function Field({ start = "/code/", source = suggestFolders, disabled = false }: { start?: string; source?: PathSuggest; disabled?: boolean }) {
  const [value, setValue] = useState(start);
  return <PathField aria-label="Folder" placeholder="/path/to/repository" value={value} onChange={setValue}
    autoFocus disabled={disabled} suggestions={{ label: "Folders", source }} />;
}
export default function Ready() { return <Field />; }
export function Many() { return <Field start="/many/" />; }
export function Empty() { return <Field start="/code/new-repo/" />; }
export function Loading() { return <Field source={pendingFolders} />; }
export function Error() { return <Field source={unavailableFolders} />; }
export function Disabled() { return <Field disabled />; }
