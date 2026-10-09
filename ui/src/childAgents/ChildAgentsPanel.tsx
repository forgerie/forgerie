import { SheetDialog } from "../ui/SheetDialog";
import { StatusRow } from "../ui/StatusRow";
import { ExchangeLog, type ExchangeLine } from "../ui/ExchangeLog";
import { ReplyBox } from "../ui/ReplyBox";
import { QuestionCard } from "../ui/QuestionCard";
import { NoticeBar } from "../ui/NoticeBar";
import { QUESTION_TOOL, childLines, childStatus, orderChildren, type ChildSummary, type ChildTranscript } from "./childAgentsModel";

export interface ChildAgentsActions {
  onOpenChild: (conversationId: number) => void;
  onBack: () => void;
  onClose: () => void;
  onSend: (conversationId: number, text: string) => Promise<void>;
  onStop: (conversationId: number) => void;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onDismissError?: (() => void) | undefined;
}

const ANSWERED = /^The user answered: ([\s\S]*)$/u;

/**
 * The record as lines. A question the child asked is a card where it asked,
 * answered or open, instead of a tool call and its result.
 */
function exchange(child: ChildSummary, transcript: ChildTranscript): ExchangeLine[] {
  let inputs = 0;
  const lines = childLines(transcript);
  const out: ExchangeLine[] = [];
  lines.forEach((line, index) => {
    if (line.kind === "said" && line.who === "message") { out.push({ kind: "in", key: line.key, label: inputs++ === 0 ? "Task" : "Message", text: line.text }); return; }
    if (line.kind === "said") { out.push({ kind: "out", key: line.key, text: line.text, streaming: line.streaming }); return; }
    if (line.kind === "tool" && line.name === QUESTION_TOOL) {
      const next = lines[index + 1];
      const answer = next?.kind === "result" && next.name === QUESTION_TOOL ? ANSWERED.exec(next.text)?.[1] : undefined;
      out.push({ kind: "block", key: line.key, content: <QuestionCard asker={`${child.name} asks`} question={line.summary}
        answer={answer} /> });
      return;
    }
    if (line.kind === "result" && line.name === QUESTION_TOOL) return;
    if (line.kind === "tool") { out.push({ kind: "call", key: line.key, name: line.name, summary: line.summary }); return; }
    out.push({ kind: "output", key: line.key, name: line.name, text: line.text, isError: line.isError });
  });
  return out;
}

/**
 * Shape: a session's child agents in one sheet. The list puts questions for
 * the reader first. An open child shows its record, with each question as a
 * card where it was asked, and one input: the answer to its oldest open
 * question while it has one, otherwise a message that steers it while it
 * works or gives it a new task when it is idle. Stop sits in the header while
 * it works.
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
  const alert = error === undefined ? null : <NoticeBar tone="alert" message={error}
    actions={actions.onDismissError ? [{ label: "Dismiss", onPress: actions.onDismissError }] : []} />;
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
  const busy = transcript?.busy ?? child.busy;
  const question = child.questions[0];
  // One input. While the child waits on the reader, it answers the oldest open question, which the record shows as a card.
  const footer = question !== undefined
    ? <ReplyBox key={question.questionId} label={`Answer ${child.name}: ${question.question}`} sendLabel="Send answer" autoFocus
      placeholder={child.questions.length > 1 ? `Answer ${child.name}'s first question (1 of ${String(child.questions.length)})` : `Answer ${child.name}`}
      onSend={(answer) => actions.onAnswer(question.questionId, answer)} />
    : <ReplyBox key="message" label={`Message ${child.name}`} sendLabel={`Send to ${child.name}`}
      placeholder={busy ? `Steer ${child.name} while it works` : `Give ${child.name} another task`}
      onSend={(text) => actions.onSend(child.conversationId, text)} />;
  return <SheetDialog title={child.name} subtitle={[child.agent, childStatus(child)].filter(Boolean).join(", ")}
    closeLabel="Close child agents" onClose={actions.onClose} back={{ label: "All child agents", onPress: actions.onBack }}
    actions={busy ? [{ label: "Stop", onPress: () => actions.onStop(child.conversationId) }] : []} footer={footer}>
    {alert}
    <ExchangeLog lines={transcript === undefined ? [] : exchange(child, transcript)} follow={busy || question !== undefined}
      empty={transcript === undefined ? "Reading the record…" : "No messages yet."} />
  </SheetDialog>;
}
