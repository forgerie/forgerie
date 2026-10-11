import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { TextSubmit } from "./TextSubmit";
export const name = "Text submit";
export const checks = {
  FollowUp: {
    "a refused value offers its follow-up under the field": async ({ canvas, input, expect }) => {
      await input.type(canvas.getByRole("textbox"), "/home/reader/code/sandbox/a-rather-long-repository-name");
      await input.click(canvas.getByRole("button", { name: "Add" }));
      expect(canvas.getByRole("button", { name: "Create it" })).toBeVisible();
      expect(canvas.getByRole("button", { name: "Cancel" })).toBeVisible();
    },
    "a refused value offers its follow-up, and confirming it clears the field": async ({ canvas, input, expect }) => {
      await input.type(canvas.getByRole("textbox"), "/srv/new-thing");
      await input.click(canvas.getByRole("button", { name: "Add" }));
      expect(canvas.getByText("Nothing is at /srv/new-thing yet.")).toBeVisible();
      await input.click(canvas.getByRole("button", { name: "Create it" }));
      expect(canvas.getByText("Added /srv/new-thing")).toBeVisible();
      expect(canvas.getByRole("textbox")).toHaveValue("");
    },
    "editing the value drops the follow-up": async ({ canvas, input, expect }) => {
      await input.type(canvas.getByRole("textbox"), "/srv/typo");
      await input.click(canvas.getByRole("button", { name: "Add" }));
      await input.type(canvas.getByRole("textbox"), "s");
      expect(canvas.queryByRole("button", { name: "Create it" })).toBeNull();
    },
  },
} satisfies StateChecks;
export default function Ready() { const [label, setLabel] = useState("Existing directory"); return <TextSubmit label={label} action="Add" placeholder="/path/to/directory" pending={false} onSubmit={async (value) => setLabel(`Added ${value}`)} />; }
export function Pending() { return <TextSubmit label="Existing directory" action="Adding…" placeholder="/path/to/directory" pending onSubmit={async () => undefined} />; }
export function FollowUp() {
  const [label, setLabel] = useState("Directory");
  return <TextSubmit label={label} hint="Nothing at the path yet? You can create it." action="Add" placeholder="/path/to/directory" pending={false}
    onSubmit={async (value) => ({ message: `Nothing is at ${value} yet.`, action: "Create it", run: async () => setLabel(`Added ${value}`) })} />;
}
