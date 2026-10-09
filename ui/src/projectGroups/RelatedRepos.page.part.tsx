import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { RelatedRepos } from "./RelatedRepos";
import { related } from "./fixtures/groups";
export const name = "Related repositories";
export const checks = {
  default: {
    "target controls identify the selected checkout": async ({ canvas, input, expect, waitFor }) => {
      await input.click(canvas.getByRole("button", { name: "Changes and files" }));
      await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("changes: /code/korri-plugins/.worktree/s-12345678"));
      expect(canvas.getByRole("button", { name: "Land on main" })).toBeVisible();
      expect(canvas.getByRole("button", { name: "Discard", exact: true })).toBeVisible();
    },
  },
  Busy: {
    "active run keeps reads available but blocks destructive controls": async ({ canvas, expect }) => {
      expect(canvas.getByRole("button", { name: "Changes and files" })).toBeEnabled();
      expect(canvas.getByRole("button", { name: "Land on main" })).toBeDisabled();
      expect(canvas.getByRole("button", { name: "Discard", exact: true })).toBeDisabled();
    },
  },
} satisfies StateChecks;
export const composition = { default: [
  { part: "src/ui/DialogPanel.organism.part.tsx", state: "default" },
  { part: "src/ui/ActionCard.molecule.part.tsx", state: "default" },
  { part: "src/ui/ActionButton.molecule.part.tsx", state: "default" },
] };
export default function Ready() {
  const [message, setMessage] = useState<string>();
  return <RelatedRepos context={related} busy={false} error={message} onClose={() => setMessage("Close selected")}
    onPrepare={() => setMessage("Existing checkout reused; no new chat started.")} onAction={(action, info) => setMessage(`${action}: ${info.path}`)} onRefresh={() => setMessage(undefined)} />;
}
export function Busy() { return <RelatedRepos context={related} busy onClose={() => undefined} onPrepare={() => undefined} onAction={() => undefined} onRefresh={() => undefined} />; }
export function NoGroups() { return <RelatedRepos context={{ ...related, groups: [], related: [], projects: [] }} busy={false} onClose={() => undefined} onPrepare={() => undefined} onAction={() => undefined} onRefresh={() => undefined} />; }
export function SetupFailed() { return <RelatedRepos context={{ ...related, related: related.related.map((item) => ({ ...item, setup: { phase: "failed", log: "Install failed\nDependency unavailable", error: "Post-create hook exited with 7" } })) }} busy={false} onClose={() => undefined} onPrepare={() => undefined} onAction={() => undefined} onRefresh={() => undefined} />; }
