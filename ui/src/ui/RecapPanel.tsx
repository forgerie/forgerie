import { CheckIcon, CircleIcon, HandIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseRecap } from "./markdown/richBlockSyntax";
import "./RecapPanel.css";

type Labels = { title: string; needs: string; goal: string; done: string; left: string; next: string; nothingNeeded: string };
const LABELS: Labels = { title: "Where we are", needs: "Needs you", goal: "Goal", done: "Done", left: "Left", next: "Next", nothingNeeded: "nothing needs you" };

/**
 * System molecule: where a piece of work stands, for a reader coming back to
 * it. What waits on the reader comes first, on the live wash and rail,
 * whichever line the writer put it on. With nothing waiting, that row is
 * gone and the header says so in muted text.
 */
export function RecapPanel({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { goal, done, left, needs, next } = parseRecap(code);
  if (goal === "" && done.length === 0 && left.length === 0 && needs === "" && next === "") return null;
  const summary = [done.length > 0 ? `${done.length} ${labels.done.toLowerCase()}` : "", left.length > 0 ? `${left.length} ${labels.left.toLowerCase()}` : "",
    needs === "" ? labels.nothingNeeded : ""].filter((part) => part !== "").join(", ");
  return <section className="recap-panel" aria-label={labels.title}>
    <header className="recap-panel-head"><div className="recap-panel-title">{labels.title}</div><div className="recap-panel-summary">{summary}</div></header>
    {needs !== "" && <div className="recap-panel-needs" role="note">
      <span className="recap-panel-needs-label"><HandIcon className="recap-panel-needs-icon" aria-hidden="true" />{labels.needs}</span>
      <div className="recap-panel-needs-text"><MarkdownFragment inline text={needs} /></div>
    </div>}
    <dl className="recap-panel-fields">
      {goal !== "" && <div className="recap-panel-field" data-field="goal">
        <dt className="recap-panel-label">{labels.goal}</dt><dd className="recap-panel-value"><MarkdownFragment inline text={goal} /></dd>
      </div>}
      {done.length > 0 && <div className="recap-panel-field" data-field="done">
        <dt className="recap-panel-label">{labels.done}</dt>
        <dd className="recap-panel-value"><ul className="recap-panel-list" role="list">
          {done.map((item, index) => <li key={index} className="recap-panel-entry"><CheckIcon className="recap-panel-mark" aria-hidden="true" /><MarkdownFragment inline text={item} /></li>)}
        </ul></dd>
      </div>}
      {left.length > 0 && <div className="recap-panel-field" data-field="left">
        <dt className="recap-panel-label">{labels.left}</dt>
        <dd className="recap-panel-value"><ul className="recap-panel-list" role="list">
          {left.map((item, index) => <li key={index} className="recap-panel-entry"><CircleIcon className="recap-panel-mark" aria-hidden="true" /><MarkdownFragment inline text={item} /></li>)}
        </ul></dd>
      </div>}
      {next !== "" && <div className="recap-panel-field" data-field="next">
        <dt className="recap-panel-label">{labels.next}</dt><dd className="recap-panel-value"><MarkdownFragment inline text={next} /></dd>
      </div>}
    </dl>
  </section>;
}
