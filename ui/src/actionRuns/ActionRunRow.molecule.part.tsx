import { useState } from "react";
import { ActionRunRow } from "./ActionRunRow";
import type { ActionRunLink } from "./actionRunApi";
import { brokenItems, derived, fixtureNow, items, longRun, manyItems } from "./fixtures/actionRuns";

export const name = "Action run row";
export const note = "One linked or derived run, with its watch toggle and Unlink";

const AT = "2026-10-15T12:00:00.000Z";
/** Where a press took the reader: the panel would show the run's jobs. */
const opened = (item: { run: { runNumber: number } | null; link: { runId: number } }) =>
  <p>Opened the jobs of run {item.run ? `#${String(item.run.runNumber)}` : `ID ${String(item.link.runId)}`}.</p>;

/** One linked run with its handlers on local state: a press opens it, the toggle flips its watch, and Unlink removes the row. */
function Linked({ index, list = items }: { index: number; list?: typeof items }) {
  const item = list[index]!;
  const [link, setLink] = useState<ActionRunLink>(item.link);
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(true);
  if (!linked) return <p>Unlinked. <button type="button" onClick={() => { setLinked(true); setLink({ ...item.link, watch: { kind: "off" } }); }}>Link it again</button></p>;
  return <>
    <ActionRunRow runId={link.runId} run={item.run} link={link} error={item.error} now={fixtureNow} busy={false} writing={false} onOpen={() => setOpen(true)}
      onWatch={(on) => setLink({ ...link, watch: on ? { kind: "watching", since: AT, wakes: 0 } : { kind: "stopped", reason: "Stopped by you", at: AT } })}
      onUnlink={() => setLinked(false)} />
    {open ? opened(item) : null}
  </>;
}
export default function WatchedFailure() { return <Linked index={0} />; }
export function WatchedRunning() { return <Linked index={1} />; }
export function StoppedSuccess() { return <Linked index={2} />; }
export function ReadError() { return <Linked index={1} list={brokenItems} />; }
export function MissingPermission() { return <Linked index={2} list={brokenItems} />; }
export function LongValues() { return <Linked index={manyItems.findIndex((item) => item.run?.runId === longRun.runId)} list={manyItems} />; }
export function Derived() {
  const run = derived[0]!.runs[1]!;
  const [watching, setWatching] = useState(false);
  return <ActionRunRow runId={run.runId} run={run} now={fixtureNow} busy={false} writing={false}
    link={watching ? { provider: "github", session: { id: "s1", cwd: "/home/dev/forgerie" }, repo: run.repo, runId: run.runId, source: "pull", watch: { kind: "watching", since: AT, wakes: 0 } } : undefined}
    onWatch={setWatching} />;
}
export function ReadOnly() {
  const item = items[0]!;
  const [open, setOpen] = useState(false);
  return <>
    <ActionRunRow runId={item.link.runId} run={item.run} link={item.link} now={fixtureNow} busy writing={false} onOpen={() => setOpen(true)} />
    {open ? opened(item) : null}
  </>;
}
