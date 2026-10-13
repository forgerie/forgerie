import { useState } from "react";
import { Lede } from "../ui/Lede";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { RouteMap } from "../ui/RouteMap";
import { SheetDialog } from "../ui/SheetDialog";
import { useNow } from "../ui/useNow";
import { nextRetry } from "../childAgents/childAgentsModel";
import { DecisionList } from "../decisions/DecisionList";
import { OverturnFooter } from "../decisions/OverturnFooter";
import { decisionsOfRun, type DecisionLogActions, type DecisionLogView } from "../decisions/decisionsModel";
import { routeSteps, runStatus, type ChildLook, type WorkflowRun } from "./workflowsModel";

/**
 * Shape: one workflow run as its live route, then the decisions its agents
 * made without the reader. Each started worker opens its child. The stop cards
 * stay in the thread; this sheet shows where the run stands and what was
 * settled on the way. A worker that waits to retry a model error counts down
 * to its next try. Overturn opens a note field in the footer, which keeps a
 * failure's reason while the sheet stays open.
 */
export function WorkflowRunSheet({ run, workers, decisions, onOpenChild, onClose, now: clock = Date.now }: {
  run: WorkflowRun;
  /** What the session knows about the run's children: their agents, branches, and questions. */
  workers: readonly ChildLook[];
  /** The session's decision log; the sheet lists the run's part of it. Absent: the session keeps no log. */
  decisions?: { log: DecisionLogView; actions: DecisionLogActions } | undefined;
  onOpenChild: (name: string) => void;
  onClose: () => void;
  /** The clock a retry counts down on. */
  now?: () => number;
}) {
  const now = useNow(clock, nextRetry(workers));
  const stages = run.stages ?? [];
  const [chosen, setChosen] = useState<string>();
  const log = decisions?.log;
  const overturn = decisions?.actions.onOverturn;
  const mine = log?.decisions === undefined ? undefined : decisionsOfRun(log.decisions, run.id);
  const target = mine?.find((decision) => decision.id === chosen && decision.state.kind === "standing");
  const pending = log?.overturning !== undefined;
  const close = () => { setChosen(undefined); decisions?.actions.onDismissError(); };
  const footer = decisions !== undefined && overturn !== undefined && (target !== undefined || log?.error !== undefined)
    ? <OverturnFooter target={target} pending={pending} error={log?.error} onCancel={close} onDismissError={close}
      onSend={async (note) => { if (target === undefined) return false; const done = await overturn(target.id, note); if (done) setChosen(undefined); return done; }} />
    : undefined;
  return <SheetDialog title={run.definition.name} subtitle={runStatus(run)} closeLabel="Close the run" onClose={onClose} footer={footer}>
    {run.state.kind === "finished" ? <MarkdownFragment text={run.state.result} />
      : stages.length === 0 ? <Lede>This workflow declares no stages. The agent follows its prose; its children are in the child agents panel.</Lede> : null}
    {stages.length > 0 && <RouteMap label={`${run.definition.name} route`} steps={routeSteps(stages, run, workers, onOpenChild, now)} />}
    {decisions !== undefined && <DecisionList title="Decisions" placement="document" decisions={mine} readError={log?.readError} now={now}
      target={target?.id} busy={pending} onRetry={decisions.actions.onRetry}
      onChoose={overturn === undefined ? undefined : (id) => { decisions.actions.onDismissError(); setChosen((current) => current === id ? undefined : id); }} />}
  </SheetDialog>;
}
