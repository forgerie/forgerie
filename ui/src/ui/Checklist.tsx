import { CircleCheckIcon, CircleDashedIcon, CircleIcon, CircleMinusIcon, CircleXIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseCheckList, type CheckState } from "./markdown/richBlockSyntax";
import "./Checklist.css";

const ICONS: Record<CheckState, LucideIcon> = {
  done: CircleCheckIcon, active: CircleDashedIcon, todo: CircleIcon, failed: CircleXIcon, skipped: CircleMinusIcon,
};
const STATE_LABELS: Record<CheckState, string> = {
  done: "Done", active: "In progress", todo: "Not started", failed: "Failed", skipped: "Skipped",
};

function summarize(states: CheckState[]): string {
  const count = (state: CheckState) => states.filter((candidate) => candidate === state).length;
  const parts = [`${count("done")} of ${states.length - count("skipped")} done`];
  if (count("failed") > 0) parts.push(`${count("failed")} failed`);
  if (count("active") > 0) parts.push(`${count("active")} in progress`);
  return parts.join(", ");
}

/**
 * System molecule: a snapshot of progress on a list of tasks, read from
 * `[x]`, `[~]`, `[ ]`, `[!]` and `[-]` lines. The meter shows every item in
 * order, so a failure is visible before the reader reaches it. "In progress"
 * is a still mark: the reply is a snapshot and must not look live later.
 */
export function Checklist({ code, stateLabels = STATE_LABELS }: { code: string; stateLabels?: Record<CheckState, string> }) {
  const { title, items } = parseCheckList(code);
  if (title === "" && items.length === 0) return null;
  return <section className="checklist" aria-label={title || undefined}>
    <header className="checklist-header">
      {title !== "" && <div className="checklist-title">{title}</div>}
      {items.length > 0 && <div className="checklist-summary">{summarize(items.map((item) => item.state))}</div>}
    </header>
    {items.length > 0 && <div className="checklist-meter" aria-hidden="true">
      {items.map((item, index) => <span key={index} className="checklist-segment" data-state={item.state} />)}
    </div>}
    <ul className="checklist-items" role="list">
      {items.map((item, index) => {
        const Icon = ICONS[item.state];
        return <li key={index} className="checklist-item" data-state={item.state}>
          <Icon className="checklist-icon" role="img" aria-label={stateLabels[item.state]} />
          <div className="checklist-text"><MarkdownFragment inline text={item.text} /></div>
          {item.detail !== "" && <div className="checklist-detail"><MarkdownFragment text={item.detail} /></div>}
        </li>;
      })}
    </ul>
  </section>;
}
