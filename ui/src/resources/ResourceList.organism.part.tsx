import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ResourceList } from "./ResourceList";
import type { ResourceKind } from "./resourceApi";
import { sessionInventory, settingsInventory } from "./fixtures/resources";

export const name = "Skills and prompts list";
export const note = "The files one place loads, one kind at a time, in sections by origin";
export const checks = {
  default: {
    "the kind switch and the search narrow the list, and a row opens its file": async ({ canvas, input, expect }) => {
      expect(canvas.getByText("This project")).toBeVisible();
      await input.type(canvas.getByRole("searchbox", { name: "Search skills" }), "mobbin");
      expect(canvas.queryByText("This project")).toBeNull();
      await input.click(canvas.getByRole("button", { name: /mobbin-reference/ }));
      expect(canvas.getByText(/^Opened c1/)).toBeVisible();
      await input.click(canvas.getByRole("button", { name: /Prompts/ }));
      expect(canvas.getByText(/Nothing matches/)).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = { default: [
  { part: "src/ui/ListTools.molecule.part.tsx", state: "default" },
  { part: "src/ui/ListSection.molecule.part.tsx", state: "default" },
  { part: "src/ui/OptionRow.atom.part.tsx", state: "default" },
] };

function Harness({ inventory, unsavedId }: { inventory: typeof sessionInventory; unsavedId?: string }) {
  const [kind, setKind] = useState<ResourceKind>("skill");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState("Nothing opened");
  return <>
    <ResourceList entries={inventory.resources} kind={kind} query={query} diagnostics={inventory.diagnostics}
      unsaved={(id) => id === unsavedId} onKind={setKind} onQuery={setQuery} onOpen={(id) => setOpened(`Opened ${id}`)} />
    <p>{opened}</p>
  </>;
}

export default function Session() {
  return <Harness inventory={sessionInventory} unsavedId={sessionInventory.resources[0]?.id} />;
}
export function Settings() {
  return <Harness inventory={settingsInventory} />;
}
export function Empty() {
  return <Harness inventory={{ ...settingsInventory, resources: [], diagnostics: [] }} />;
}
