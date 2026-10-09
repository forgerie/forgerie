import type { ReactNode } from "react";
import "./QuoteFigure.css";

/**
 * System molecule: a quotation with its source under it. The source is plain
 * text in the code face, because it is usually a path, a command or a URL
 * the reader may want to find.
 */
export function QuoteFigure({ source, children }: { source: string; children: ReactNode }) {
  return <figure className="quote-figure">
    <blockquote className="quote-figure-text">{children}</blockquote>
    <figcaption className="quote-figure-source">{source}</figcaption>
  </figure>;
}
