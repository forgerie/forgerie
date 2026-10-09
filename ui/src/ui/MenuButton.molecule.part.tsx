import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { MenuButton } from "./MenuButton";

export const name = "Menu button";
export const note = "Rare commands one tap away; a destructive one asks twice";
export const checks = {
  default: {
    "a destructive command runs only on the second press": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "More commands" }));
      await input.click(canvas.getByRole("menuitem", { name: "Delete item" }));
      expect(canvas.getByRole("menuitem", { name: "Delete? This cannot be undone" })).toBeVisible();
      expect(canvas.getByText("Nothing ran")).toBeVisible();
      await input.click(canvas.getByRole("menuitem", { name: "Delete? This cannot be undone" }));
      expect(canvas.getByText("Ran Delete")).toBeVisible();
    },
  },
} satisfies StateChecks;

export default function Commands() {
  const [ran, setRan] = useState("Nothing ran");
  return <>
    <p>{ran}</p>
    <MenuButton label="More commands" align="start" commands={[
      { label: "Discard changes", icon: <XIcon aria-hidden />, onSelect: () => setRan("Ran Discard") },
      { label: "Read again", icon: <RefreshCwIcon aria-hidden />, onSelect: () => setRan("Ran Read") },
      "separator",
      { label: "Delete item", icon: <Trash2Icon aria-hidden />, tone: "danger", confirm: "Delete? This cannot be undone", onSelect: () => setRan("Ran Delete") },
    ]} />
  </>;
}
