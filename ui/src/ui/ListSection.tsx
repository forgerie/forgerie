import { Children, useId, type ReactNode } from "react";
import "./ListSection.css";

/**
 * Molecule: a titled list on a settings-style page. Rows come in as `<li>`
 * children. With no rows it says what goes here and how to add one. A note
 * under the list says where the items live. In a document page (`placement`
 * "document"), the section follows the page's fields: its words line up with
 * theirs, and the page's largest gap sets it apart from them. A lede under the
 * title says what the list is for in a line or two, before the rows.
 */
export function ListSection({ title, aside, lede, empty, note, foot, placement = "list", children }: {
  title: string;
  /** What the list is for, under the title. It can hold a block, such as a consequence to read before the rows. */
  lede?: ReactNode;
  placement?: "list" | "document";
  /** A readout beside the title, such as a count or a summary mark. */
  aside?: ReactNode;
  empty: ReactNode; note?: ReactNode;
  /** A control under the rows, such as one that shows more of them. */
  foot?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  const rows = Children.toArray(children);
  return <section className="list-section" data-placement={placement === "document" ? placement : undefined} aria-labelledby={id}>
    {aside ? <div className="list-section-head"><h2 className="list-section-title" id={id}>{title}</h2><span className="list-section-aside">{aside}</span></div>
      : <h2 className="list-section-title" id={id}>{title}</h2>}
    {lede ? <div className="list-section-lede">{lede}</div> : null}
    {rows.length ? <ul className="list-section-rows">{rows}</ul> : <p className="list-section-empty">{empty}</p>}
    {foot ? <div className="list-section-foot">{foot}</div> : null}
    {note ? <p className="list-section-note">{note}</p> : null}
  </section>;
}
