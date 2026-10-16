import { useState } from "react";
import { PullRunsSection } from "./PullRunsSection";
import { runKey, type ActionRun } from "./actionRunApi";
import type { ActionRunsState } from "./actionRunsStore";
import { derived, fixtureNow, link, states } from "./fixtures/actionRuns";
import { pullItem } from "./fixtures/pull";
import { PullRequestReview } from "../ui/PullRequestReview";

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
  const section = <PullRunsSection number={number} state={state} now={fixtureNow} readOnly={false} onRefresh={() => setState(states.ready)}
    onWatch={(key, runId, on) => setState((current) => {
      if (current.load.type !== "ready") return current;
      const watch = on ? { kind: "watching" as const, since: AT, wakes: 0 } : { kind: "stopped" as const, reason: "Stopped by you", at: AT };
      const known = current.load.items.some((item) => runKey(item.link) === key);
      const items = known ? current.load.items.map((item) => runKey(item.link) === key ? { ...item, link: { ...item.link, watch } } : item)
        : [...current.load.items, { link: { ...link(runId, watch, "pull") }, run: runOf(key) ?? null }];
      return { ...current, load: { ...current.load, items } };
    })} />;
  if (!inPanel) return section;
  // In place: under the linked pull request's checks, in the session's pull request panel.
  return <PullRequestReview load={{ type: "ready", items: [pullItem] }} selected={number} onSelect={() => {}} reading={new Set()} notice={undefined} writing={false}
    now={fixtureNow} onRefresh={() => {}} onAsk={() => {}} onWatch={() => {}} onLink={async () => false} onUnlink={() => {}} onMerge={() => {}} onClose={() => {}}
    extraView={{ label: "Actions", title: "Workflow runs", tone: "failed", content: null }} belowPull={() => section} />;
}
export default function Runs() { return <Scenario initial={states.ready} />; }
export function Loading() { return <Scenario initial={states.loading} />; }
export function NoRuns() { return <Scenario initial={{ ...states.ready, load: { type: "ready", items: [], derived: [{ pull: 142, headSha: derived[0]!.headSha, runs: [] }] } }} />; }
export function MissingPermission() { return <Scenario initial={states.broken} />; }
export function UnderPullRequest() { return <Scenario initial={states.ready} inPanel />; }
