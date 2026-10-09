import { SheetDialog } from "../ui/SheetDialog";
import { StatusRow } from "../ui/StatusRow";
import { ExchangeLog, type ExchangeLine } from "../ui/ExchangeLog";
import { ReplyBox } from "../ui/ReplyBox";
import { QuestionCard } from "../ui/QuestionCard";
import { childLines, childStatus, orderChildren, type ChildSummary, type ChildTranscript } from "./childAgentsModel";

export interface ChildAgentsActions {
  onOpenChild: (conversationId: number) => void;
  onBack: () => void;
  onClose: () => void;
  onSend: (conversationId: number, text: string) => Promise<void>;
  onStop: (conversationId: number) => void;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}

function exchange(child: ChildSummary, transcript: ChildTranscript): ExchangeLine[] {
  let inputs = 0;
  return childLines(transcript).map((line): ExchangeLine => {
    if (line.kind === "said") {
      const speaker = line.who === "child" ? child.name : inputs++ === 0 ? "Task" : "Message";
      return { kind: "said", key: line.key, side: line.who === "child" ? "out" : "in", speaker, text: line.text, streaming: line.streaming };
    }
    if (line.kind === "tool") return { kind: "call", key: line.key, name: line.name, summary: line.summary };
    return { kind: "output", key: line.key, name: line.name, text: line.text, isError: line.isError };
  });
}

/**
 * Shape: a session's child agents in one sheet. The list puts questions for
 * the reader first; opening a child shows its record, its open questions, and
 * a box that steers it while it works or gives it a new task when it is idle.
 */
export function ChildAgentsPanel({ children, openId, transcript, error, actions }: {
  children: readonly ChildSummary[];
  /** The child shown, or undefined for the list. */
  openId?: number | undefined;
  transcript?: ChildTranscript | undefined;
  error?: string | undefined;
  actions: ChildAgentsActions;
}) {
  const child = openId === undefined ? undefined : children.find((candidate) => candidate.conversationId === openId);
  const alert = error === undefined ? null : <p role="alert">{error}</p>;
  if (!child) {
    const ordered = orderChildren(children);
    const working = children.filter((candidate) => candidate.busy).length;
    return <SheetDialog title="Child agents" closeLabel="Close child agents" onClose={actions.onClose}
      subtitle={children.length === 0 ? undefined : `${String(children.length)} in this session${working > 0 ? `, ${String(working)} working` : ""}`}>
      {alert}
      {ordered.length === 0 ? <p>No child agents yet. When the agent starts one, it shows here, and you can open, steer, and stop it.</p>
        : ordered.map((item) => <StatusRow key={item.conversationId} tone={item.questions.length > 0 ? "waiting" : item.busy ? "working" : "quiet"}
          name={item.name} detail={item.agent ?? undefined} status={childStatus(item)} label={`Open ${item.name}`}
          onPress={() => actions.onOpenChild(item.conversationId)}
          below={item.questions[0] === undefined ? undefined : <p>{item.questions[0].question}</p>} />)}
    </SheetDialog>;
  }
  const lines = transcript === undefined ? [] : exchange(child, transcript);
  const busy = transcript?.busy ?? child.busy;
  return <SheetDialog title={child.name} subtitle={[child.agent, childStatus(child)].filter(Boolean).join(", ")}
    closeLabel="Close child agents" onClose={actions.onClose} back={{ label: "All child agents", onPress: actions.onBack }}
    // The footer holds only the reply box, so it stays small on a short screen. Questions scroll with the record.
    footer={<ReplyBox label={`Message ${child.name}`} sendLabel={`Send to ${child.name}`}
      placeholder={busy ? `Steer ${child.name} while it works` : `Give ${child.name} another task`}
      onSend={(text) => actions.onSend(child.conversationId, text)}
      secondary={busy ? { label: "Stop", onPress: () => actions.onStop(child.conversationId) } : undefined} />}>
    {alert}
    <ExchangeLog lines={lines} follow={busy || child.questions.length > 0} empty={transcript === undefined ? "Reading the record…" : "No messages yet."} />
    {child.questions.map((question) => <QuestionCard key={question.questionId} asker={`${child.name} asks`} question={question.question}
      replyLabel={`Answer ${child.name}`} placeholder="Your answer" sendLabel="Send answer"
      onAnswer={(answer) => actions.onAnswer(question.questionId, answer)} />)}
  </SheetDialog>;
}
