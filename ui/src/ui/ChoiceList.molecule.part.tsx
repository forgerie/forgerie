import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { ChoiceList } from "./ChoiceList";

export const name = "Choice list";
export const note = "Pick any number of rows; a long list gets a search field";
export const checks = {
  Long: {
    "searching hides rows without changing what is chosen": async ({ canvas, input, expect }) => {
      await input.type(canvas.getByRole("searchbox", { name: "Find a folder" }), "notes");
      expect(canvas.queryByRole("checkbox", { name: /photos/ })).toBeNull();
      expect(canvas.getByText("2 of 12")).toBeVisible();
    },
  },
} satisfies StateChecks;

const few = [
  { id: "a", label: "photos", detail: "/home/reader/photos" },
  { id: "b", label: "notes", detail: "/home/reader/notes" },
  { id: "c", label: "recipes", detail: "/home/reader/recipes" },
];
const many = [...few, ...["music", "taxes", "garden", "letters", "maps", "notes-archive", "school", "travel", "games"]
  .map((label, index) => ({ id: `m${String(index)}`, label, detail: `/home/reader/${label}` }))];

export default function Short() {
  const [chosen, setChosen] = useState(["a"]);
  return <ChoiceList legend="Folders" choices={few} chosen={chosen} missing="Missing folder" search="Find a folder" onChange={setChosen} />;
}
export function Long() {
  const [chosen, setChosen] = useState(["a", "b"]);
  return <ChoiceList legend="Folders" choices={many} chosen={chosen} missing="Missing folder" search="Find a folder" onChange={setChosen} />;
}
export function Missing() {
  const [chosen, setChosen] = useState(["b", "gone-folder"]);
  return <ChoiceList legend="Folders" choices={few} chosen={chosen} missing="Missing folder" search="Find a folder" onChange={setChosen} />;
}
export function Disabled() {
  return <ChoiceList legend="Folders" choices={few} chosen={["c"]} missing="Missing folder" search="Find a folder" disabled onChange={() => undefined} />;
}
