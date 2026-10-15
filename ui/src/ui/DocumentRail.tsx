import type { ReactNode } from "react";
import "./DocumentRail.css";

/**
 * System template: a document with a side panel, laid out by its own width.
 * - 46rem wide or more: the head and the document in a reading column, the panel beside them on a hairline.
 * - Narrower: one column. The head first, then the panel between two rules, then the document, so what the
 *   document's settings are is read before the long text.
 * The page around it scrolls; nothing here scrolls on its own, so no part of either column is cut off.
 * Notices close the head, so at every width they are read before the panel and the document.
 */
export function DocumentRail({ head, notices, rail, railLabel, children }: {
  /** The title and what the reader must see first, such as status. */
  head: ReactNode;
  /** What is wrong or pending, in reading order, under the head. Empty ones are left out. */
  notices?: readonly ReactNode[] | undefined;
  rail: ReactNode;
  /** The panel's accessible name. */
  railLabel: string;
  /** The document. */
  children: ReactNode;
}) {
  const shown = (notices ?? []).filter((notice) => notice !== null && notice !== undefined && notice !== false);
  return <div className="document-rail">
    <div className="document-rail-grid">
      <div className="document-rail-head">
        {head}
        {shown.length ? <div className="document-rail-notices">{shown}</div> : null}
      </div>
      <aside className="document-rail-panel" aria-label={railLabel}>{rail}</aside>
      <div className="document-rail-main">{children}</div>
    </div>
  </div>;
}
