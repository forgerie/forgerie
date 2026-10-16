import { RunList } from "../ui/RunList";
import { runKey, type ActionRunItem } from "./actionRunApi";
import { shortSha } from "./actionRunModel";
import type { ActionRunsState } from "./actionRunsStore";
import { ActionRunRow } from "./ActionRunRow";
import { RunProblem } from "./RunProblem";

/**
 * Shape: the workflow runs on one linked pull request's head commit, under
 * that pull request. Nothing links them until the reader watches one; a run
 * that is linked already shows its link's watch.
 */
export function PullRunsSection({ number, state, now, readOnly, onWatch, onRefresh }: {
  number: number;
  state: ActionRunsState;
  now: number;
  readOnly: boolean;
  onWatch: (key: string, runId: number, on: boolean) => void;
  onRefresh: () => void;
}) {
  const ready = state.load.type === "ready" ? state.load : undefined;
  const group = ready?.derived.find((candidate) => candidate.pull === number);
  const linked = new Map<string, ActionRunItem>((ready?.items ?? []).map((item) => [runKey(item.link), item]));
  const runs = group?.runs ?? [];
  const failure = state.load.type === "failed" ? state.load.message : group?.error;
  return <RunList title={group ? `Workflow runs on ${shortSha(group.headSha)}` : "Workflow runs"} count={runs.length > 0 ? `${String(runs.length)} ${runs.length === 1 ? "run" : "runs"}` : undefined}
    // A pull request linked since the last read has no runs yet; it waits on the reread instead of saying there are none.
    loading={state.load.type === "loading" || state.load.type === "idle" || (state.listing && !group)} busy={state.listing && group !== undefined}
    alert={failure ? { text: <RunProblem error={failure} subject="the runs on this commit" lead="Forgerie could not read the runs on this commit." />,
      action: { label: "Try again", onPress: onRefresh } } : undefined}
    empty={ready && !failure && !(state.listing && !group) ? <p>{group ? "GitHub reports no workflow run on this commit yet." : `GitHub listed no runs for #${String(number)}.`}</p> : undefined}
    rows={runs.map((run) => {
      const key = runKey(run);
      const item = linked.get(key);
      return { key, node: <ActionRunRow runId={run.runId} run={item?.run ?? run} link={item?.link} now={now} busy={state.reading.has(key)} writing={state.writing}
        refusal={state.notice?.key === key ? state.notice.text : undefined}
        onWatch={readOnly ? undefined : (on) => onWatch(key, run.runId, on)} /> };
    })} />;
}
