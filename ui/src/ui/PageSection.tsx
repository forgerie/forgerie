import { useId, useRef, type ReactNode } from "react";
import { useDescribedControls } from "./useDescribedControls";
import "./PageSection.css";

/**
 * Molecule: a titled part of a document page: a small quiet heading, then its content at the column's full width.
 * A problem with the section's content shows under it in the danger tone and describes the controls inside, and
 * `fieldId` names the section, so a page can move focus to it.
 */
export function PageSection({ title, problem, fieldId, children }: { title: string; problem?: string | undefined; fieldId?: string | undefined; children: ReactNode }) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const problemId = problem ? `${id}-problem` : undefined;
  useDescribedControls(body, [problemId], problem !== undefined);
  return <section className="page-section" id={fieldId} data-problem={problem ? "" : undefined} aria-labelledby={id}>
    <h2 className="page-section-title" id={id}>{title}</h2>
    <div ref={body}>{children}</div>
    {problem ? <p className="page-section-problem" id={problemId}>{problem}</p> : null}
  </section>;
}
