import { WorkflowRunView } from "./WorkflowRunView";
import { LOOKS, RUN_AT_STOP, RUN_WORKING, SHEET_NOW, WORKER_MODELS } from "./fixtures/sheet";

export const name = "Workflow run view";
export const note = "A run: the live route in the rail, the plan marked where the run stands, a waiting stop's card on top";

const handlers = { onDecide: async () => true, onOpenWorker: () => {}, onRetryRecord: () => {}, onSteer: async () => {}, onStopWorker: () => {},
  onDismissRecordError: () => {}, onModel: async () => true, onClose: () => {} };

export default function Working() {
  return <WorkflowRunView run={RUN_WORKING} looks={LOOKS} models={WORKER_MODELS} now={() => SHEET_NOW} {...handlers} />;
}
export function AtStop() {
  return <WorkflowRunView run={RUN_AT_STOP} looks={[]} models={WORKER_MODELS} now={() => SHEET_NOW} {...handlers} />;
}
