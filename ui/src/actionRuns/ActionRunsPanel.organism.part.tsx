import { useState } from "react";
import { ActionRunsPanel } from "./ActionRunsPanel";
import { runKey, type ActionRunItem } from "./actionRunApi";
import type { ActionRunsState } from "./actionRunsStore";
import { fixtureNow, link, queuedRun, states } from "./fixtures/actionRuns";
import { pullItem } from "./fixtures/pull";
import { PullRequestReview } from "../ui/PullRequestReview";

export const name = "Actions runs panel";
export const note = "The session's linked runs with a link field; a row opens its jobs. Local state only: nothing calls GitHub.";
export const composition = {
  default: [{ part: "src/ui/RunList.organism.part.tsx", state: "default" }, { part: "src/actionRuns/ActionRunRow.molecule.part.tsx", state: "default" }],
  Loading: [{ part: "src/ui/RunList.organism.part.tsx", state: "Loading" }],
  Empty: [{ part: "src/ui/RunList.organism.part.tsx", state: "Empty" }],
  Failed: [{ part: "src/ui/RunList.organism.part.tsx", state: "Failed" }],
  Broken: [{ part: "src/actionRuns/ActionRunRow.molecule.part.tsx", state: "ReadError" }, { part: "src/actionRuns/ActionRunRow.molecule.part.tsx", state: "MissingPermission" }],
  Opened: [{ part: "src/actionRuns/ActionRunDetail.organism.part.tsx", state: "default" }],
};
export const expectations = {
  InPullRequestPanel: { empty: { reason: "The pull request panel is a modal dialog portaled to the document body, outside #caliper-host. The PNG shows it." } },
} as const;

const AT = "2026-10-15T12:00:00.000Z";
function Scenario({ initial, readOnly = false, inPanel = false }: { initial: ActionRunsState; readOnly?: boolean; inPanel?: boolean }) {
  const [state, setState] = useState(initial);
  const setItems = (change: (items: readonly ActionRunItem[]) => readonly ActionRunItem[]) =>
    setState((current) => current.load.type === "ready" ? { ...current, load: { ...current.load, items: change(current.load.items) } } : current);
  const panel = <ActionRunsPanel state={state} now={fixtureNow} readOnly={readOnly} actions={{
    onRefresh: () => setState({ ...states.ready }),
    onLink: async (run) => {
      if (typeof run === "number" && run === queuedRun.runId) { setItems((list) => [...list, { link: link(run), run: queuedRun }]); return true; }
      setState((current) => ({ ...current, notice: { text: `GitHub has no run ${String(run)} on forgerie/forgerie. Paste ${String(queuedRun.runId)} to link the queued fixture.` } }));
      return false;
    },
    onUnlink: (key) => setItems((list) => list.filter((item) => runKey(item.link) !== key)),
    onWatch: (key, _id, on) => setItems((list) => list.map((item) => runKey(item.link) !== key ? item
      : { ...item, link: { ...item.link, watch: on ? { kind: "watching", since: AT, wakes: 0 } : { kind: "stopped", reason: "Stopped by you", at: AT } } })),
    onOpenRun: (key, runId) => setState((current) => ({ ...current, detail: { key, runId, load: { type: "ready" } } })),
    onCloseRun: () => setState((current) => ({ ...current, detail: undefined })),
  }} />;
  if (!inPanel) return panel;
  // In place: the Actions tab of the session's pull request panel, beside one linked pull request.
  return <PullRequestReview load={{ type: "ready", items: [pullItem] }} selected={142} onSelect={() => {}} reading={new Set()} notice={undefined} writing={false}
    now={fixtureNow} onRefresh={() => {}} onAsk={() => {}} onWatch={() => {}} onLink={async () => false} onUnlink={() => {}} onMerge={() => {}} onClose={() => {}}
    extraView={{ label: "Actions", title: "Workflow runs", tone: "failed", first: true, content: panel }} />;
}
export default function Ready() { return <Scenario initial={states.ready} />; }
export function Loading() { return <Scenario initial={states.loading} />; }
export function Empty() { return <Scenario initial={states.empty} />; }
export function Many() { return <Scenario initial={states.many} />; }
export function Broken() { return <Scenario initial={states.broken} />; }
export function Failed() { return <Scenario initial={states.failed} />; }
export function Rereading() { return <Scenario initial={states.rereading} />; }
export function Opened() {
  const first = states.ready.load.items[0]!;
  return <Scenario initial={{ ...states.ready, detail: { key: runKey(first.link), runId: first.link.runId, load: { type: "ready" } } }} />;
}
export function ReadOnly() { return <Scenario initial={states.ready} readOnly />; }
export function InPullRequestPanel() { return <Scenario initial={states.ready} inPanel />; }
