import { CircleCheckIcon, OctagonXIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { MarkdownFragment } from "./MarkdownFragment";
import { findingPath, parseFindings, type ReviewVerdict } from "./markdown/richBlockSyntax";
import { useExistingPaths, type FileLinks } from "./useExistingPaths";
import "./FindingList.css";

const VERDICT_ICONS: Record<ReviewVerdict, LucideIcon> = { approve: CircleCheckIcon, changes: TriangleAlertIcon, blocked: OctagonXIcon };
type Labels = Record<ReviewVerdict, string> & { title: string; fix: string; none: string };
const LABELS: Labels = { title: "Review", approve: "Approve", changes: "Changes needed", blocked: "Blocked", fix: "Fix", none: "No defects found." };

/** `src/app.ts:12` with the folders quieter than the file, so the file reads first. */
function location(where: string) {
  const slash = where.lastIndexOf("/");
  return <>{slash >= 0 && <span className="finding-list-dir">{where.slice(0, slash + 1)}</span>}<span>{where.slice(slash + 1)}</span></>;
}

/**
 * System molecule: a review's defects. The verdict leads, in words with its
 * own icon, on a strip whose top rule takes its tone. Defects come worst
 * first, each with a worded severity pill, its location, the problem and the
 * smallest fix. With `links`, a location opens its file once `existing` says
 * the file is there.
 */
export function FindingList({ code, links, labels = LABELS }: { code: string; links?: FileLinks | undefined; labels?: Labels }) {
  const { verdict, findings } = parseFindings(code);
  // The hook keys on the joined paths, so a new array each render is not a new lookup.
  const found = useExistingPaths([...new Set(findings.map((finding) => findingPath(finding.where)))], links);
  if (verdict === undefined && findings.length === 0) return null;
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  const summary = [...counts].map(([severity, count]) => `${count} ${severity}`).join(", ");
  const Icon = verdict ? VERDICT_ICONS[verdict] : undefined;
  return <section className="finding-list" data-verdict={verdict} aria-label={verdict ? labels[verdict] : labels.title}>
    <header className="finding-list-head">
      <span className="finding-list-verdict">{Icon && <Icon className="finding-list-verdict-icon" aria-hidden="true" />}{verdict ? labels[verdict] : labels.title}</span>
      {summary !== "" && <span className="finding-list-summary">{summary}</span>}
    </header>
    {findings.length === 0 ? <p className="finding-list-empty">{labels.none}</p> : <ol className="finding-list-items" role="list">
      {findings.map((finding, index) => {
        const path = findingPath(finding.where);
        return <li key={index} className="finding-list-item" data-rank={finding.rank}>
          <span className="finding-list-pill">{finding.severity}</span>
          <div className="finding-list-body">
            {links && found.has(path)
              ? <button type="button" className="finding-list-where finding-list-open" title={path} onClick={() => links.open(path)}>{location(finding.where)}</button>
              : <span className="finding-list-where">{location(finding.where)}</span>}
            {finding.problem !== "" && <div className="finding-list-problem"><MarkdownFragment inline text={finding.problem} /></div>}
            {finding.fix !== "" && <div className="finding-list-fix"><span className="finding-list-fix-label">{labels.fix}</span><MarkdownFragment inline text={finding.fix} /></div>}
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}
