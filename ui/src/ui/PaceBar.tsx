import "./PaceBar.css";

/**
 * Where a budget stands against spending it evenly:
 * `even` within the margin, `short` runs out before the period ends,
 * `surplus` will be left unspent, `empty` has nothing left.
 */
export type PaceState = "even" | "short" | "surplus" | "empty";

/**
 * System atom: a budget meter. The fill is the share left. With a pace, the
 * bar breaks at the even-spend point, so every edge facing the gap is the
 * same round cap the bar ends with. A shortfall to pace is hatched in the
 * warn tone. A surplus past pace is drawn solid, warn turning to danger as
 * `heat` (0 to 1) rises. Without a label the bar is decoration and hidden
 * from assistive technology; its owner says the same thing in words.
 */
export function PaceBar({ value, pace, state = "even", heat = 0, label }: {
  /** Share left, 0 to 100. */
  value: number;
  /** Share an even spend would leave now, 0 to 100. Absent when the period has no known length. */
  pace?: number | undefined;
  state?: PaceState;
  heat?: number;
  label?: string | undefined;
}) {
  const named = label !== undefined;
  return <span className="pace-bar" data-paced={pace !== undefined || undefined} data-state={state}
    style={{ "--fill": `${String(value)}%`, "--pace": pace === undefined ? undefined : `${String(pace)}%`, "--heat": heat }}
    role={named ? "img" : undefined} aria-label={label} title={label} aria-hidden={named ? undefined : true}>
    {pace === undefined ? <>
      <i className="pace-bar-ground" /><i className="pace-bar-fill" />
    </> : <>
      <i className="pace-bar-ground" data-side="before" /><i className="pace-bar-ground" data-side="after" />
      <i className="pace-bar-fill" data-side="before" />
      {value > pace ? <i className="pace-bar-fill" data-side="after" /> : null}
      {state === "short" ? <i className="pace-bar-hatch" /> : null}
      {state === "surplus" ? <i className="pace-bar-surplus" /> : null}
    </>}
  </span>;
}
