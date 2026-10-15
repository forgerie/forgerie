import "./DocumentTitle.css";

/**
 * Atom: a document's title that is not typed in place, in the same face as `TitleField`, with its standfirst under
 * it. The page header holds the page's one `h1`, so this is the document's `h2`.
 */
export function DocumentTitle({ title, standfirst }: { title: string; standfirst?: string | undefined }) {
  return <div className="document-title">
    <h2 className="document-title-text">{title}</h2>
    {standfirst ? <p className="document-title-standfirst">{standfirst}</p> : null}
  </div>;
}
