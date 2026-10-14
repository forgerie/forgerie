import type { TallyTone } from "./visibleMarks";
import "./BlockRun.css";

/**
 * A block's tone. The tally's five, plus `needs`: solid live, for a unit that waits on the reader. Hollow (`faint`)
 * is also a unit that has not run yet.
 */
export type BlockTone = TallyTone | "needs";

/**
 * Atom: units of work as blocks on one line, in order, one block each, in the tally's shape and tones. A live block
 * blinks unless the reader asked for less motion. With a label it is an image with that name; without one it is
 * decoration, and the text beside it must say the same.
 */
export function BlockRun({ tones, label }: { tones: readonly BlockTone[]; label?: string | undefined }) {
  return <span className="block-run" role={label === undefined ? undefined : "img"} aria-label={label} aria-hidden={label === undefined || undefined}>
    {tones.map((tone, index) => <span key={index} className="block-run-block" data-tone={tone} />)}
  </span>;
}
