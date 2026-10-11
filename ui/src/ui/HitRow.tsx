import { markRuns } from "./markRanges";
import "./HitRow.css";

/**
 * Molecule: one item a search found, as one press target. Its name and age
 * on the first line; where it lives, its quiet labels and a count of what
 * else matched under them; then the passage that matched, with the matched
 * words marked. The passage keeps as many lines as the room allows.
 */
export function HitRow({ title, untitled = false, where, time, timeTitle, tags = [], speaker, passage, marks, footnote, onPress }: {
  title: string;
  /** The title is a stand-in for a missing name, so it reads quieter. */
  untitled?: boolean;
  where: string;
  /** Short age, such as "2d". */
  time: string;
  /** The full date, on hover. */
  timeTitle?: string | undefined;
  /** Labels that change what pressing means, such as "Archived". */
  tags?: readonly string[];
  /** Who wrote the passage, drawn before it, such as "You". */
  speaker?: string | undefined;
  passage: string;
  /** `[start, end)` offsets of the matched words in `passage`. */
  marks: readonly (readonly [number, number])[];
  footnote?: string | undefined;
  onPress: () => void;
}) {
  return <button type="button" className="hit-row" onClick={onPress}>
    <span className="hit-row-title" data-untitled={untitled || undefined}>{title}</span>
    <span className="hit-row-time" title={timeTitle}>{time}</span>
    {/* The count of other matches ends the meta line, under the age, so it costs no line of its own. */}
    <span className="hit-row-meta">
      <span className="hit-row-where" title={where}>{where}</span>
      {tags.map((tag) => <span key={tag} className="hit-row-tag">{tag}</span>)}
      {footnote ? <span className="hit-row-footnote">{footnote}</span> : null}
    </span>
    <span className="hit-row-passage" dir="auto">
      {speaker ? <span className="hit-row-speaker">{speaker}: </span> : null}
      {markRuns(passage, marks).map((run, index) => run.marked ? <mark key={index} className="hit-row-mark">{run.text}</mark> : run.text)}
    </span>
  </button>;
}
