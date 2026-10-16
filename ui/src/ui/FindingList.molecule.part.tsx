import { useMemo, useState } from "react";
import { FindingList } from "./FindingList";

export const name = "Finding list";
export const note = "A review's defects worst first, each with a severity, a location, the problem and a fix, under a verdict";

export default function ChangesNeeded() {
  return <FindingList code={"verdict: changes needed\nP1 src/server/azureDevops/azurePullReader.ts:113,124–125 — Retry-After has no upper bound\n  fix: validate the computed timestamp and bound the delay\nP1 ui/src/session/taskActivityStore.ts:57,76 — An in-flight read can erase the disconnected/stale state\n  fix: drop reads that started before the disconnect\nP2 ui/src/sessionStore.ts:432–435 — A hidden catalog notification replaces `pendingReceipt`\nnit src/client/src/components/ChatView.ts:812 — Stale comment names the old controller"} />;
}
export function BlockedLongPath() {
  return <FindingList code={"verdict: blocked\nnit src/client/src/components/ChatView.ts:812 — Stale comment names the old controller\nblocker src/server/integrations/azureDevops/pullRequests/reviewThreads/azurePullRequestReviewThreadReconciler.ts:1048-1112 — Two reconcilers write the same thread and the second one wins\n  fix: take the per-pull lock before reading the thread list\nshould-fix ui/src/session/taskActivityStore.ts:57 — The stale flag is never cleared after a reconnect"} />;
}
export function Approved() {
  return <FindingList code={"verdict: approve"} />;
}
// Only taskActivityStore.ts is on disk, so the other locations stay plain.
const ON_DISK = new Set(["ui/src/session/taskActivityStore.ts"]);
const existing = async (paths: readonly string[]) => new Set(paths.filter((path) => ON_DISK.has(path)));
export function Openable() {
  const [opened, setOpened] = useState<string>();
  const links = useMemo(() => ({ existing, open: setOpened }), []);
  return <>
    <FindingList links={links} code={"verdict: changes needed\nP1 ui/src/session/taskActivityStore.ts:57,76 — An in-flight read can erase the stale state\nP2 ui/src/sessionStore.ts:432 — A hidden notification replaces the receipt"} />
    <p>{opened ?? "Nothing opened"}</p>
  </>;
}
