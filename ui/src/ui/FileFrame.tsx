import type { ReactNode } from "react";
import "./FileFrame.css";

/**
 * Organism: one file, shown to read or to edit. What the reader must know
 * first (facts about the file, then notices such as what saving does) sits
 * above it; the file itself sits on a framed surface that grows with its
 * text, so the page scrolls as one document and nothing is boxed twice.
 */
export function FileFrame({ facts, notices, tools, children }: {
  /** Facts about the file, such as where it lives. */
  facts?: ReactNode;
  /** Notices, in the order they should be read. Empty ones are left out. */
  notices?: readonly ReactNode[];
  /** Controls for how the file shows, such as a choice of view, in a bar along the top of the frame. */
  tools?: ReactNode;
  /** The file's text, usually an editor. */
  children: ReactNode;
}) {
  const shown = (notices ?? []).filter((notice) => notice !== null && notice !== undefined && notice !== false);
  return <article className="file-frame">
    {facts}
    {shown.length ? <div className="file-frame-notices">{shown}</div> : null}
    <div className="file-frame-text">
      {tools ? <div className="file-frame-tools">{tools}</div> : null}
      {children}
    </div>
  </article>;
}
