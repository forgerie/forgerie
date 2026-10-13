import { Children, useId, type ReactNode } from "react";
import "./ListSection.css";

/**
 * Molecule: a titled list on a settings-style page. Rows come in as `<li>`
 * children. With no rows it says what goes here and how to add one. A note
 * under the list says where the items live.
 */
export function ListSection({ title, aside, empty, note, foot, children }: {
  title: string;
  /** A readout beside the title, such as a count or a summary mark. */
  aside?: ReactNode;
  empty: ReactNode; note?: ReactNode;
  /** A control under the rows, such as one that shows more of them. */
  foot?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  const rows = Children.toArray(children);
  return <section className="list-section" aria-labelledby={id}>
    {aside ? <div className="list-section-head"><h2 className="list-section-title" id={id}>{title}</h2><span className="list-section-aside">{aside}</span></div>
      : <h2 className="list-section-title" id={id}>{title}</h2>}
    {rows.length ? <ul className="list-section-rows">{rows}</ul> : <p className="list-section-empty">{empty}</p>}
    {foot ? <div className="list-section-foot">{foot}</div> : null}
    {note ? <p className="list-section-note">{note}</p> : null}
  </section>;
}
