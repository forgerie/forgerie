import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { DialogPanel } from "./DialogPanel";
export const name = "Dialog panel";
export const checks = {
  LongContent: {
    "keyboard reaches the last item while close stays visible": async ({ canvas, input, expect, waitFor }) => {
      await input.press(canvas.getByRole("region", { name: "A long collection content" }), "End");
      await waitFor(() => expect(canvas.getByText("Item 30: representative content for the scroll region.")).toBeVisible());
      expect(canvas.getByRole("button", { name: "Close" })).toBeVisible();
    },
  },
} satisfies StateChecks;
export default function Open() { const [open, setOpen] = useState(true); return open ? <DialogPanel title="Manage a collection" onClose={() => setOpen(false)}><p>All controls stay reachable while the contents scroll.</p></DialogPanel> : <button onClick={() => setOpen(true)}>Open again</button>; }
export function LongContent() { const [open, setOpen] = useState(true); return open ? <DialogPanel title="A long collection" onClose={() => setOpen(false)}>{Array.from({ length: 30 }, (_, index) => <p key={index}>Item {index + 1}: representative content for the scroll region.</p>)}</DialogPanel> : <button onClick={() => setOpen(true)}>Open again</button>; }
