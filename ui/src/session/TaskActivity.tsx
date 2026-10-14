import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { useNow } from "../ui/useNow";
import { ListSection } from "../ui/ListSection";
import { WorkRow, type WorkState } from "../ui/WorkRow";
import { TermList } from "../ui/TermList";
import { TextButton } from "../ui/TextButton";
import { AlertCard } from "../ui/AlertCard";
import { Consequence } from "../ui/Consequence";
import { LoadingLines } from "../ui/LoadingLines";
import { ReadoutLine } from "../ui/ReadoutLine";
import {
  buildTaskTree, countRows, elapsed, FOLD_ABOVE_ROWS, groupCount, nodeKey, nodeStatus, recordText, restartNote, taskDetail, taskRecord, tasksLabel,
  type TaskNode, type TaskStatus,
} from "./taskActivityModel";
import type { TaskActivityState } from "./taskActivityStore";


const STATE: Record<TaskStatus, WorkState> = { pending: "pending", running: "running", waiting: "waiting", completing: "finishing", blocked: "blocked" };
const STOPS = "Stops if Forgerie restarts, and is not run again";
const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Shape: the session's live Durable tasks, in the status chip's panel. Two
 * groups: this turn's own work, and the background, where each child agent
 * is one row with its tasks hung under it. Each row opens to its public
 * record. One note under the lists says what a restart would do now. It reads
 * nothing itself: the binding passes the last read and how it went.
 */
export function TaskActivity({ view, running, onRetry, onCopy, now = Date.now, clock = clockTime, initialOpen = [] }: {
  /** The last good read, and how the latest read went. */
  view: TaskActivityState;
  /** The session's own turn runs, so empty groups still say so. */
  running: boolean;
  onRetry: () => void;
  /** Absent where the page cannot write to the clipboard. */
  onCopy?: ((text: string) => Promise<void>) | undefined;
  now?: () => number;
  /** How a record shows a start time. */
  clock?: (at: number) => string;
  /** Rows that start open, by `nodeKey`. */
  initialOpen?: readonly string[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen));
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<{ key: string; label: string }>();
  const activity = view.activity;
  const tree = activity?.kind === "ready" ? buildTaskTree(activity) : undefined;
  const current = useNow(now, tree && tree.rows > 0 ? 0 : undefined);

  if (activity?.kind === "unsupported") return null;
  // A failed read may clear on the next try, so it takes the warn tone of a lost connection, not the failure tone.
  const failed = (error: string, kept: boolean) => <AlertCard label="Could not read tasks" tone="warn" title="Could not read tasks"
    code={error} codeLabel="Reason" actions={[{ label: "Try again", onPress: onRetry }]}>
    <p>{kept ? "The list below is the last one read, and may be out of date." : "Forgerie reads them again when they change, or when you try again."}</p>
  </AlertCard>;
  if (tree === undefined) return view.error !== undefined ? failed(view.error, false) : <LoadingLines label="Reading tasks…" widths={[]} />;
  if (tree.rows === 0 && !running && view.error === undefined && !view.stale) return null;

  const toggle = (key: string) => {
    setOpen((keys) => { const next = new Set(keys); if (!next.delete(key)) next.add(key); return next; });
    setCopied(undefined);
  };
  const copy = (key: string, text: string) => {
    if (!onCopy) return;
    onCopy(text).then(() => setCopied({ key, label: "Copied" }), () => setCopied({ key, label: "Copy failed. Select the text to copy it." }));
  };
  const foldRows = tree.rows > FOLD_ABOVE_ROWS;

  const row = (node: TaskNode) => {
    const key = nodeKey(node);
    const task = node.kind === "task" ? node.task : node.anchor;
    const record = taskRecord(node, clock);
    const folded = node.kind === "agent" && foldRows && node.children.length > 0 && !unfolded.has(key);
    const blocked = task?.restart === "blocked";
    return <WorkRow key={key} state={blocked ? "blocked" : STATE[nodeStatus(node)]}
      label={node.kind === "agent" ? "Agent" : node.task.label} subject={node.kind === "agent" ? node.agent.name : node.task.subject}
      detail={taskDetail(node)} warning={task?.restart === "stops" ? STOPS : undefined}
      time={task ? elapsed(task.startedAt, current) : ""} open={open.has(key)} onToggle={() => toggle(key)}
      body={<TermList terms={record.map(({ term, value }) => ({ key: term, term, value }))} empty="Not known" />}
      actions={onCopy && <TextButton label={copied?.key === key ? copied.label : "Copy record"} onPress={() => copy(key, recordText(record))} />}
      fold={folded ? { label: `${tasksLabel(countRows(node.children))} inside`, onUnfold: () => setUnfolded((keys) => new Set(keys).add(key)) } : undefined}>
      {node.children.map(row)}
    </WorkRow>;
  };
  const note = restartNote(tree);
  return <>
    {view.error !== undefined ? failed(view.error, true)
      : view.stale && <ReadoutLine>{view.reading ? "Reading tasks again." : "Waiting for the connection."} The list below may be out of date.</ReadoutLine>}
    <ListSection title="This turn" aside={groupCount(tree.thisTurn) || undefined} empty="Nothing is running for this turn.">
      {tree.thisTurn.map(row)}
    </ListSection>
    <ListSection title="In the background" aside={groupCount(tree.background) || undefined} empty="Nothing runs in the background."
      foot={note && <Consequence tone={note.tone} icon={<RotateCcwIcon />}><p>{note.text}</p></Consequence>}>
      {tree.background.map(row)}
    </ListSection>
  </>;
}
