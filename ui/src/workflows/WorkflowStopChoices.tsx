import { useState } from "react";
import { ActionFooter } from "../ui/ActionFooter";
import { ReplyBox } from "../ui/ReplyBox";
import type { StopDecision, StopEntry } from "./workflowsModel";

/** Shape: the choices at a workflow stop. Asking for changes opens a box for what to change, in place. */
export function WorkflowStopChoices({ entry, deciding, onDecide, onReview }: {
  entry: StopEntry;
  deciding: boolean;
  onDecide: (decision: StopDecision, note?: string) => Promise<boolean>;
  onReview?: (() => void) | undefined;
}) {
  const [changing, setChanging] = useState(false);
  if (changing) return <ReplyBox label={`What should change at ${entry.stageName}?`} placeholder="Say what to change" sendLabel="Send changes" autoFocus
    secondary={{ label: "Back", onPress: () => setChanging(false) }}
    onSend={async (text) => { if (!await onDecide("changes", text)) throw new Error("Not sent"); }} />;
  if (entry.stop === "land") return <ActionFooter note={deciding ? "Landing…" : "Forgerie lands each child branch in the order the children started. Each one rebases onto the default branch first."}
    actions={[
      ...(onReview === undefined ? [] : [{ label: "Review branches", onPress: onReview }]),
      { label: "Ask for changes", onPress: () => setChanging(true), disabled: deciding },
      { label: "Land all", onPress: () => { void onDecide("land"); }, tone: "primary" as const, disabled: deciding },
    ]} />;
  return <ActionFooter note={deciding ? "Sending…" : "Later stages start when you approve."} actions={[
    { label: "Ask for changes", onPress: () => setChanging(true), disabled: deciding },
    { label: "Approve", onPress: () => { void onDecide("approve"); }, tone: "primary", disabled: deciding },
  ]} />;
}
