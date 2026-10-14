import { useEffect, useState } from "react";
import { ActionFooter, type FooterAction } from "../ui/ActionFooter";
import { Lede } from "../ui/Lede";
import { MarkdownProse } from "../ui/MarkdownProse";
import { PageSection } from "../ui/PageSection";
import { RuleBlock } from "../ui/RuleBlock";
import { SplitSheet } from "../ui/SplitSheet";
import { TermList } from "../ui/TermList";
import { useNow } from "../ui/useNow";
import { nextRetry } from "../childAgents/childAgentsModel";
import { DecisionList } from "../decisions/DecisionList";
import { OverturnFooter } from "../decisions/OverturnFooter";
import { decisionsOfRun, type DecisionLogActions, type DecisionLogView } from "../decisions/decisionsModel";
import type { WorkerModels } from "./WorkerModelPicker";
import { WorkflowEntryView } from "./WorkflowEntryView";
import { WorkflowLiveRoute } from "./WorkflowLiveRoute";
import { WorkflowPlan } from "./WorkflowPlan";
import { WorkflowWorkerPane, type WorkerRecord } from "./WorkflowWorkerPane";
import { liveRoute, proseWorkers, ranFor, startedAgo, waitingStop, type StageProgress } from "./workflowLive";
import { workflowInputLabel } from "./workflowInputLabel";
import { planOf, planTitle } from "./workflowPlan";
import { runStatus, type ChildLook, type StopDecision, type WorkflowRun } from "./workflowsModel";

const OUTCOME = { completed: "Finished", failed: "Failed", stopped: "Stopped" } as const;

/**
 * Shape: a workflow while it runs, in the same sheet it started from. The rail is the live route, with one block per
 * worker run. The plan pane shows the plan with the stage at work marked; a stop that waits on the reader leads it as
 * the chat's own decision card, and once the run ends, its result leads it. A worker opens its live record in the
 * plan's place, with a box to steer it, Stop, and its model. In one column the route comes first. Under the route,
 * the decisions the run's agents made without the reader; Overturn opens a note in the foot.
 */
export function WorkflowRunView({ run, looks, record, models, deciding = false, cancelling = false, error, decisions, initialWorker, now: clock = Date.now,
  onDecide, onReview, onOpenWorker, onRetryRecord, onSteer, onStopWorker, onDismissRecordError, onModel, onStopRun, onClose }: {
  run: WorkflowRun;
  /** What the session knows about the run's children. */
  looks: readonly ChildLook[];
  /** The open worker's record, as the child agents store holds it. */
  record?: WorkerRecord | undefined;
  models: WorkerModels;
  /** A decision at the waiting stop is on its way. */
  deciding?: boolean;
  cancelling?: boolean;
  onStopRun: () => Promise<boolean>;
  /** Why the last action on the run failed. */
  error?: string | undefined;
  /** The session's decision log; the sheet lists the run's part of it. Absent: the session keeps no log. */
  decisions?: { log: DecisionLogView; actions: DecisionLogActions } | undefined;
  /** The worker open when the sheet opens, as "stage/name". */
  initialWorker?: string | undefined;
  now?: () => number;
  onDecide: (stage: string, decision: StopDecision, note?: string) => Promise<boolean>;
  /** Opens the children, to read their branches before landing. */
  onReview?: (() => void) | undefined;
  /** The worker run whose record to read, or undefined when none is open. */
  onOpenWorker: (conversationId: number | undefined) => void;
  onRetryRecord: (conversationId: number) => void;
  onSteer: (conversationId: number, text: string) => Promise<void>;
  onStopWorker: (conversationId: number) => void;
  onDismissRecordError: () => void;
  /** Resolves true once the server stored the model. Null: the session's model. */
  onModel: (worker: string, model: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const now = useNow(clock, nextRetry(looks));
  const [selected, setSelected] = useState<string | undefined>(initialWorker);
  const [target, setTarget] = useState<{ stage: string; at: number }>();
  const [chosen, setChosen] = useState<string>();
  const [confirmStop, setConfirmStop] = useState(false);
  const stages = run.stages ?? [];
  const live = liveRoute(run, looks, now);
  const prose = stages.length === 0 ? proseWorkers(run, looks, now) : undefined;
  const worker = [...live.flatMap((stage) => stage.workers), ...prose ?? []].find((candidate) => candidate.key === selected);
  const conversation = worker?.conversationId;
  // The record follows the worker's latest run, such as a new review round.
  useEffect(() => { if (selected !== undefined) onOpenWorker(conversation); }, [selected, conversation]);
  const back = () => { setSelected(undefined); onOpenWorker(undefined); };
  const progress: Record<string, StageProgress> = Object.fromEntries(live.map((stage) => [stage.stage.id, stage.progress]));
  const plan = planOf(run.definition.text, stages);
  const stop = waitingStop(run);
  const running = run.state.kind === "running";

  const lead = worker !== undefined ? undefined
    : run.state.kind === "finished" ? <RuleBlock title={OUTCOME[run.state.outcome]} tone={run.state.outcome === "failed" ? "bad" : "plain"}>
      <MarkdownProse text={run.state.result} />
    </RuleBlock>
    : stop !== undefined ? <WorkflowEntryView entry={stop} run={run} deciding={deciding}
      onDecide={(decision, note) => onDecide(stop.stage, decision, note)} onReview={onReview} />
    : undefined;
  const document = worker !== undefined
    ? <WorkflowWorkerPane key={worker.key} worker={worker} record={record} models={models} modelEditable={running && worker.declared} now={now}
      onBack={back} onStop={() => { if (conversation !== undefined) onStopWorker(conversation); }}
      onRetry={() => { if (conversation !== undefined) onRetryRecord(conversation); }} onDismissError={onDismissRecordError}
      onSteer={async (text) => { if (conversation !== undefined) await onSteer(conversation, text); }}
      onModel={async (model) => { if (!await onModel(worker.name, model ?? null)) throw new Error("The model did not change."); }} />
    : plan.overview === "" && plan.sections.length === 0 ? <Lede>This run has no plan text. The agent follows the workflow it started.</Lede>
    : <WorkflowPlan plan={plan} original={stages} progress={progress} target={target} />;
  const log = decisions?.log;
  const overturn = decisions?.actions.onOverturn;
  const mine = log?.decisions === undefined ? undefined : decisionsOfRun(log.decisions, run.id);
  const chosenDecision = mine?.find((decision) => decision.id === chosen && decision.state.kind === "standing");
  const overturning = log?.overturning !== undefined;
  const closeOverturn = () => { setChosen(undefined); decisions?.actions.onDismissError(); };
  const inputs = Object.entries(run.inputs).sort(([a], [b]) => Number(b === "task") - Number(a === "task"));
  const rail = <>
    <WorkflowLiveRoute stages={live} prose={prose} selected={selected} known={models.known}
      onWorker={setSelected} onStage={(stage) => { setSelected(undefined); onOpenWorker(undefined); setTarget({ stage, at: (target?.at ?? 0) + 1 }); }} />
    {inputs.length > 0 && <PageSection title="Inputs">
      <TermList empty="Empty" terms={inputs.map(([name, value]) => ({ key: name, term: workflowInputLabel(name), value: String(value) }))} />
    </PageSection>}
    {decisions !== undefined && <DecisionList title="Decisions" placement="document" decisions={mine} readError={log?.readError} now={clock()}
      target={chosenDecision?.id} busy={overturning} onRetry={decisions.actions.onRetry}
      onChoose={overturn === undefined ? undefined : (id) => { decisions.actions.onDismissError(); setChosen((current) => current === id ? undefined : id); }} />}
  </>;
  const next = stages.find((stage) => stage.stop !== undefined && run.stops?.[stage.id]?.state !== "approved");
  const state = run.state;
  const stopping = cancelling || state.kind === "stopping";
  const stopActions: FooterAction[] = state.kind === "finished" ? [] : confirmStop && !stopping
    ? [{ label: "Keep running", onPress: () => setConfirmStop(false) },
      { label: "Stop now", tone: "danger", onPress: () => { void onStopRun().then((done) => { if (done) setConfirmStop(false); }); } }]
    : [{ label: stopping ? "Stopping…" : "Stop the run", tone: "danger", disabled: stopping || deciding,
      onPress: () => setConfirmStop(true) }];
  const footNote = stopping ? "Stopping this chat's current turn, children, retries and queued workflow messages…"
    : confirmStop && running ? "Stop this chat's current turn and child work, including retries and queued messages? Files and commits stay. Completed actions and deployed services are not undone."
    : state.kind === "finished" ? `${OUTCOME[state.outcome]}. ${ranFor(run.startedAt, state.finishedAt)}.` : `${startedAgo(run.startedAt, clock())}.${stop !== undefined ? ` ${stop.stageName} waits for you.`
    : next !== undefined ? ` The next stop for you is ${next.name}.` : ""}`;
  return <SplitSheet title={planTitle(run.definition.text, run.definition.name)}
    subtitle={<>{planTitle(run.definition.text, run.definition.name) !== run.definition.name && <code>{run.definition.name}</code>}<span>{runStatus(run)}</span></>}
    closeLabel="Close the run" onClose={onClose} railFirst detail={worker !== undefined}
    lead={lead} document={document} documentLabel={worker === undefined ? "Plan" : worker.name}
    rail={rail} railLabel="The run" foot={decisions !== undefined && overturn !== undefined && (chosenDecision !== undefined || log?.error !== undefined)
      ? <OverturnFooter target={chosenDecision} pending={overturning} error={log?.error} onCancel={closeOverturn} onDismissError={closeOverturn}
        onSend={async (text) => { if (chosenDecision === undefined) return false; const done = await overturn(chosenDecision.id, text); if (done) setChosen(undefined); return done; }} />
      : <ActionFooter note={footNote} problem={error} actions={stopActions} />} />;
}
