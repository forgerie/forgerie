import { QuestionCard } from "./QuestionCard";

export const name = "Question card";
export const note = "A question that waits on the reader, then shows its answer";

export default function Open() {
  return <QuestionCard asker="ui asks" question="Should the empty state show the last run, or stay blank?" replyLabel="Answer ui"
    placeholder="Your answer" sendLabel="Send answer" onAnswer={() => Promise.resolve()} link={{ label: "Open ui", onPress: () => {} }} />;
}
export function Cancelled() {
  return <QuestionCard asker="ui asks" question="Should I continue?" closedReason="Stopped without an answer." />;
}
export function Answered() {
  return <QuestionCard asker="ui asks" question="Should the empty state show the last run, or stay blank?" answer="Show the last run."
    replyLabel="Answer ui" placeholder="Your answer" sendLabel="Send answer" link={{ label: "Open ui", onPress: () => {} }} />;
}
