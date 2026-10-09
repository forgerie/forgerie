import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ProjectGroups } from "./ProjectGroups";
import { catalog, related } from "./fixtures/groups";

export const name = "Project groups";
export const note = "Settings → Project groups: the groups, and worktrees chats made in other repos";
export const checks = {
  default: {
    "a group row opens the group, and New group opens a blank one": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: /KORI/ }));
      expect(canvas.getByText("Opened kori")).toBeVisible();
      await input.click(canvas.getByRole("button", { name: "New group" }));
      expect(canvas.getByText("Opened new")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = { default: [
  { part: "src/ui/HeaderButton.atom.part.tsx", state: "default" },
  { part: "src/ui/MenuButton.molecule.part.tsx", state: "default" },
  { part: "src/ui/ListSection.molecule.part.tsx", state: "default" },
  { part: "src/ui/ActionRow.molecule.part.tsx", state: "default" },
  { part: "src/ui/Lede.atom.part.tsx", state: "default" },
] };

const back = <button type="button">Settings</button>;
export default function Ready() {
  const [opened, setOpened] = useState("Nothing opened");
  return <>
    <ProjectGroups back={back} catalog={catalog} loaded worktrees={related.related}
      onNew={() => setOpened("Opened new")} onOpen={(id) => setOpened(`Opened ${id}`)} onRefresh={() => undefined} onWorktree={() => undefined} />
    <p>{opened}</p>
  </>;
}
export function Empty() {
  return <ProjectGroups back={back} catalog={{ groups: [], projects: catalog.projects }} loaded worktrees={[]}
    onNew={() => undefined} onOpen={() => undefined} onRefresh={() => undefined} onWorktree={() => undefined} />;
}
export function Unavailable() {
  return <ProjectGroups back={back} catalog={{ groups: [], projects: [] }} loaded={false} error="Session daemon unavailable. Existing projects and chats are unchanged."
    worktrees={[]} worktreeError="Could not read related worktrees: Session daemon unavailable." onNew={() => undefined} onOpen={() => undefined}
    onRefresh={() => undefined} onWorktree={() => undefined} />;
}
