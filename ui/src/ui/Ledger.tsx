import { parseLedger } from "./markdown/richBlockSyntax";
import "./Ledger.css";

const MINUS = "\u2212";
type Labels = { title: string; missing: string; range: string };
const LABELS: Labels = { title: "Amounts", missing: "No amount", range: "to" };

/** One amount, or a range written `a to b`. A negative is a minus sign and the failure ink, never colour alone. */
function amount(text: string, labels: Labels) {
  if (text === "?") return <span className="ledger-missing">{labels.missing}</span>;
  return text.split(/[ \t]+to[ \t]+/).map((part, index) => {
    const negative = /^[-−]/.test(part);
    return <span key={index}>
      {index > 0 && <span className="ledger-range"> {labels.range} </span>}
      <span className="ledger-figure" data-negative={negative || undefined}>{negative ? MINUS + part.slice(1) : part}</span>
    </span>;
  });
}

/**
 * System molecule: amounts of money, as on paper. Amounts sit in one
 * right-aligned column of tabular figures. A total takes a rule above and
 * the weight; the last total takes a double rule below. A missing amount says
 * so; a row whose amount has not arrived yet stays empty.
 */
export function Ledger({ code, labels = LABELS }: { code: string; labels?: Labels }) {
  const { title, rows } = parseLedger(code);
  if (title === "" && rows.length === 0) return null;
  return <section className="ledger" aria-label={title || labels.title}>
    {title !== "" && <div className="ledger-title">{title}</div>}
    {rows.length > 0 && <dl className="ledger-rows">
      {rows.map((row, index) => <div key={index} className="ledger-row" data-total={row.total || undefined}
        data-last={(row.total && index === rows.length - 1) || undefined}>
        <dt className="ledger-label">{row.label}</dt>
        <dd className="ledger-amount">{amount(row.amount, labels)}</dd>
      </div>)}
    </dl>}
  </section>;
}
