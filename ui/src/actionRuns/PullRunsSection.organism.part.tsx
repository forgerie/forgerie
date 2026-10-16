import { useState } from "react";
import { PullRunsSection } from "./PullRunsSection";
import { runKey, type ActionRun } from "./actionRunApi";
import type { ActionRunsState } from "./actionRunsStore";
import { derived, fixtureNow, link, states } from "./fixtures/actionRuns";
import { ActionRunsPanel } from "./ActionRunsPanel";
import { PullPanel } from "./fixtures/pullPanel";

export const name = "Pull request runs";
export const note = "The workflow runs on a linked pull request's head commit; watching one links it";
export const composition = {
  default: [{ part: "src/ui/RunList.organism.part.tsx", state: "default" }, { part: "src/actionRuns/ActionRunRow.molecule.part.tsx", state: "Derived" }],
  Loading: [{ part: "src/ui/RunList.organism.part.tsx", state: "Loading" }],
  MissingPermission: [{ part: "src/ui/RunList.organism.part.tsx", state: "Failed" }],
};
export const expectations = {
  UnderPullRequest: { empty: { reason: "The pull request panel is a modal dialog portaled to the document body, outside #caliper-host. The PNG shows it." } },
} as const;

const AT = "2026-10-15T12:00:00.000Z";
function Scenario({ initial, number = 142, inPanel = false }: { initial: ActionRunsState; number?: number; inPanel?: boolean }) {
  const [state, setState] = useState(initial);
  const runOf = (key: string): ActionRun | undefined => derived.flatMap((group) => group.runs).find((run) => runKey(run) === key);
  /** Watching a derived run links it, as the server does. */
  const watch = (key: string, runId: number, on: boolean) => setState((current) => {
    if (current.load.type !== "ready") return current;
    const next = on ? { kind: "watching" as const, since: AT, wakes: 0 } : { kind: "stopped" as const, reason: "Stopped by you", at: AT };
    const known = current.load.items.some((item) => runKey(item.link) === key);
    const items = known ? current.load.items.map((item) => runKey(item.link) === key ? { ...item, link: { ...item.link, watch: next } } : item)
      : [...current.load.items, { link: { ...link(runId, next, "pull") }, run: runOf(key) ?? null }];
    return { ...current, load: { ...current.load, items } };
  });
  const section = <PullRunsSection number={number} state={state} now={fixtureNow} readOnly={false} onRefresh={() => setState(states.ready)} onWatch={watch} />;
  if (!inPanel) return section;
  // In place: under the linked pull request's checks, in the session's pull request panel.
  // The Actions tab beside it shares the same local runs, so a run watched here shows there too.
  return <PullPanel below={() => section} actions={<ActionRunsPanel state={state} now={fixtureNow} readOnly={false} actions={{
    onRefresh: () => setState(states.ready), onLink: async (run) => { setState((current) => ({ ...current, notice: { text: `This preview cannot link run ${String(run)}.` } })); return false; }, onUnlink: (key) => setState((current) => current.load.type !== "ready" ? current
      : { ...current, load: { ...current.load, items: current.load.items.filter((item) => runKey(item.link) !== key) } }),
    onWatch: watch, onOpenRun: (key, runId) => setState((current) => ({ ...current, detail: { key, runId, load: { type: "ready" } } })),
    onCloseRun: () => setState((current) => ({ ...current, detail: undefined })) }} />} />;
}
export default function Runs() { return <Scenario initial={states.ready} />; }
export function Loading() { return <Scenario initial={states.loading} />; }
export function NoRuns() { return <Scenario initial={{ ...states.ready, load: { type: "ready", items: [], derived: [{ pull: 142, headSha: derived[0]!.headSha, runs: [] }] } }} />; }
export function MissingPermission() { return <Scenario initial={states.broken} />; }
export function UnderPullRequest() { return <Scenario initial={states.ready} inPanel />; }
