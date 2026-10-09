import { MarkdownFragment } from "./MarkdownFragment";
import { parseAsides, type Severity } from "./markdown/richBlockSyntax";
import "./AsideList.css";

type Labels = { title: string } & Record<Severity, string>;
const LABELS: Labels = { title: "Also noticed", high: "High", medium: "Medium", low: "Low" };

/**
 * System molecule: things outside the question that the reader should know,
 * each rated by how much it matters. The rating is a word in a pill, so it
 * reads without colour.
 */
export function AsideList({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const asides = parseAsides(code);
  if (asides.length === 0) return null;
  return <section className="aside-list" aria-label={labels.title}>
    <div className="aside-list-title">{labels.title}</div>
    <ul className="aside-list-items" role="list">
      {asides.map((aside, index) => <li key={index} className="aside-list-item" data-severity={aside.severity}>
        <span className="aside-list-pill">{labels[aside.severity]}</span>
        <div className="aside-list-body">
          <MarkdownFragment inline text={aside.text} />
          {aside.detail !== "" && <div className="aside-list-detail"><MarkdownFragment text={aside.detail} /></div>}
        </div>
      </li>)}
    </ul>
  </section>;
}
