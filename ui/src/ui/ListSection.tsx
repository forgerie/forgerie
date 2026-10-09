import { Children, useId, type ReactNode } from "react";
import "./ListSection.css";

/**
 * Molecule: a titled list on a settings-style page. Rows come in as `<li>`
 * children. With no rows it says what goes here and how to add one. A note
 * under the list says where the items live.
 */
export function ListSection({ title, empty, note, children }: { title: string; empty: ReactNode; note?: ReactNode; children?: ReactNode }) {
  const id = useId();
  const rows = Children.toArray(children);
  return <section className="list-section" aria-labelledby={id}>
    <h2 className="list-section-title" id={id}>{title}</h2>
    {rows.length ? <ul className="list-section-rows">{rows}</ul> : <p className="list-section-empty">{empty}</p>}
    {note ? <p className="list-section-note">{note}</p> : null}
  </section>;
}
