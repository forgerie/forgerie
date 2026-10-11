import { PinnedDock } from "./PinnedDock";
import { QuestionCard } from "./QuestionCard";

export const name = "Pinned dock";
export const note = "Things that wait on the reader, pinned above the input; it scrolls inside past its share of the height";

const answer = () => Promise.resolve();
export default function One() {
  return <PinnedDock label="1 waiting for you">
    <QuestionCard asker="design asks" question="Should Export sit in the sheet header, or at the foot of the run list?" replyLabel="Answer design" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
  </PinnedDock>;
}
export function Several() {
  return <PinnedDock label="3 waiting for you">
    <QuestionCard asker="design asks" question="Should Export sit in the sheet header, or at the foot of the run list?" replyLabel="Answer design" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
    <QuestionCard asker="build asks" question="Should the CSV include the task text, which can hold line breaks?" replyLabel="Answer build" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
    <QuestionCard asker="review asks" question="Can I read the posture captures, or should I list visual claims as unverified?" replyLabel="Answer review" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
  </PinnedDock>;
}
