import type { ReactNode } from "react";
import "./ActionRow.css";

/**
 * Molecule: one list item that is not a link. Its name and a short status
 * share the first line; a second line says where it is. Its commands sit at
 * the end and stay there while the words wrap.
 *
 * `layout` "head" puts the commands on the first line with the status, so
 * the two line up and the detail takes the whole width under them.
 * "stacked" is the same for a narrow row: the status goes under the name and
 * shares its line with the commands.
 *
 * `tone` "danger" colours the status; "quiet" mutes the whole row, for an
 * item that needs nothing from the reader. `below` takes the row's full width
 * under everything else, such as the rows it is made of.
 */
export function ActionRow({ name, status, tone, detail, actions, below, layout = "centered" }: {
  name: string;
  /** A word or two about its state. */
  status?: string | undefined;
  tone?: "danger" | "quiet" | undefined;
  detail?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
  layout?: "centered" | "head" | "stacked";
}) {
  return <li className="action-row" data-layout={layout === "centered" ? undefined : layout} data-tone={tone === "quiet" ? tone : undefined}>
    <span className="action-row-name">{name}</span>
    {status ? <span className="action-row-status" data-tone={tone}>{status}</span> : null}
    {detail ? <span className="action-row-detail">{detail}</span> : null}
    {actions ? <span className="action-row-actions">{actions}</span> : null}
    {below ? <div className="action-row-below">{below}</div> : null}
  </li>;
}
