import { MarkdownFragment } from "./MarkdownFragment";
import "./AwayNote.css";

/**
 * System molecule: a few sentences for a reader coming back to a session.
 * It is not a box: the decision card's start rule sets it apart from the
 * reply text. The rule and title stay quiet until something waits on the
 * reader; then they turn live and one "Needs you" line follows the summary.
 */
export function AwayNote({ title, summary, needs = "" }: { title: string; summary: string; needs?: string }) {
  if (summary === "" && needs === "") return null;
  return <section className="away-note" aria-label={title} data-needs={needs === "" ? undefined : ""}>
    <div className="away-note-title">{title}</div>
    {summary !== "" && <div className="away-note-summary"><MarkdownFragment inline text={summary} /></div>}
    {needs !== "" && <div className="away-note-needs" role="note">
      <span className="away-note-needs-label">Needs you</span>
      <span className="away-note-needs-text"><MarkdownFragment inline text={needs} /></span>
    </div>}
  </section>;
}
