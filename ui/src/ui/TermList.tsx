import "./TermList.css";

/** Atom: a few named values as two aligned columns, each value cut to two lines. An empty value says so. */
export function TermList({ terms, empty }: { terms: readonly { key: string; term: string; value: string }[]; empty: string }) {
  return <dl className="term-list">
    {terms.map(({ key, term, value }) => <div key={key} className="term-list-row">
      <dt className="term-list-term">{term}</dt>
      <dd className="term-list-value" data-empty={value === "" || undefined} title={value === "" ? undefined : value}>{value === "" ? empty : value}</dd>
    </div>)}
  </dl>;
}
