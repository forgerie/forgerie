import { AlertCard } from "../ui/AlertCard";
import { BlockRun } from "../ui/BlockRun";
import { DetailPane } from "../ui/DetailPane";
import { ExchangeLog, type ExchangeLine } from "../ui/ExchangeLog";
import { NoticeBar } from "../ui/NoticeBar";
import { ReplyBox } from "../ui/ReplyBox";
import { TextButton } from "../ui/TextButton";
import { exchangeLines } from "../childAgents/childExchange";
import { retryCount, retryWait, type ChildTranscript } from "../childAgents/childAgentsModel";
import { defaultModelLabel, WorkerModelPicker, type WorkerModels } from "./WorkerModelPicker";
import { modelTiming, type LiveWorker } from "./workflowLive";

/** A worker's live record as the session's child agents store holds it. */
export interface WorkerRecord {
  transcript?: ChildTranscript | undefined;
  /** Why the record could not be read. */
  readError?: string | undefined;
  /** Why the last action on the worker failed, such as a message it did not take. */
  error?: string | undefined;
}

/**
 * Shape: one worker of a run, opened beside the route: its blocks, name, agent and where it stands, Stop while a
 * turn runs, its model, its live record, and a box to steer it. A model change applies from the worker's next turn,
 * never to the turn in progress, and the bar says so. A worker that has not started shows where its record will be.
 */
export function WorkflowWorkerPane({ worker, record, models, modelEditable, now, onBack, onModel, onSteer, onStop, onRetry, onDismissError }: {
  worker: LiveWorker;
  record?: WorkerRecord | undefined;
  models: WorkerModels;
  /** The run is running and the route declares this worker. */
  modelEditable: boolean;
  now: number;
  onBack: () => void;
  onModel: (model: string | undefined) => Promise<void>;
  onSteer: (text: string) => Promise<void>;
  onStop: () => void;
  onRetry: () => void;
  onDismissError: () => void;
}) {
  const reading = worker.started && record?.transcript === undefined && record?.readError === undefined;
  const lines: ExchangeLine[] = [
    ...record?.transcript === undefined ? [] : exchangeLines(worker.name, record.transcript),
    ...record?.readError === undefined ? [] : [{ kind: "block" as const, key: "read-failed", content: <AlertCard label={`${worker.name}'s record could not be read`}
      title="The record could not be read" actions={[{ label: "Retry", onPress: onRetry }]}>{record.readError}</AlertCard> }],
    ...worker.retry === undefined ? [] : [{ kind: "block" as const, key: "retry", content: <AlertCard label={`${worker.name} is retrying`} tone="warn"
      title={retryCount(worker.retry)} code={worker.retry.error} codeLabel="Error" codeLines={6}>
      The model call failed. Forgerie tries again on its own, up to {worker.retry.max} times. <strong>{retryWait(worker.retry, now)}.</strong>
    </AlertCard> }],
  ];
  return <DetailPane back={{ label: "Plan", onPress: onBack }} label={`${worker.name}'s record`}
    title={<><BlockRun tones={worker.tones} /><code>{worker.name}</code><span>{worker.agent ?? "general helper"}</span></>}
    status={worker.status}
    actions={worker.busy ? <TextButton label="Stop" tone="danger" title={`Stop ${worker.name}`} onPress={onStop} /> : undefined}
    bar={worker.declared ? <>
      <span>Model</span>
      <WorkerModelPicker worker={worker.name} agent={worker.agent} model={worker.model} models={models} disabled={!modelEditable}
        reset={worker.model === undefined ? undefined : { to: undefined, label: `Use ${defaultModelLabel(worker.agent).replace(/^Session/u, "the session")}` }} onChange={onModel} />
      {modelEditable && <span>{modelTiming(worker)}</span>}
    </> : <span>The agent chose this worker's model.</span>}
    foot={worker.started ? <>
      {record?.error !== undefined && <NoticeBar tone="alert" message={record.error} actions={[{ label: "Dismiss", onPress: onDismissError }]} />}
      <ReplyBox key={worker.key} label={`Message ${worker.name}`} sendLabel={`Send to ${worker.name}`}
        placeholder={worker.busy ? `Steer ${worker.name} while it works` : `Ask ${worker.name} a follow-up`} onSend={onSteer} />
    </> : undefined}>
    <ExchangeLog lines={lines} follow={worker.busy}
      empty={!worker.started ? "This worker has not started. Its record shows here when it does." : reading ? "Reading the record…" : "No messages yet."} />
  </DetailPane>;
}
