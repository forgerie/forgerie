import { useId, type ReactNode } from "react";
import "./PageSection.css";

/** Molecule: a titled part of a document page: a small quiet heading, then its content at the column's full width. */
export function PageSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="page-section" aria-labelledby={id}>
    <h2 className="page-section-title" id={id}>{title}</h2>
    {children}
  </section>;
}
