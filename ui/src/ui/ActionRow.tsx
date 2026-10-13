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
 */
export function ActionRow({ name, status, tone, detail, actions, layout = "centered" }: {
  name: string;
  /** A word or two about its state. */
  status?: string | undefined;
  tone?: "danger" | undefined;
  detail?: ReactNode;
  actions?: ReactNode;
  layout?: "centered" | "head" | "stacked";
}) {
  return <li className="action-row" data-layout={layout === "centered" ? undefined : layout}>
    <span className="action-row-name">{name}</span>
    {status ? <span className="action-row-status" data-tone={tone}>{status}</span> : null}
    {detail ? <span className="action-row-detail">{detail}</span> : null}
    {actions ? <span className="action-row-actions">{actions}</span> : null}
  </li>;
}
