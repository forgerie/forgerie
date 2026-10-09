import { Fragment, type ReactNode } from "react";
import "./LaneGrid.css";

export interface LaneRow {
  key: string;
  /** A short name, drawn only where a block has rows to tell apart. */
  label?: string | undefined;
  /** The measurement: a bar, a dot, or a figure. */
  mark: ReactNode;
  /** The whole row in words, for hover and for a screen reader. */
  words: string;
  /** A figure after the mark, such as the share left. Hidden when the grid is narrow; the words keep it. */
  value?: ReactNode;
}
/** A trailing cell that covers rows `start` to `end` (exclusive) of its block, such as one clock for rows that agree. */
export interface LaneSpan { start: number; end: number; content: ReactNode }
export interface LaneBlock {
  key: string;
  /** A line above the rows, such as an address. Drawn only when the grid has room for captions. */
  caption?: string | undefined;
  /** The block's accessible name. */
  label: string;
  /** Marked with a riser in the gutter, such as the one the work goes to. Not a problem, so no colour. */
  marked?: boolean;
  /** Out of service: the caption is struck through. */
  struck?: boolean;
  /** Said instead of rows when there are none. */
  note?: string | undefined;
  rows: readonly LaneRow[];
  spans: readonly LaneSpan[];
}
export interface LaneGroup { key: string; name: string; note?: string | undefined; blocks: readonly LaneBlock[] }

/**
 * System molecule: named groups of measurement lanes on one set of columns,
 * so lanes start and end together and read against each other across groups.
 * Columns: group name, row label (only when some row has one), mark, value,
 * and a trailing cell that may span rows. `dense` sets groups at line
 * spacing; `faded` takes confidence away without adding alarm.
 */
export function LaneGrid({ groups, captions = true, dense = false, faded = false }: {
  groups: readonly LaneGroup[]; captions?: boolean; dense?: boolean; faded?: boolean;
}) {
  const labelled = groups.some((group) => group.blocks.some((block) => block.rows.some((row) => row.label !== undefined)));
  return <div className="lane-grid-frame">
    <div className="lane-grid" data-labelled={labelled || undefined} data-dense={dense || undefined} data-faded={faded || undefined}>
      {groups.map((group) => <div key={group.key} className="lane-grid-group" role="group" aria-label={group.name}>
        <span className="lane-grid-name" aria-hidden="true">{group.name}</span>
        {group.blocks.length === 0 ? <span className="lane-grid-note" style={{ "--row": 1 }}>{group.note}</span>
          : group.blocks.map((block) => {
            const captioned = captions && block.caption !== undefined && block.caption !== "";
            const first = captioned ? 2 : 1;
            return <div key={block.key} className="lane-grid-block" role="group" aria-label={block.label} title={block.caption}
              data-captioned={captioned || undefined} data-marked={block.marked || undefined} data-struck={block.struck || undefined}
              style={{ "--rows": Math.max(1, block.rows.length) }}>
              {captioned ? <span className="lane-grid-caption" aria-hidden="true">{block.caption}</span> : null}
              {block.note !== undefined && block.rows.length === 0 ? <span className="lane-grid-note" style={{ "--row": first }}>{block.note}</span> : null}
              {block.rows.map((row, index) => <Fragment key={row.key}>
                {row.label === undefined ? null : <span className="lane-grid-label" style={{ "--row": first + index }} aria-hidden="true">{row.label}</span>}
                <span className="lane-grid-mark" style={{ "--row": first + index }} role="img" aria-label={row.words} title={row.words}>{row.mark}</span>
                {row.value === undefined ? null : <span className="lane-grid-value" style={{ "--row": first + index }} aria-hidden="true">{row.value}</span>}
              </Fragment>)}
              {block.spans.map((span) => <span key={span.start} className="lane-grid-trail" aria-hidden="true"
                style={{ "--row": first + span.start, "--row-end": first + span.end }}>{span.content}</span>)}
            </div>;
          })}
      </div>)}
    </div>
  </div>;
}
