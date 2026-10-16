import { CopyButton } from "./CopyButton";
import { MarkdownFragment } from "./MarkdownFragment";
import { parseRevisions, SHIP_STATES, type ShipState } from "./markdown/richBlockSyntax";
import "./RevisionList.css";

type Labels = Record<ShipState, string> & { count: (revisions: number) => string; copy: (hash: string) => string };
const LABELS: Labels = {
  local: "Local", pushed: "Pushed", landed: "Landed", deployed: "Deployed",
  count: (revisions) => `${revisions} ${revisions === 1 ? "commit" : "commits"}`,
  copy: (hash) => `Copy ${hash}`,
};

/**
 * System molecule: revisions and how far each got. Each row is a short hash
 * that copies, a subject, and a state as a word plus a four-step meter in
 * neutral ink, so reading down the column shows how far the work went.
 */
export function RevisionList({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { title, revisions } = parseRevisions(code);
  if (title === "" && revisions.length === 0) return null;
  const summary = [...SHIP_STATES].reverse().map((state) => [state, revisions.filter((revision) => revision.state === state).length] as const)
    .filter(([, count]) => count > 0).map(([state, count]) => `${count} ${labels[state].toLowerCase()}`).join(", ");
  return <div className="revision-list-room"><section className="revision-list" aria-label={title || labels.count(revisions.length)}>
    <header className="revision-list-head">
      <span className="revision-list-title">{title || labels.count(revisions.length)}</span>
      {summary !== "" && <span className="revision-list-summary">{summary}</span>}
    </header>
    {revisions.length > 0 && <ol className="revision-list-items" role="list">
      {revisions.map((revision, index) => {
        const step = SHIP_STATES.indexOf(revision.state);
        return <li key={index} className="revision-list-item" data-state={revision.state}>
          <span className="revision-list-hash"><code className="revision-list-code">{revision.hash}</code><CopyButton getText={() => revision.hash} label={labels.copy(revision.hash)} /></span>
          <div className="revision-list-subject"><MarkdownFragment inline text={revision.subject} /></div>
          <span className="revision-list-state">{labels[revision.state]}
            <span className="revision-list-meter" aria-hidden="true">{SHIP_STATES.map((state, at) => <span key={state} className="revision-list-step" data-on={at <= step || undefined} />)}</span>
          </span>
        </li>;
      })}
    </ol>}
  </section></div>;
}
