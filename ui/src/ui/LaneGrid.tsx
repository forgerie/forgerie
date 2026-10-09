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
/**
 * Something the reader can do with a whole block, drawn as a small chip in a
 * last column so chips line up across groups. It covers all of the block's
 * rows, so it reads as the block's and not one row's.
 */
export interface LaneAction {
  /** The action and its reason in words: the accessible name and the hover text. */
  label: string;
  icon: ReactNode;
  /** A short figure beside the icon, such as a count. Chips in one grid share a width, so icons and figures line up. */
  count?: string | undefined;
  /** `live` for an offer; `warn` when it lapses soon. */
  tone?: "live" | "warn";
  onPress: () => void;
}
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
  action?: LaneAction | undefined;
}
export interface LaneGroup {
  key: string;
  /** The group's name. Drawn as text unless the group has an icon; always its accessible name and hover text. */
  name: string;
  /** Drawn instead of the name, such as a service's mark. */
  icon?: ReactNode;
  note?: string | undefined;
  blocks: readonly LaneBlock[];
}

/**
 * System molecule: named groups of measurement lanes on one set of columns,
 * so lanes start and end together and read against each other across groups.
 * Columns: group name, row label (only when some row has one), mark, value,
 * a trailing cell that may span rows, and a block action (only when some
 * block has one). A group is named by its icon when it has one. `faded`
 * takes confidence away without adding alarm; `flush` drops the list inset,
 * for a grid that does not sit under a group header.
 */
export function LaneGrid({ groups, captions = true, faded = false, flush = false }: {
  groups: readonly LaneGroup[]; captions?: boolean; faded?: boolean; flush?: boolean;
}) {
  const labelled = groups.some((group) => group.blocks.some((block) => block.rows.some((row) => row.label !== undefined)));
  const acting = groups.some((group) => group.blocks.some((block) => block.action !== undefined));
  return <div className="lane-grid-frame">
    <div className="lane-grid" data-labelled={labelled || undefined} data-acting={acting || undefined}
      data-faded={faded || undefined} data-flush={flush || undefined}>
      {groups.map((group) => <div key={group.key} className="lane-grid-group" role="group" aria-label={group.name}>
        <span className="lane-grid-name" data-icon={group.icon ? true : undefined} title={group.name} aria-hidden="true">{group.icon ?? group.name}</span>
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
              {block.action ? <button type="button" className="lane-grid-act" data-tone={block.action.tone ?? "live"}
                aria-label={block.action.label} title={block.action.label} onClick={block.action.onPress}
                style={{ "--row": first, "--row-end": first + Math.max(1, block.rows.length) }}>
                <span className="lane-grid-chip" aria-hidden="true">{block.action.icon}{block.action.count ? <span>{block.action.count}</span> : null}</span>
              </button> : null}
            </div>;
          })}
      </div>)}
    </div>
  </div>;
}
