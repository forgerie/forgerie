import { useState } from "react";
import { RunList } from "../ui/RunList";
import { TextSubmit } from "../ui/TextSubmit";
import { runKey } from "./actionRunApi";
import { runInput } from "./actionRunModel";
import type { ActionRunsState } from "./actionRunsStore";
import { ActionRunDetail } from "./ActionRunDetail";
import { ActionRunRow } from "./ActionRunRow";
import { RunProblem } from "./RunProblem";

export interface ActionRunsActions {
  onRefresh: () => void;
  /** Resolves true once the server linked it. */
  onLink: (run: number | string) => Promise<boolean>;
  onUnlink: (key: string, runId: number) => void;
  onWatch: (key: string, runId: number, on: boolean) => void;
  onOpenRun: (key: string, runId: number) => void;
  onCloseRun: () => void;
}

/**
 * Shape: the session's linked Actions runs, oldest link first, with a field
 * to link another. A row opens its jobs in place of the list.
 */
export function ActionRunsPanel({ state, now, readOnly, actions }: { state: ActionRunsState; now: number; readOnly: boolean; actions: ActionRunsActions }) {
  const [typed, setTyped] = useState<string>();
  const items = state.load.type === "ready" ? state.load.items : [];
  const refusalOf = (key: string) => state.notice?.key === key ? state.notice.text : undefined;
  const open = state.detail ? items.find((item) => runKey(item.link) === state.detail?.key) : undefined;
  if (state.detail && open) return <ActionRunDetail key={state.detail.key} item={open} detail={state.detail.load} refusal={refusalOf(state.detail.key)}
    now={now} writing={state.writing} readOnly={readOnly} onBack={actions.onCloseRun}
    onWatch={(on) => actions.onWatch(runKey(open.link), open.link.runId, on)} onUnlink={() => actions.onUnlink(runKey(open.link), open.link.runId)} />;

  const link = async (value: string) => {
    const run = runInput(value);
    if (run === undefined) { setTyped("Paste a run's URL from GitHub, such as …/actions/runs/18234561230, or its ID."); throw new Error("not a run"); }
    setTyped(undefined);
    if (!await actions.onLink(run)) throw new Error("refused");
  };
  const failure = state.load.type === "failed" ? state.load.message : state.listError;
  const watched = items.filter((item) => item.link.watch.kind === "watching").length;
  return <RunList title="Linked runs" count={items.length > 0 ? `${String(items.length)} linked${watched > 0 ? `, ${String(watched)} watched` : ""}` : undefined}
    loading={state.load.type === "loading" || state.load.type === "idle"} busy={state.listing}
    alert={failure ? { text: <RunProblem error={failure} subject="the session's runs" lead="Forgerie could not read the runs." />, action: { label: "Try again", onPress: actions.onRefresh } } : undefined}
    empty={state.load.type === "ready" ? <p><strong>No linked runs</strong>
      {readOnly ? "This session links no GitHub Actions run." : "Link a workflow run to follow it here. The agent links the runs it dispatches, and watching a run on a pull request links it too."}</p> : undefined}
    rows={items.map((item) => {
      const key = runKey(item.link);
      return { key, node: <ActionRunRow runId={item.link.runId} run={item.run} link={item.link} error={item.error} refusal={refusalOf(key)} now={now}
        busy={state.reading.has(key)} writing={state.writing} onOpen={() => actions.onOpenRun(key, item.link.runId)}
        onWatch={readOnly ? undefined : (on) => actions.onWatch(key, item.link.runId, on)} onUnlink={readOnly ? undefined : () => actions.onUnlink(key, item.link.runId)} /> };
    })}
    foot={readOnly ? undefined : <TextSubmit label="Link a run" placeholder="https://github.com/owner/repo/actions/runs/… or a run ID" action={state.writing ? "Linking…" : "Link"}
      pending={state.writing} error={typed ?? (state.notice && state.notice.key === undefined ? state.notice.text : undefined)} onSubmit={link} />} />;
}
