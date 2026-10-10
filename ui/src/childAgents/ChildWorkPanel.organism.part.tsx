import { useState } from "react";
import { ChildWorkPanel } from "./ChildWorkPanel";
import type { ChildDetail } from "./childWorkModel";
import { REVIEW, DISCARD, RUNS, CLEANUP } from "./fixtures/childWork";

export const name = "Child work review";
function Scenario({ initial }: { initial: Exclude<ChildDetail, { kind: "none" }> }) {
  const [detail, setDetail] = useState(initial);
  const [open, setOpen] = useState(true);
  if (!open) return <button onClick={() => { setDetail(initial); setOpen(true); }}>Open review</button>;
  return <ChildWorkPanel detail={detail} onBack={() => setOpen(false)} onClose={() => setOpen(false)} onRefresh={() => setDetail(initial)}
    onDiscard={() => setOpen(false)} />;
}
export default function Review() { return <Scenario initial={REVIEW} />; }
export function Discard() { return <Scenario initial={DISCARD} />; }
export function Runs() { return <Scenario initial={{ kind: "runs", data: RUNS }} />; }
export function Cleanup() { return <Scenario initial={CLEANUP} />; }
export function Loading() { return <Scenario initial={{ kind: "loading", title: "Review changes" }} />; }
export function Failed() { return <Scenario initial={{ kind: "failed", message: "The owned worktree could not be read. No changes were made." }} />; }
