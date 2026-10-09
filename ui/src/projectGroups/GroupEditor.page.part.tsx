import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { GroupEditor, type GroupDraft } from "./GroupEditor";
import { catalog, manyProjects } from "./fixtures/groups";

export const name = "Project group";
export const note = "One group as a document: its name, then the projects it holds";
export const checks = {
  default: {
    "a change becomes a draft until Save": async ({ canvas, input, expect }) => {
      expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
      await input.click(canvas.getByRole("checkbox", { name: /coach/ }));
      expect(canvas.getByText("Unsaved changes")).toBeVisible();
      await input.click(canvas.getByRole("button", { name: "Save" }));
      expect(canvas.getByText("Saved 3 projects")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = { default: [
  { part: "src/ui/HeaderButton.atom.part.tsx", state: "default" },
  { part: "src/ui/MenuButton.molecule.part.tsx", state: "default" },
  { part: "src/ui/TitleField.atom.part.tsx", state: "default" },
  { part: "src/ui/ChoiceList.molecule.part.tsx", state: "Long" },
  { part: "src/ui/TextSubmit.molecule.part.tsx", state: "default" },
] };

const back = <button type="button">Project groups</button>;
function Editor({ fresh, start, error }: { fresh: boolean; start: GroupDraft; error?: string }) {
  const [base, setBase] = useState(start);
  const [draft, setDraft] = useState(start);
  const [projects, setProjects] = useState(manyProjects);
  const [said, setSaid] = useState("");
  const dirty = draft.name !== base.name || draft.projectIds.join() !== base.projectIds.join();
  return <>
    <GroupEditor back={back} fresh={fresh} draft={draft} projects={projects} dirty={dirty} pending={false} error={error}
      onChange={setDraft} onDiscard={() => setDraft(base)} onSave={() => { setBase(draft); setSaid(`Saved ${String(draft.projectIds.length)} projects`); }}
      onDelete={fresh ? undefined : () => setSaid("Deleted")}
      onRegister={async (path) => {
        const id = `p-${String(projects.length)}`;
        setProjects([...projects, { id, name: path.split("/").at(-1) ?? path, path }]);
        setDraft({ ...draft, projectIds: [...draft.projectIds, id] });
      }} />
    <p>{said}</p>
  </>;
}
const kori = catalog.groups[0]!;
export default function Saved() { return <Editor fresh={false} start={{ name: kori.name, projectIds: [...kori.projectIds] }} />; }
export function Fresh() { return <Editor fresh start={{ name: "", projectIds: [] }} />; }
export function Refused() {
  return <Editor fresh={false} start={{ name: kori.name, projectIds: [...kori.projectIds, "gone"] }}
    error="This group changed in another window. Discard your changes to load it, then make them again." />;
}
