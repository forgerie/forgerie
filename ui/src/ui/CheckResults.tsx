import { CircleCheckIcon, CircleIcon, CircleMinusIcon, CircleXIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseCheckResults, type CheckResult, type ResultState } from "./markdown/richBlockSyntax";
import "./CheckResults.css";

const ICONS: Record<ResultState, LucideIcon> = { pass: CircleCheckIcon, fail: CircleXIcon, skip: CircleMinusIcon, unchecked: CircleIcon };
type Labels = Record<ResultState, string> & { title: string; group: string };
const LABELS: Labels = { title: "Checks", group: "Not checked", pass: "Passed", fail: "Failed", skip: "Skipped", unchecked: "Not checked" };

function summarize(checks: CheckResult[]): string {
  const count = (state: ResultState) => checks.filter((check) => check.state === state).length;
  const ran = count("pass") + count("fail");
  const parts = ran > 0 ? [`${count("pass")} of ${ran} passed`] : [];
  if (count("fail") > 0) parts.push(`${count("fail")} failed`);
  if (count("skip") > 0) parts.push(`${count("skip")} skipped`);
  if (count("unchecked") > 0) parts.push(`${count("unchecked")} not checked`);
  return parts.join(", ");
}

/**
 * System molecule: what a run of checks found. Each check passed, failed or
 * was skipped, with its result at the trailing edge in tabular figures; the
 * result drops under the name when the row cannot hold both. The meter shows
 * every check that ran, in order, so a failure is visible before the reader
 * reaches it. What was not checked is its own group, outside the meter.
 */
export function CheckResults({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { title, checks } = parseCheckResults(code);
  if (title === "" && checks.length === 0) return null;
  const ran = checks.filter((check) => check.state !== "unchecked");
  const open = checks.filter((check) => check.state === "unchecked");
  const row = (check: CheckResult, index: number) => {
    const Icon = ICONS[check.state];
    return <li key={index} className="check-results-item" data-state={check.state}>
      <Icon className="check-results-icon" role="img" aria-label={labels[check.state]} />
      <div className="check-results-line">
        <span className="check-results-name"><MarkdownFragment inline text={check.name} /></span>
        {check.result !== "" && <span className="check-results-result"><MarkdownFragment inline text={check.result} /></span>}
      </div>
    </li>;
  };
  return <section className="check-results" aria-label={title || labels.title}>
    <header className="check-results-header">
      {title !== "" && <div className="check-results-title">{title}</div>}
      {checks.length > 0 && <div className="check-results-summary">{summarize(checks)}</div>}
    </header>
    {ran.length > 0 && <>
      <div className="check-results-meter" aria-hidden="true">{ran.map((check, index) => <span key={index} className="check-results-segment" data-state={check.state} />)}</div>
      <ul className="check-results-items" role="list">{ran.map(row)}</ul>
    </>}
    {open.length > 0 && <div className="check-results-group">
      <div className="check-results-group-title">{labels.group}</div>
      <ul className="check-results-items" role="list">{open.map(row)}</ul>
    </div>}
  </section>;
}
