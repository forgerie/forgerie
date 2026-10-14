import { useState, type ReactNode } from "react";
import { WorkRow, type WorkState } from "./WorkRow";
import { TermList } from "./TermList";

export const name = "Work row";
export const note = "One unit of live work in an owner tree: a state mark, words, a time, a record on press, and the rows it owns";

const record = <TermList empty="Not known" terms={[{ key: "kind", term: "Kind", value: "build.step" }, { key: "id", term: "Step", value: "42, owned by step 40" }]} />;

function Row({ state, label, subject, detail, warning, time, startOpen = false, folded, children }: {
  state: WorkState; label: string; subject?: string; detail: string; warning?: string; time?: string; startOpen?: boolean;
  folded?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  const [fold, setFold] = useState(folded);
  return <WorkRow state={state} label={label} subject={subject} detail={detail} warning={warning} time={time} open={open} onToggle={() => setOpen(!open)}
    body={record} fold={fold ? { label: fold, onUnfold: () => setFold(undefined) } : undefined}>{children}</WorkRow>;
}

export default function Tree() {
  return <ul>
    <Row state="waiting" label="Bake the bread" detail="Waiting for 2 steps" time="1 m 12 s">
      <Row state="running" label="Knead" subject="dough/rye.txt" detail="Running" time="41 s" warning="Stops if the oven restarts" />
      <Row state="finishing" label="Proof" detail="Finishing" time="3 s" />
    </Row>
    <Row state="pending" label="Slice" detail="Waiting to start" />
  </ul>;
}
export function EveryMark() {
  return <ul>
    <Row state="pending" label="Pending" detail="Waiting to start" />
    <Row state="running" label="Running" detail="Running" time="4 s" />
    <Row state="waiting" label="Waiting" detail="Waiting for 1 step" time="2 m 3 s" />
    <Row state="finishing" label="Finishing" detail="Finishing" time="9 s" />
    <Row state="blocked" label="Blocked" detail="Cannot run: saved by a newer version" time="2 h 14 m" />
  </ul>;
}
export function Opened() {
  return <ul><Row state="running" label="Copy" subject="photos/2026/october/very-long-folder-name/holiday-at-the-lake.jpg" detail="Running" time="12 s" startOpen /></ul>;
}
export function Folded() {
  return <ul>
    <Row state="finishing" label="Helper" subject="review" detail="Working. Its answer comes back here." time="52 s" folded="2 steps inside">
      <Row state="running" label="Reading" detail="Running" time="50 s" />
      <Row state="waiting" label="Reply" detail="Waits for the helper to finish" time="52 s" />
    </Row>
  </ul>;
}
