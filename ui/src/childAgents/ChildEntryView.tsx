import { QuestionCard } from "../ui/QuestionCard";
import { EventLine } from "../ui/EventLine";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import type { ChildEntry } from "./childAgentsModel";

/** The first sentence-sized piece of a reply, without Markdown marks, for a one-line quote. */
function firstLine(text: string): string {
  const line = text.trim().split("\n").find((candidate) => candidate.trim() !== "")?.replace(/[*_`#>]/g, "").trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Shape: one thing a child agent did, in the parent's thread. A question is a
 * card the reader answers in place; a report, a steer, and a stop are one
 * line. A report's first line shows; the whole answer opens under it.
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
      closedReason={entry.cancelled ? "Stopped without an answer." : undefined}
      replyLabel={`Answer ${entry.childName}`} placeholder="Your answer" sendLabel="Send answer"
      onAnswer={onAnswer && ((answer) => onAnswer(entry.questionId, answer))}
      link={onOpen && { label: `Open ${entry.childName}`, onPress: () => onOpen(entry.childName) }} />;
    case "report": {
      const first = firstLine(entry.text);
      const more = entry.text.trim() !== first;
      return <EventLine tone={entry.outcome === "failed" ? "negative" : "positive"} subject={entry.childName}
        phrase={entry.outcome === "failed" ? "failed" : "finished"} quoteFace="text" quote={first === "" ? undefined : first}
        detail={more ? <MarkdownFragment text={entry.text} /> : undefined} />;
    }
    case "note": return <EventLine tone="neutral" hollow={entry.action === "stop"} subject={entry.childName}
      phrase={entry.action === "stop" ? "stopped by you" : "steered by you"} quoteFace="text" quote={entry.action === "stop" ? undefined : entry.text} />;
    case "answer": return <EventLine tone="neutral" subject="you" phrase="answered a child agent" quoteFace="text" quote={entry.answer} />;
  }
}
