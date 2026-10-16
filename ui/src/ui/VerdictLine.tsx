import { CircleCheckIcon, CircleXIcon, ContrastIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseVerdict, type Answer } from "./markdown/richBlockSyntax";
import "./VerdictLine.css";

const ICONS: Record<Answer, LucideIcon> = { yes: CircleCheckIcon, no: CircleXIcon, partly: ContrastIcon };
const LABELS: Record<Answer, string> = { yes: "Yes", no: "No", partly: "Partly" };

/**
 * System molecule: a one-line answer to a yes-or-no question, and its
 * reason. The answer word is the label, larger and bolder than the text,
 * with its own icon shape (check, cross, half-filled circle), so it reads at
 * a glance and without colour.
 */
export function VerdictLine({ code, labels = LABELS }: { code: string; labels?: Record<Answer, string> }) {
  const verdict = parseVerdict(code);
  if (verdict === undefined) return null;
  const Icon = ICONS[verdict.answer];
  return <div className="verdict-line" data-answer={verdict.answer} role="note">
    <span className="verdict-line-word"><Icon className="verdict-line-icon" aria-hidden="true" />{labels[verdict.answer]}</span>
    {verdict.reason !== "" && <div className="verdict-line-reason"><MarkdownFragment inline text={verdict.reason} /></div>}
  </div>;
}
