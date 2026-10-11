import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { FindBar } from "./FindBar";

export const name = "Find bar";
export const note = "Steps through the places a search found: where you are, previous, next, close";
export const checks = {
  default: {
    "next and previous step round the ends": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Next place" }));
      expect(canvas.getByText("3 of 7")).toBeVisible();
      await input.click(canvas.getByRole("button", { name: "Previous place" }));
      await input.click(canvas.getByRole("button", { name: "Previous place" }));
      await input.click(canvas.getByRole("button", { name: "Previous place" }));
      expect(canvas.getByText("7 of 7")).toBeVisible();
    },
  },
} satisfies StateChecks;

export default function Stepping() {
  const [at, setAt] = useState(2);
  const [open, setOpen] = useState(true);
  if (!open) return <p>The bar is closed.</p>;
  return <FindBar name="Found places" label={`${String(at)} of 7`}
    previous={{ label: "Previous place", onPress: () => setAt(at === 1 ? 7 : at - 1) }}
    next={{ label: "Next place", onPress: () => setAt(at === 7 ? 1 : at + 1) }}
    close={{ label: "Close", onPress: () => setOpen(false) }} />;
}
export function One() {
  return <FindBar name="Found places" label="1 of 1" previous={{ label: "Previous place", onPress: () => undefined, disabled: true }}
    next={{ label: "Next place", onPress: () => undefined, disabled: true }} close={{ label: "Close", onPress: () => undefined }} />;
}
/** No steps: one note about the found place, which wraps on a narrow bar. */
export function Note() {
  return <FindBar name="Found places" label="This place is on another map." detail="The map opens when the gardener is back."
    close={{ label: "Close", onPress: () => undefined }} />;
}
export function Failed() {
  return <FindBar name="Found places" label="Could not find the places." detail="The log did not answer."
    action={{ label: "Retry", onPress: () => undefined }} close={{ label: "Close", onPress: () => undefined }} />;
}
