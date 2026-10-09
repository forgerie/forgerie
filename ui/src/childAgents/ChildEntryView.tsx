import { QuestionCard } from "../ui/QuestionCard";
import { EventLine } from "../ui/EventLine";
import type { ChildEntry } from "./childAgentsModel";

const firstLine = (text: string) => {
  const line = text.trim().split("\n", 1)[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/**
 * Shape: one thing a child agent did, in the parent's thread. A question is a
 * card the reader answers in place; a report, a steer, and a stop are one line.
 */
export function ChildEntryView({ entry, onAnswer, onOpen }: {
  entry: ChildEntry;
  /** Absent where the question cannot be answered, such as a read-only transcript. */
  onAnswer?: ((questionId: string, answer: string) => Promise<void>) | undefined;
  /** Opens a child by name; absent where children cannot be opened. */
  onOpen?: ((childName: string) => void) | undefined;
}) {
  switch (entry.kind) {
    case "question": return <QuestionCard asker={`${entry.childName} asks`} question={entry.question} answer={entry.answer}
      replyLabel={`Answer ${entry.childName}`} placeholder="Your answer" sendLabel="Send answer"
      onAnswer={onAnswer && ((answer) => onAnswer(entry.questionId, answer))}
      link={onOpen && { label: `Open ${entry.childName}`, onPress: () => onOpen(entry.childName) }} />;
    case "report": return <EventLine tone={entry.outcome === "failed" ? "negative" : "positive"} subject={entry.childName}
      phrase={entry.outcome === "failed" ? "failed" : "finished"} quote={firstLine(entry.text) || undefined}
      code={entry.text.includes("\n") ? entry.text : undefined} codeLabel={`Full answer from ${entry.childName}`} />;
    case "note": return <EventLine tone="neutral" hollow={entry.action === "stop"} subject={entry.childName}
      phrase={entry.action === "stop" ? "stopped by you" : "steered by you"} quote={entry.action === "stop" ? undefined : entry.text} />;
    case "answer": return <EventLine tone="neutral" subject="you" phrase="answered a child agent" quote={entry.answer} />;
  }
}
