import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { deltaChange, parseDelta, type DeltaMeaning, type Direction } from "./markdown/richBlockSyntax";
import "./DeltaTable.css";

const MINUS = "\u2212";
type Labels = Record<DeltaMeaning, string> & Record<Exclude<Direction, "">, string> & {
  before: string; after: string; change: string; fromZero: string; crossesZero: string; title: string;
};
const LABELS: Labels = {
  better: "Better", worse: "Worse", same: "Same", none: "Changed", lower: "lower is better", higher: "higher is better",
  before: "Before", after: "After", change: "Change", fromZero: "from 0", crossesZero: "crosses 0", title: "Before and after",
};

const shown = (text: string) => text.replace(/^-/, MINUS);
const signed = (value: number, places: number) =>
  `${value > 0 ? "+" : value < 0 ? MINUS : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;

/**
 * System molecule: numbers before and after a change. Each row says Better
 * or Worse in words, with an arrow for which way the number moved and the
 * tone for whether that is good; which way is good is written under the
 * label. A regression's label goes heavier. When the column is narrow, the
 * label takes its own line and the numbers share the next.
 */
export function DeltaTable({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { title, rows } = parseDelta(code);
  if (title === "" && rows.length === 0) return null;
  return <figure className="delta-table" aria-label={title || labels.title}>
    {title !== "" && <figcaption className="delta-table-title">{title}</figcaption>}
    {rows.length > 0 && <ul className="delta-table-rows" role="list">
      <li className="delta-table-row delta-table-head" aria-hidden="true">
        <span /><span className="delta-table-num">{labels.before}</span><span className="delta-table-num">{labels.after}</span><span className="delta-table-num">{labels.change}</span><span />
      </li>
      {rows.map((row, index) => {
        const change = deltaChange(row);
        const Trend = !change.complete || change.change === 0 ? MinusIcon : change.change > 0 ? TrendingUpIcon : TrendingDownIcon;
        const percent = !change.complete ? "" : change.percent === "from zero" ? labels.fromZero : change.percent === "crosses zero" ? labels.crossesZero
          : `${signed(change.percent, 1)}%`;
        return <li key={index} className="delta-table-row" data-meaning={change.complete ? change.meaning : undefined}>
          <span className="delta-table-label">{row.label}{row.direction !== "" && <small className="delta-table-direction">{labels[row.direction]}</small>}</span>
          <span className="delta-table-num delta-table-before">{shown(row.before)}</span>
          <span className="delta-table-num delta-table-after">{shown(row.after)}</span>
          <span className="delta-table-change">{change.complete && <><span className="delta-table-abs">{signed(change.change, change.places)}</span><span className="delta-table-pct">{percent}</span></>}</span>
          <span className="delta-table-word">{change.complete && <><Trend className="delta-table-trend" aria-hidden="true" />{labels[change.meaning]}</>}</span>
        </li>;
      })}
    </ul>}
  </figure>;
}
