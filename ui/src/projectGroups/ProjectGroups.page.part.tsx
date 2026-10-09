import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ProjectGroups } from "./ProjectGroups";
import { ActionButton } from "../ui/ActionButton";
import { catalog } from "./fixtures/groups";
export const name = "Project groups";
export const checks = {
  default: {
    "edit membership and save without leaving the page": async ({ canvas, input, expect, waitFor }) => {
      await input.click(canvas.getByRole("button", { name: "Edit KORI" }));
      expect(canvas.getByRole("textbox", { name: "Group name" })).toHaveValue("KORI");
      await input.click(canvas.getByRole("checkbox", { name: /korri-plugins/ }));
      await input.click(canvas.getByRole("button", { name: "Save group" }));
      await waitFor(() => expect(canvas.getByText("1 member")).toBeVisible());
      expect(canvas.getByRole("heading", { name: "Project groups" })).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = { default: [
  { part: "src/ui/CollectionEditor.organism.part.tsx", state: "default" },
  { part: "src/ui/ActionCard.molecule.part.tsx", state: "default" },
  { part: "src/ui/TextSubmit.molecule.part.tsx", state: "default" },
] };
export default function Ready() {
  const [data, setData] = useState(catalog);
  return <ProjectGroups catalog={data} pending={false} back={<button type="button" className="settings-back">Settings</button>} onRegister={async (path) => setData((current) => ({ ...current, projects: [...current.projects, { id: `p-${current.projects.length}`, name: path.split("/").at(-1) ?? path, path }] }))} onRefresh={() => setData(catalog)}
    onSave={async (id, name, projectIds) => setData((current) => ({ ...current, groups: [...current.groups.filter((group) => group.id !== id), { id: id ?? `group-${current.groups.length}`, name, projectIds, revision: 1, createdAt: "2026-10-09", updatedAt: "2026-10-09" }] }))}
    onRemove={async (id) => setData((current) => ({ ...current, groups: current.groups.filter((group) => group.id !== id) }))}><section aria-labelledby="related-worktrees"><h2 id="related-worktrees">Related worktrees</h2><p>No related worktrees.</p><ActionButton label="Refresh related worktrees" onPress={() => undefined} /></section></ProjectGroups>;
}
export function Unavailable() { return <ProjectGroups catalog={{ groups: [], projects: [] }} pending={false} error="Session daemon unavailable. Existing projects and chats are unchanged." onSave={async () => undefined} onRemove={async () => undefined} onRefresh={() => undefined} />; }
