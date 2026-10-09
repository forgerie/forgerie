import { MarkdownFragment } from "./MarkdownFragment";
import { parseFacts } from "./markdown/richBlockSyntax";
import "./FactList.css";

/**
 * System molecule: a few headline values, read from `Label: value` lines.
 * Cells take an equal share of the row while each keeps a readable minimum,
 * then wrap; the container alone decides how many share a row.
 */
export function FactList({ code }: { code: string }) {
  const facts = parseFacts(code);
  if (facts.length === 0) return null;
  return <dl className="fact-list">
    {facts.map((fact, index) => <div key={index} className="fact-list-cell">
      <dt className="fact-list-label">{fact.label}</dt>
      <dd className="fact-list-value"><MarkdownFragment inline text={fact.value} /></dd>
    </div>)}
  </dl>;
}
