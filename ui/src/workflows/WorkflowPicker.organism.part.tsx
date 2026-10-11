import { WorkflowPicker } from "./WorkflowPicker";
import { SAVED } from "./fixtures/runs";

export const name = "Workflow picker";
export const note = "The saved workflows a session can start; choosing one opens its plan";

export default function Saved() {
  return <WorkflowPicker saved={SAVED} loading={false} onChoose={() => {}} onClose={() => {}} />;
}
export function WithBroken() {
  return <WorkflowPicker saved={SAVED} broken={[{ name: "old-flow", error: "Invalid workflow stages: Land stage land must be the last stage" }]}
    loading={false} onChoose={() => {}} onClose={() => {}} />;
}
export function Empty() {
  return <WorkflowPicker saved={[]} loading={false} onChoose={() => {}} onClose={() => {}} />;
}
