import { PinnedDock } from "./PinnedDock";
import { QuestionCard } from "./QuestionCard";

export const name = "Pinned dock";
export const note = "Things that wait on the reader, pinned above the input; it scrolls inside past its share of the height, and its heading folds it to one line";

const answer = () => Promise.resolve();
export default function One() {
  return <PinnedDock label="1 waiting for you" names={["design's question"]}>
    <QuestionCard asker="design asks" question="Should Export sit in the sheet header, or at the foot of the run list?" replyLabel="Answer design" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
  </PinnedDock>;
}
export function Several() {
  return <PinnedDock label="3 waiting for you" names={["design's question", "build's question", "review's question"]}>
    <QuestionCard asker="design asks" question="Should Export sit in the sheet header, or at the foot of the run list?" replyLabel="Answer design" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
    <QuestionCard asker="build asks" question="Should the CSV include the task text, which can hold line breaks?" replyLabel="Answer build" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
    <QuestionCard asker="review asks" question="Can I read the posture captures, or should I list visual claims as unverified?" replyLabel="Answer review" placeholder="Your answer" sendLabel="Send answer" onAnswer={answer} />
  </PinnedDock>;
}
/** Folded by the reader: the heading line alone, naming what waits, cut at one line on a narrow screen. */
export function Folded() {
  // The fold is the reader's press, so the state presses the heading once it mounts.
  return <div ref={(node) => { const heading = node?.querySelector<HTMLButtonElement>(".pinned-dock-heading");
    if (heading?.getAttribute("aria-expanded") === "true") heading.click(); }}>
    <Several />
  </div>;
}
