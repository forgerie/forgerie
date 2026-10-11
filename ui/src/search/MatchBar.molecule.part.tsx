import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { MatchBar } from "./MatchBar";
import type { MatchBarView } from "./found";

export const name = "Match bar";
export const note = "Above the message box of a session opened from a search hit";
export const checks = {
  default: {
    "Next and Previous step through the matches": async ({ canvas, input, expect }) => {
      await input.click(canvas.getByRole("button", { name: "Next match" }));
      expect(canvas.getByText("Match 3 of 7")).toBeVisible();
      await input.click(canvas.getByRole("button", { name: "Previous match" }));
      expect(canvas.getByText("Match 2 of 7")).toBeVisible();
    },
  },
} satisfies StateChecks;
export const composition = {
  default: [{ part: "src/ui/FindBar.molecule.part.tsx", state: "default" }],
  OneMatch: [{ part: "src/ui/FindBar.molecule.part.tsx", state: "One" }],
  OffBranchBusy: [{ part: "src/ui/FindBar.molecule.part.tsx", state: "Note" }],
  Failed: [{ part: "src/ui/FindBar.molecule.part.tsx", state: "Failed" }],
};

function Stateful({ initial }: { initial: MatchBarView }) {
  const [view, setView] = useState(initial);
  const [closed, setClosed] = useState(false);
  if (closed) return <p>The match bar is closed.</p>;
  return <MatchBar view={view} onClose={() => setClosed(true)} onRetry={() => setView({ type: "ready", current: 0, total: 7, missing: false })}
    onStep={(delta) => { if (view.type === "ready") setView({ ...view, current: (view.current + delta + view.total) % view.total }); }} />;
}
export default function Stepping() { return <Stateful initial={{ type: "ready", current: 1, total: 7, missing: false }} />; }
export function OneMatch() { return <Stateful initial={{ type: "ready", current: 0, total: 1, missing: false }} />; }
export function Loading() { return <Stateful initial={{ type: "loading" }} />; }
/** The message the server named is not in the loaded thread, such as after a compaction. */
export function NotLoaded() { return <Stateful initial={{ type: "ready", current: 4, total: 12, missing: true }} />; }
export function Failed() { return <Stateful initial={{ type: "failed", message: "Could not reach the server. Check the connection, then try again." }} />; }
/** An off-branch hit in a session at work: the history tree waits until it is idle. */
/** The history tree for an off-branch hit could not be read, such as a session the server no longer knows. */
export function TreeFailed() { return <Stateful initial={{ type: "treeFailed", message: "Session tree-session was not found." }} />; }
export function OffBranchBusy() { return <Stateful initial={{ type: "waiting" }} />; }
/** The session no longer holds the opened passage, and no other passage stands in for it. */
export function Missing() { return <Stateful initial={{ type: "missing" }} />; }
