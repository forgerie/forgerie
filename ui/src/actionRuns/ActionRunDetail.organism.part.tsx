import { useState } from "react";
import { ActionRunDetail } from "./ActionRunDetail";
import type { ActionRunItem } from "./actionRunApi";
import { brokenItems, fixtureNow, items, link, longRun, queuedRun } from "./fixtures/actionRuns";

export const name = "Action run detail";
export const note = "One linked run: where it stands, its watch, and its jobs with failed-job annotations";
export const composition = {
  default: [{ part: "src/ui/RunDetail.organism.part.tsx", state: "default" }, { part: "src/ui/JobList.molecule.part.tsx", state: "default" }],
  Running: [{ part: "src/ui/RunDetail.organism.part.tsx", state: "Running" }],
  MissingPermission: [{ part: "src/ui/RunDetail.organism.part.tsx", state: "Unread" }],
};

const AT = "2026-10-15T12:00:00.000Z";
function Scenario({ initial, load = { type: "ready" } }: { initial: ActionRunItem; load?: { type: "ready" } | { type: "loading" } | { type: "failed"; message: string } }) {
  const [item, setItem] = useState(initial);
  const [back, setBack] = useState(false);
  return <ActionRunDetail item={item} detail={load} now={fixtureNow} writing={false} readOnly={false} refusal={back ? "Back goes to the list in the panel." : undefined}
    onBack={() => setBack(true)} onUnlink={() => setBack(true)}
    onWatch={(on) => setItem({ ...item, link: { ...item.link, watch: on ? { kind: "watching", since: AT, wakes: 0 } : { kind: "stopped", reason: "Stopped by you", at: AT } } })} />;
}
export default function Failed() { return <Scenario initial={items[0]!} />; }
export function Running() { return <Scenario initial={items[1]!} load={{ type: "loading" }} />; }
export function Passed() { return <Scenario initial={items[2]!} />; }
export function Queued() { return <Scenario initial={{ link: link(queuedRun.runId), run: queuedRun }} />; }
export function LongValues() { return <Scenario initial={{ link: link(longRun.runId), run: longRun }} />; }
export function ReadError() { return <Scenario initial={brokenItems[1]!} load={{ type: "failed", message: "GitHub answered 404: Not Found." }} />; }
export function MissingPermission() { return <Scenario initial={brokenItems[2]!} load={{ type: "failed", message: brokenItems[2]!.error! }} />; }
