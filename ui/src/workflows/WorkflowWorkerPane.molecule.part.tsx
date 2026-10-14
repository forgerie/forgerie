import { WorkflowWorkerPane } from "./WorkflowWorkerPane";
import { liveRoute } from "./workflowLive";
import { API_TRANSCRIPT, LOOKS, RUN_WORKING, SHEET_NOW, WORKER_MODELS } from "./fixtures/sheet";

export const name = "Workflow worker pane";
export const note = "One worker of a run: its record, Stop while it works, its model from the next turn, and a box to steer it";

const workers = liveRoute(RUN_WORKING, LOOKS, SHEET_NOW).flatMap((stage) => stage.workers);
const handlers = { onBack: () => {}, onModel: async () => {}, onSteer: async () => {}, onStop: () => {}, onRetry: () => {}, onDismissError: () => {} };

export default function Working() {
  return <WorkflowWorkerPane worker={workers.find((worker) => worker.name === "api")!} record={{ transcript: API_TRANSCRIPT }} models={WORKER_MODELS} modelEditable now={SHEET_NOW} {...handlers} />;
}
export function NotStarted() {
  return <WorkflowWorkerPane worker={workers.find((worker) => worker.name === "review")!} models={WORKER_MODELS} modelEditable now={SHEET_NOW} {...handlers} />;
}
export function SendFailed() {
  return <WorkflowWorkerPane worker={workers.find((worker) => worker.name === "page")!} record={{ transcript: { busy: false, messages: API_TRANSCRIPT.messages.slice(0, 3) },
    error: "page is not running. Start it again from the child agents panel." }} models={WORKER_MODELS} modelEditable now={SHEET_NOW} {...handlers} />;
}
