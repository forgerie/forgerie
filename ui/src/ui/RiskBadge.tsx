import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import "./RiskBadge.css";

export type RiskLevel = "low" | "check" | "danger";
const ICONS = { low: InfoIcon, check: CircleAlertIcon, danger: TriangleAlertIcon } as const;

/**
 * System molecule: an outside opinion of how risky an action is, which may
 * arrive after the action is shown. `low` is muted and neutral: it reads as
 * information, never as clearance. `check` takes the warn ink to draw the eye,
 * and `danger` the destructive ink. Each level has its own icon and word, so
 * none depends on colour. The reasons and the source are text.
 *
 * `block` states the word, the reasons and the source as a sentence that wraps.
 * `inline` fits the end of a one-line row: icon and word only, with the reasons
 * and the source in its hover text and its accessible text. It fades in, so a
 * late arrival never jumps.
 */
export function RiskBadge({ level, word, reasons, source, size }: {
  level: RiskLevel;
  /** The level in words, such as "High risk". */
  word: string;
  /** The signals that were raised, such as "deletes data". Lower case: they follow the word. */
  reasons: readonly string[];
  /** Who gave the opinion, such as "Opinion from fast". */
  source: string;
  size: "inline" | "block";
}) {
  const Icon = ICONS[level];
  const why = reasons.length > 0 ? `: ${reasons.join(", ")}.` : ".";
  if (size === "inline") {
    return <span className="risk-badge" data-level={level} data-size="inline" title={`${word}${why} ${source}.`}>
      <Icon className="risk-badge-icon" aria-hidden />
      <span className="risk-badge-word">{word}</span>
      <span className="risk-badge-said">{`${why} ${source}.`}</span>
    </span>;
  }
  return <p className="risk-badge" data-level={level} data-size="block">
    <Icon className="risk-badge-icon" aria-hidden />
    <span className="risk-badge-text">
      <strong className="risk-badge-word">{word}</strong>{why}{" "}
      <span className="risk-badge-source">{source}.</span>
    </span>
  </p>;
}
