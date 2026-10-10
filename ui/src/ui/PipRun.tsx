import "./PipRun.css";

/** Past this many pips the run fades at its end: more than a lane is sure to hold, and no maximum to claim. */
const RUN = 24;

/**
 * System atom: a count with no maximum, drawn as one pip per whole unit from
 * the start of its lane, so less is shorter the way an emptier meter is. Part
 * of a unit still draws a sliver: nearly nothing and nothing are different
 * news. Nothing draws nothing. Past what a lane holds, the run fades out
 * rather than end, because a count with no maximum has no full. `warn` tones
 * a count that is running low. Without a label it is decoration and hidden
 * from assistive technology; its owner says the count in words.
 */
export function PipRun({ count, tone = "plain", label }: { count: number; tone?: "plain" | "warn"; label?: string | undefined }) {
  if (!(count > 0)) return null;
  const whole = Math.floor(count);
  const drawn = whole === 0 ? 0.5 : Math.min(whole, RUN + 4);
  return <i className="pip-run" data-tone={tone === "warn" ? tone : undefined} data-many={whole > RUN || undefined}
    data-part={whole === 0 || undefined} style={{ "--pips": drawn }}
    role={label ? "img" : undefined} aria-label={label} title={label} aria-hidden={label ? undefined : true} />;
}
